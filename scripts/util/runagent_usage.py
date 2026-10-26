#!/usr/bin/env python3
"""Opt-in model-call measurements, without prompts, credentials, or raw logs.

RUNAGENT_USAGE_FILE writes one call record to the caller's chosen file. Otherwise
RUNAGENT_USAGE_DIR writes a unique JSON file per invocation, including parallel
invocations. Missing CLI usage is null, never a token estimate or zero.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
from typing import Any
import uuid


TOKEN_FIELDS = ("input_tokens", "cached_input_tokens", "output_tokens")
TOKEN_SEMANTICS = {
    "input_tokens": "total_including_cache_read_and_cache_creation",
    "cached_input_tokens": "cache_read_subset_of_input_tokens",
    "output_tokens": "provider_reported",
}
CLAUDE_RAW_FIELDS = ("input_tokens", "cache_read_input_tokens",
                     "cache_creation_input_tokens", "output_tokens")


def enabled() -> bool:
    return bool(os.environ.get("RUNAGENT_USAGE_FILE") or os.environ.get("RUNAGENT_USAGE_DIR"))


def utf8_output() -> None:
    """Only metered paths opt in; old unmetered stdout behaviour is unchanged."""
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")


def null_usage() -> dict[str, int | None]:
    return dict.fromkeys(TOKEN_FIELDS)


def number(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


def codex_usage(stdout: str) -> tuple[dict[str, int | None], str]:
    turns = []
    for line in stdout.splitlines():
        try:
            event = json.loads(line)
        except (ValueError, TypeError):
            continue
        if isinstance(event, dict) and event.get("type") == "turn.completed":
            turns.append(event.get("usage"))
    result = null_usage()
    if turns:
        for field in TOKEN_FIELDS:
            values = [number(turn.get(field)) if isinstance(turn, dict) else None for turn in turns]
            # A missing turn/field makes that aggregate unknown, not a partial total.
            if all(value is not None for value in values):
                result[field] = sum(values)
    return result, usage_status(result)


def usage_status(usage: dict[str, int | None]) -> str:
    known = sum(value is not None for value in usage.values())
    return "known" if known == len(TOKEN_FIELDS) else "partial" if known else "unknown"


def claude_usage(raw: dict) -> dict[str, int | None]:
    """Normalize Claude's disjoint input components to Codex's inclusive input."""
    components = [number(raw.get(field)) for field in CLAUDE_RAW_FIELDS[:3]]
    return {
        "input_tokens": sum(components) if all(value is not None for value in components) else None,
        "cached_input_tokens": number(raw.get("cache_read_input_tokens")),
        "output_tokens": number(raw.get("output_tokens")),
    }


def cli_command(arguments: list[str]) -> list[str]:
    """Resolve the installed Windows npm shim to its native/Node entry point.

    Native executables receive arguments directly; an unknown batch-only shim
    fails closed instead of letting cmd.exe reinterpret a TC prompt.
    """
    command = shutil.which(arguments[0]) or arguments[0]
    if os.name != "nt" or Path(command).suffix.lower() not in (".cmd", ".bat"):
        return [command, *arguments[1:]]
    package = Path(command).parent / "node_modules" / "@anthropic-ai" / "claude-code"
    manifest = package / "package.json"
    if manifest.is_file():
        data = json.loads(manifest.read_text(encoding="utf-8"))
        bins = data.get("bin", {})
        entry = bins.get("claude") if isinstance(bins, dict) else bins
        if isinstance(entry, str):
            target = (package / entry).resolve()
            if target.is_relative_to(package.resolve()) and target.is_file():
                if target.suffix.lower() == ".exe":
                    return [str(target), *arguments[1:]]
                if target.suffix.lower() in (".js", ".cjs", ".mjs"):
                    node = shutil.which("node")
                    if node:
                        return [node, str(target), *arguments[1:]]
    # Git Bash npm shims (and our mock CLI) have a sibling POSIX launcher. Run
    # its script as argv through the same Bash already running run-agent.sh.
    launcher = os.environ.get("RUNAGENT_BASH")
    sibling = Path(command).with_suffix("")
    if launcher and Path(launcher).is_file() and sibling.is_file():
        return [launcher, str(sibling), *arguments[1:]]
    raise OSError("No direct CLI entry point for batch shim")


def write_record(engine: str, model: str | None, elapsed: float, return_code: int,
                 usage: dict[str, int | None], source: str,
                 raw_usage: dict[str, int | None] | None = None) -> None:
    explicit = os.environ.get("RUNAGENT_USAGE_FILE")
    directory = os.environ.get("RUNAGENT_USAGE_DIR")
    if not explicit and not directory:
        return
    path = Path(explicit) if explicit else Path(directory) / f"{engine}_{uuid.uuid4().hex}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    record = {
        "schema_version": 1,
        "engine": engine,
        "model": model,
        "elapsed_seconds": round(elapsed, 6),
        "return_code": return_code,
        "log_source": source,
        "usage_status": usage_status(usage),
        "usage": usage,
        "raw_usage": raw_usage if raw_usage is not None else dict(usage),
        "token_semantics": TOKEN_SEMANTICS,
    }
    fd, temporary = tempfile.mkstemp(prefix=".runagent_usage_", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(record, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        os.replace(temporary, path)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def claude_main(argv: list[str]) -> int:
    """Run an argument-array CLI in JSON mode; retain the text stdout contract."""
    utf8_output()
    if len(argv) < 5 or argv[:2] != ["--engine", "claude"] or argv[2] != "--model" or "--" not in argv[4:]:
        sys.stderr.write("[run-agent-usage] invalid wrapper arguments\n")
        return 2
    model = argv[3] or None
    command = argv[argv.index("--", 4) + 1:]
    if not command:
        sys.stderr.write("[run-agent-usage] missing CLI command\n")
        return 2
    # Metering requires one final JSON object; strip conflicting output switches.
    filtered = [command[0]]
    i = 1
    while i < len(command):
        if command[i] == "--output-format":
            i += 2
        elif command[i].startswith("--output-format="):
            i += 1
        else:
            filtered.append(command[i])
            i += 1
    filtered.extend(["--output-format", "json"])
    start = time.perf_counter()
    usage = null_usage()
    raw_usage = dict.fromkeys(CLAUDE_RAW_FIELDS)
    try:
        result = subprocess.run(cli_command(filtered), capture_output=True, text=True,
                                encoding="utf-8", errors="replace")
        elapsed = time.perf_counter() - start
        return_code = result.returncode
        sys.stderr.write(result.stderr)
        try:
            payload = json.loads(result.stdout)
            if not isinstance(payload, dict):
                raise ValueError("JSON result is not an object")
            text = payload.get("result")
            if not isinstance(text, str):
                raise ValueError("JSON result has no text result")
            sys.stdout.write(text)
            if not text.endswith("\n"):
                sys.stdout.write("\n")
            raw = payload.get("usage")
            if isinstance(raw, dict):
                raw_usage = {field: number(raw.get(field)) for field in CLAUDE_RAW_FIELDS}
                usage = claude_usage(raw_usage)
            if payload.get("is_error") and return_code == 0:
                return_code = 1
        except (ValueError, TypeError):
            sys.stderr.write("[run-agent-usage] Claude returned no valid JSON text result\n")
            if return_code == 0:
                return_code = 1
    except (OSError, ValueError, TypeError):
        elapsed = time.perf_counter() - start
        sys.stderr.write("[run-agent-usage] unable to launch Claude CLI\n")
        return_code = 127
    try:
        write_record("claude", model, elapsed, return_code, usage, "claude.json.usage", raw_usage)
    except OSError:
        sys.stderr.write("[run-agent-usage] unable to save requested usage record\n")
        return_code = return_code or 1
    return return_code


if __name__ == "__main__":
    sys.exit(claude_main(sys.argv[1:]))
