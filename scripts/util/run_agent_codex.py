#!/usr/bin/env python3
"""run_agent_codex.py — run-agent.sh 의 Codex 짝 (2026-10-01, Loki Codex 이식).

run-agent.sh(claude -p) 와 같은 인자를 받아 `codex exec` 로 돈다. tc-team 체인이
TCTEAM_ENGINE=codex 일 때만 이 경로를 고른다(run-agent-codex.sh). 공용 run-agent.sh
는 손대지 않는다 — v2 엔진 등 다른 호출자는 Claude 그대로.

받는 인자 (run-agent.sh 와 같다):
  -p · --permission-mode X   — 무시 (권한은 아래 샌드박스가 정한다)
  --model M                  — 무시하고 TCTEAM_CODEX_MODEL(기본 gpt-5.6-sol, 실측)
  --effort E                 — model_reasoning_effort (max → xhigh)
  --agent NAME               — ~/.claude/agents/<에이전트 이름>.md 본문을 역할 지시로 프롬프트 앞에 붙인다
  마지막 위치 인자            — 작업 프롬프트

격리 (Claude 경로의 TCTEAM_ISOLATE 와 같은 목적):
  * --ignore-user-config/--ignore-rules — 사용자 MCP·플러그인·훅·기억 없음.
    `--disable apps` 필수: 안 끄면 ChatGPT 커넥터(Drive·Slack·Gmail…)가 그대로 붙는다(실측).
  * workspace-write 샌드박스(Windows elevated) — 쓰기는 작업 폴더(기본 team/specs)·TEMP·
    TCTEAM_CODEX_WRITABLE 만. 실측: 밖에 쓰면 EPERM. 네트워크는 연다(설계자의 이미지·드라이브 스크립트).
  * 에이전트가 ctx_search 를 요구하면 그 MCP 서버 하나만 붙인다(작업 폴더 = 프로젝트 루트 KB).

출력: 마지막 메시지를 stdout 으로(체인 로그). 실패는 stderr 에 pipeline_retry.sh 가
분류하는 문구로 — 재인증=401 Unauthorized(→rc 10), 한도=usage limit reached, 429.
claude 는 어떤 경로로도 부르지 않는다.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
LIB = PROJECT_ROOT / "tc-team" / "lib"
DEFAULT_MODEL = "gpt-5.6-sol"
EFFORTS = {"low": "low", "medium": "medium", "high": "high",
           "xhigh": "xhigh", "max": "xhigh"}
# 에이전트 단계에 필요 없는 도구를 주는 기능 — 앱 커넥터·플러그인·하위 에이전트·브라우저 등
DISABLE = ("apps", "plugins", "remote_plugin", "memories", "hooks",
           "computer_use", "browser_use", "browser_use_external",
           "in_app_browser", "image_generation", "multi_agent", "goals",
           "tool_suggest")
CTX_TOOL = "mcp__plugin_context-mode_context-mode__ctx_search"
REAUTH = ("could not be refreshed", "please log out and sign in", "sign in again",
          "not logged in", "unauthorized", "401")
LIMIT = ("usage limit", "hit your", "limit reached", "out of credits")
RATE = ("429", "too many requests", "rate limit", "quota")

PREAMBLE = """[실행 환경 — Codex]
이 작업은 Claude Code 용으로 쓰인 역할 지시를 Codex 에서 실행한다. 도구 이름을 이렇게 바꿔 읽어라:
- Read / Glob / Grep → 셸(rg, Get-Content 등)로 읽기·찾기. 이미지 Read → view_image 도구.
- Write / Edit → apply_patch 또는 셸로 파일 쓰기. 지정된 경로 밖에는 쓰지 마라(샌드박스가 막는다).
- Bash 블록 → bash -lc '<명령>' 으로 실행(Git Bash). python3 가 없으면 python.
- {ctx_tool} → MCP 서버 ctx 의 ctx_search 도구(인자 동일: queries, source, limit).
- Agent/Task(하위 에이전트) 는 없다 — 직접 수행.
지시에 적힌 산출물 경로·형식·종료 문구는 그대로 지켜라.
"""


def die(msg: str, rc: int = 1) -> None:
    sys.stderr.write(f"[run-agent-codex] {msg}\n")
    sys.exit(rc)


def parse(argv: list[str]) -> dict:
    out = {"effort": None, "agent": None, "prompt": None}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "-p":
            i += 1
        elif a in ("--permission-mode", "--model"):
            i += 2
        elif a == "--effort":
            out["effort"] = argv[i + 1] if i + 1 < len(argv) else None
            i += 2
        elif a == "--agent":
            out["agent"] = argv[i + 1] if i + 1 < len(argv) else None
            i += 2
        elif a.startswith("-") and a != "-":
            die(f"알 수 없는 인자: {a}")
        else:
            if out["prompt"] is not None:
                die("프롬프트 인자가 둘 이상")
            out["prompt"] = a
            i += 1
    if not out["prompt"]:
        die("프롬프트 인자 없음")
    return out


def agents_dir() -> Path:
    home = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(Path.home(), ".claude")
    return Path(home) / "agents"


def load_agent(name: str) -> tuple[str, list[str]]:
    """(본문, tools) — run-agent.sh 와 같은 규칙: frontmatter 를 떼고, 빈 본문은 실패."""
    f = agents_dir() / f"{name}.md"
    if not f.is_file():
        die(f"에이전트 파일 없음: {f}")
    text = f.read_text(encoding="utf-8")
    fm = re.match(r"^---\r?\n([\s\S]*?)\r?\n---\r?\n", text)
    body = text[fm.end():] if fm else text
    tools: list[str] = []
    if fm:
        m = re.search(r"^tools:\s*(.+)$", fm.group(1), re.M)
        if m:
            v = m.group(1).strip()
            tools = json.loads(v) if v.startswith("[") else [x.strip() for x in v.split(",") if x.strip()]
    if not body.strip():
        die(f"에이전트 본문이 비어 있음: {f}")
    return body, tools


def toml_str(s: str) -> str:
    return json.dumps(s, ensure_ascii=False)        # JSON 문자열 = 유효한 TOML 기본 문자열


def ctx_server_flags() -> list[str]:
    """context-mode 서버 하나 — tc-team 이 이미 쓰는 같은 CLI·같은 프로젝트 KB."""
    sys.path.insert(0, str(LIB))
    try:
        import brain_index_sync  # noqa: E402
        cli = brain_index_sync.newest_cli()
    except Exception as e:  # pragma: no cover - 설치 환경 문제
        die(f"context-mode CLI 탐색 실패: {e}")
    if not cli:
        die("context-mode CLI 를 못 찾음 — ctx_search 를 요구하는 에이전트는 돌릴 수 없다")
    proj = str(PROJECT_ROOT).replace("\\", "/")
    return ["-c", f"mcp_servers.ctx.command={toml_str('node')}",
            "-c", f"mcp_servers.ctx.args=[{toml_str(cli)}]",
            "-c", f"mcp_servers.ctx.cwd={toml_str(proj)}",
            "-c", f"mcp_servers.ctx.env={{CONTEXT_MODE_PROJECT_DIR={toml_str(proj)}}}",
            "-c", "mcp_servers.ctx.startup_timeout_sec=60",
            # approval_policy=never 이면 MCP 호출은 승인 대기로 거부된다(실측: "requires approval").
            # 이 서버는 읽기 전용 검색 하나라 미리 승인한다.
            "-c", 'mcp_servers.ctx.default_tools_approval_mode="approve"']


def writable_dirs() -> list[str]:
    dirs = [str(PROJECT_ROOT / "team" / "specs"), tempfile.gettempdir()]
    extra = os.environ.get("TCTEAM_CODEX_WRITABLE", "")
    dirs += [d for d in extra.split(os.pathsep) if d.strip()]
    return dirs


def build(opts: dict, last_file: str) -> tuple[list[str], str]:
    codex = os.environ.get("CODEX_CMD") or shutil.which("codex")
    if not codex:
        die("codex CLI 를 못 찾음")
    model = os.environ.get("TCTEAM_CODEX_MODEL", "").strip() or DEFAULT_MODEL
    effort = EFFORTS.get((opts["effort"] or "high").lower(), "high")
    cwd, *more = writable_dirs()
    cmd = [codex, "exec", "--json", "--skip-git-repo-check",
           "--ignore-user-config", "--ignore-rules",
           "-m", model, "-c", f"model_reasoning_effort={toml_str(effort)}",
           "-s", "workspace-write",
           "-c", 'windows.sandbox="elevated"',
           "-c", "sandbox_workspace_write.network_access=true",
           "-c", 'approval_policy="never"', "-c", 'web_search="disabled"',
           "-C", cwd]
    for d in more:
        cmd += ["--add-dir", d]
    for feat in DISABLE:
        cmd += ["--disable", feat]
    prompt = opts["prompt"]
    if opts["agent"]:
        body, tools = load_agent(opts["agent"])
        if CTX_TOOL in tools:
            cmd += ctx_server_flags()
        prompt = (PREAMBLE.format(ctx_tool=CTX_TOOL)
                  + f"\n<역할 지시: {opts['agent']}>\n{body}\n</역할 지시>\n\n## 작업\n{prompt}")
    else:
        prompt = PREAMBLE.format(ctx_tool=CTX_TOOL) + "\n## 작업\n" + prompt
    cmd += ["-o", last_file, "-"]
    return cmd, prompt


def classify(failure: str) -> str:
    low = failure.lower()
    if any(m in low for m in REAUTH):
        return f"401 Unauthorized (codex): {failure}"
    if any(m in low for m in LIMIT):
        return f"usage limit reached (codex): {failure}"
    if any(m in low for m in RATE):
        return f"429 (codex): {failure}"
    return f"codex error: {failure}"


def env_for_child() -> dict[str, str]:
    # The Loki worker holds Slack/Jira/Google credentials in its environment.
    # A denylist cannot anticipate every credential name. Pass only process
    # essentials needed by Codex, Node/context-mode and Windows itself.
    allowed = {
        "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC",
        "PROGRAMFILES", "PROGRAMFILES(X86)", "COMMONPROGRAMFILES",
        "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "HOME", "APPDATA",
        "LOCALAPPDATA", "TEMP", "TMP", "USERNAME", "USER", "CODEX_HOME",
        "LANG", "LC_ALL", "TERM", "PYTHONUTF8", "PYTHONIOENCODING",
    }
    env = {k: v for k, v in os.environ.items() if k.upper() in allowed}
    env["PYTHONUTF8"] = "1"
    return env


def main(argv: list[str]) -> int:
    opts = parse(argv)
    fd, last_file = tempfile.mkstemp(prefix="tcteam_codex_", suffix=".txt")
    os.close(fd)
    try:
        cmd, prompt = build(opts, last_file)
        r = subprocess.run(cmd, input=prompt, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", env=env_for_child())
        dbg = os.environ.get("RUNAGENT_DEBUG_FILE")
        if dbg:
            try:
                Path(dbg).write_text(r.stdout + "\n--- stderr ---\n" + r.stderr,
                                     encoding="utf-8")
            except OSError:
                pass
        failure = ""
        for line in r.stdout.splitlines():
            try:
                ev = json.loads(line)
            except Exception:
                continue
            if ev.get("type") in ("turn.failed", "error"):
                e = ev.get("error") if isinstance(ev.get("error"), dict) else ev
                msg = str(e.get("message") or "")
                # 시작 시 알림(스킬 설명 축약 등)은 error 로 오지만 실패가 아니다
                if (ev.get("type") == "turn.failed" or "401" in msg
                        or any(m in msg.lower() for m in LIMIT)):
                    failure = msg or failure
        text = Path(last_file).read_text(encoding="utf-8", errors="replace").strip()
        if failure or r.returncode != 0:
            sys.stderr.write(classify(failure or r.stderr.strip()[-500:] or f"exit {r.returncode}") + "\n")
            if text:
                sys.stdout.write(text + "\n")
            return r.returncode or 1
        sys.stdout.write(text + "\n")
        return 0
    finally:
        try:
            os.unlink(last_file)
        except OSError:
            pass


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
