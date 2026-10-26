#!/usr/bin/env python3
"""Offline runtime-path regression: no live MCP, model, or user KB writes."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import tomllib
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
import brain_index_sync as sync  # noqa: E402
import crossref_source_gate as gate  # noqa: E402


class RuntimePathsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="tcteam-brain-paths-")
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.env = patch.dict(os.environ, {}, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)
        # Keep the real expanduser behavior for all values except the home lookup.
        expanduser = os.path.expanduser
        self.expand = patch("os.path.expanduser", side_effect=lambda p: (
            str(self.home) if p == "~" else expanduser(p)))
        self.expand.start()
        self.addCleanup(self.expand.stop)

    def cli(self, home, version):
        path = home / "plugins/cache/context-mode/context-mode" / version / "cli.bundle.mjs"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("// offline fixture", encoding="utf-8")
        return str(path)

    def database(self, home, project, source="brain-corpus-D", indexed="2099-01-01 00:00:00",
                 content_dir=None):
        content_dir = content_dir or home / "context-mode/content"
        path = content_dir / f"{gate.kb_hash(project)}.db"
        path.parent.mkdir(parents=True, exist_ok=True)
        with contextlib.closing(sqlite3.connect(path)) as con:
            with con:
                con.execute("CREATE TABLE sources (id INTEGER, label TEXT, chunk_count INTEGER, indexed_at TEXT)")
                con.execute("INSERT INTO sources VALUES (1, ?, 5818, ?)", (source, indexed))
        return path

    def check_gate(self, project, bundle=""):
        argv = ["gate", "--project-dir", project, "--source", "brain-corpus-D"]
        if bundle:
            argv += ["--bundle", str(bundle)]
        output = io.StringIO()
        with patch.object(sys, "argv", argv), contextlib.redirect_stdout(output):
            code = gate.main()
        return code, json.loads(output.getvalue())

    def runner(self):
        runner_path = Path(__file__).resolve().parents[2] / "scripts/util/run_agent_codex.py"
        spec = importlib.util.spec_from_file_location("runtime_path_test_runner", runner_path)
        runner = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(runner)
        return runner

    def test_default_claude_keeps_legacy_home_cli_hash_and_status(self):
        project = "{PROJECT_ROOT}/"
        self.cli(self.home / ".codex", "1.0.169")
        expected_cli = self.cli(self.home / ".claude", "1.0.89")
        expected_hash = hashlib.sha256(project.encode()).hexdigest()[:16]
        expected_db = self.database(self.home / ".claude", project)
        code, result = self.check_gate(project)
        self.assertEqual(sync.newest_cli(), expected_cli)
        self.assertEqual(gate.kb_hash(project), expected_hash)
        self.assertEqual((code, result["status"], result["chunk_count"]), (0, "OK", 5818))
        self.assertEqual(result["kb_path"], str(expected_db))

    def test_codex_uses_native_cli_and_canonical_hash(self):
        os.environ["TCTEAM_ENGINE"] = "codex"
        project = "C:\\work\\AI_AntiGravity\\"
        self.cli(self.home / ".claude", "9.9.9")
        expected_cli = self.cli(self.home / ".codex", "1.0.169")
        normalized = "{PROJECT_ROOT}"
        if sys.platform in ("win32", "darwin"):
            normalized = normalized.lower()
        expected_db = self.database(self.home / ".codex", project)
        code, result = self.check_gate(project)
        self.assertEqual(sync.newest_cli(), expected_cli)
        self.assertEqual(gate.kb_hash(project), hashlib.sha256(normalized.encode()).hexdigest()[:16])
        self.assertEqual((code, result["status"]), (0, "OK"))
        self.assertEqual(result["kb_path"], str(expected_db))

    def test_codex_home_override_relocates_both_cli_and_gate(self):
        os.environ.update(TCTEAM_ENGINE="codex", CODEX_HOME="~/codex-profile")
        override = self.home / "codex-profile"
        self.cli(self.home / ".codex", "9.9.9")
        expected_cli = self.cli(override, "1.0.169")
        expected_db = self.database(override, "{PROJECT_ROOT}")
        code, result = self.check_gate("{PROJECT_ROOT}")
        self.assertEqual(sync.newest_cli(), expected_cli)
        self.assertEqual(result["kb_path"], str(expected_db))
        self.assertEqual((code, result["status"]), (0, "OK"))

    def test_codex_without_native_cli_does_not_fall_back_to_claude(self):
        os.environ["TCTEAM_ENGINE"] = "codex"
        self.cli(self.home / ".claude", "1.0.89")
        self.assertEqual(sync.newest_cli(), "")

    def test_codex_drops_storage_overrides_like_search_child(self):
        project = "{PROJECT_ROOT}"
        profile = self.home / "profile"
        storage, data = self.home / "storage", self.home / "data"
        os.environ.update(TCTEAM_ENGINE="codex", CODEX_HOME=str(profile),
                          CONTEXT_MODE_DIR=str(storage), CONTEXT_MODE_DATA_DIR=str(data))
        self.database(self.home, project, content_dir=storage / "content")
        self.database(data, project)
        code, result = self.check_gate(project)
        self.assertEqual((code, result["status"]), (5, "NO_KB"))
        expected_db = self.database(profile, project)
        code, result = self.check_gate(project)
        self.assertEqual(result["kb_path"], str(expected_db))
        self.assertEqual((code, result["status"]), (0, "OK"))
        with patch.object(sync.subprocess, "Popen") as popen:
            sync.Stdio("node", "fixture-cli", project)
        sync_env = popen.call_args.kwargs["env"]
        search_env = self.runner().env_for_child()
        for child_env in (sync_env, search_env):
            self.assertNotIn("CONTEXT_MODE_DIR", child_env)
            self.assertNotIn("CONTEXT_MODE_DATA_DIR", child_env)
            self.assertEqual(child_env["CODEX_HOME"], str(profile))

    def test_search_mcp_config_pins_platform_and_project_before_initialize(self):
        os.environ.update(TCTEAM_ENGINE="codex", CONTEXT_MODE_PLATFORM="wrong-parent")
        cli = self.cli(self.home / ".codex", "1.0.169")
        flags = self.runner().ctx_server_flags()
        self.assertTrue(all(flag == "-c" for flag in flags[::2]))
        config = tomllib.loads("\n".join(flags[1::2]))["mcp_servers"]["ctx"]
        expected_project = Path(__file__).resolve().parents[2].as_posix()
        self.assertEqual(config["env"], {"CONTEXT_MODE_PROJECT_DIR": expected_project,
                                         "CONTEXT_MODE_PLATFORM": "codex"})
        self.assertEqual(config["cwd"], expected_project)
        self.assertEqual(config["args"], [cli])

    def test_claude_legacy_runtime_ignores_codex_storage_overrides(self):
        os.environ.update(CONTEXT_MODE_DIR="relative-ignored", CONTEXT_MODE_DATA_DIR="~/ignored",
                          CODEX_HOME="~/ignored-codex")
        expected_db = self.database(self.home / ".claude", "{PROJECT_ROOT}")
        code, result = self.check_gate("{PROJECT_ROOT}")
        self.assertEqual(result["kb_path"], str(expected_db))
        self.assertEqual((code, result["status"]), (0, "OK"))

    def test_wrong_home_and_healthy_legacy_db_cannot_make_gate_ok(self):
        project = "{PROJECT_ROOT}/"
        self.database(self.home / ".claude", project)
        self.database(self.home / ".codex", project)  # raw legacy sibling
        os.environ["TCTEAM_ENGINE"] = "codex"
        code, result = self.check_gate(project)
        self.assertEqual((code, result["status"]), (5, "NO_KB"))
        self.database(self.home / ".codex", project, source="some-other-source")
        code, result = self.check_gate(project)
        self.assertEqual((code, result["status"]), (3, "MISSING"))

    def test_codex_freshness_still_blocks_stale_index(self):
        os.environ["TCTEAM_ENGINE"] = "codex"
        project = "{PROJECT_ROOT}"
        self.database(self.home / ".codex", project, indexed="2000-01-01 00:00:00")
        bundle = self.home / "bundle.md"
        bundle.write_text("fixture", encoding="utf-8")
        code, result = self.check_gate(project, bundle)
        self.assertEqual((code, result["status"]), (4, "STALE"))

    def test_sync_child_pins_engine_platform_and_project(self):
        for engine, expected in (("claude", "claude-code"), ("codex", "codex")):
            with self.subTest(engine=engine):
                os.environ.update(TCTEAM_ENGINE=engine, CONTEXT_MODE_PLATFORM="wrong-parent",
                                  CLAUDE_PROJECT_DIR="wrong-project", VSCODE_CWD="wrong-project")
                with patch.object(sync.subprocess, "Popen") as popen:
                    sync.Stdio("node", "fixture-cli", "{PROJECT_ROOT}")
                env = popen.call_args.kwargs["env"]
                self.assertEqual(env["CONTEXT_MODE_PLATFORM"], expected)
                self.assertEqual(env["CONTEXT_MODE_PROJECT_DIR"], "{PROJECT_ROOT}")
                self.assertNotIn("CLAUDE_PROJECT_DIR", env)
                self.assertNotIn("VSCODE_CWD", env)


if __name__ == "__main__":
    unittest.main(verbosity=2)
