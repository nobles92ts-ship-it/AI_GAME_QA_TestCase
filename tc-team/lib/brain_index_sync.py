#!/usr/bin/env python3
"""brain_index_sync.py — 지정 프로젝트의 context-mode KB 에 뇌 번들을 색인한다 (결정론).

왜 있나 (2026-08-23):
  context-mode KB 는 프로젝트 디렉터리별로 갈린다. 뇌 재색인(`_BRAIN/_reindex.py`)은 번들 파일만
  오프라인 생성하고 실제 `ctx_index` 는 Claude 세션(MCP)이 하는데, 그 세션의 cwd 가 어느 KB 에
  들어갈지를 결정한다 — 지금까지 늘 {WORK_ROOT} 였다. 그 결과 체인이 대조 에이전트를 돌리는
  {PROJECT_ROOT} KB 에는 뇌가 한 번도 들어간 적이 없었다.

  이 스크립트는 사람·LLM 개입 없이 stdio MCP 로 `ctx_index` 를 직접 호출해 그 구멍을 메운다.
  ctx_index 는 같은 label 로 재호출하면 갱신되므로 반복 실행이 안전하다(멱등).

usage:
  python brain_index_sync.py --project-dir <dir> --source <label> --bundle <path> [--cli <cli.bundle.mjs>] [--node <node.exe>]

exit 0 = 색인 성공 / 2 = CLI·번들 없음(비차단 스킵) / 1 = 실패
"""
import argparse
import glob
import json
import os
import subprocess
import sys

PLUGIN_GLOB = os.path.join(
    os.path.expanduser("~"), ".claude", "plugins", "cache", "context-mode",
    "context-mode", "*", "cli.bundle.mjs")

# context-mode 가 프로젝트 경로를 고르는 우선순위 (cli.bundle.mjs 실측).
# 우리가 지정한 값이 이기려면 앞쪽 변수들을 전부 비워야 한다.
HIGHER_PRECEDENCE = (
    "CLAUDE_PROJECT_DIR", "GEMINI_PROJECT_DIR", "VSCODE_CWD",
    "OPENCODE_PROJECT_DIR", "PI_PROJECT_DIR",
)


def newest_cli() -> str:
    hits = sorted(glob.glob(PLUGIN_GLOB))
    return hits[-1] if hits else ""


class Stdio:
    """최소 MCP stdio 클라이언트 — initialize → tools/call 만 한다."""

    def __init__(self, node, cli, project_dir):
        env = dict(os.environ)
        for k in HIGHER_PRECEDENCE:
            env.pop(k, None)
        env["CONTEXT_MODE_PROJECT_DIR"] = project_dir
        self.p = subprocess.Popen(
            [node, cli], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, env=env, text=True,
            encoding="utf-8", bufsize=1)

    def send(self, obj):
        self.p.stdin.write(json.dumps(obj) + "\n")
        self.p.stdin.flush()

    def read(self, timeout_lines=4000):
        for _ in range(timeout_lines):
            line = self.p.stdout.readline()
            if not line:
                return None
            line = line.strip()
            if line.startswith("{"):
                try:
                    return json.loads(line)
                except Exception:  # noqa: BLE001
                    continue
        return None

    def close(self):
        try:
            self.p.terminate()
        except Exception:  # noqa: BLE001
            pass


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project-dir", required=True)
    ap.add_argument("--source", required=True)
    ap.add_argument("--bundle", required=True)
    ap.add_argument("--cli", default="")
    ap.add_argument("--node", default="node")
    a = ap.parse_args()

    cli = a.cli or newest_cli()
    if not cli or not os.path.exists(cli):
        print(json.dumps({"ok": False, "skip": "context-mode CLI 없음"}, ensure_ascii=False))
        return 2
    if not os.path.exists(a.bundle):
        print(json.dumps({"ok": False, "skip": f"번들 없음: {a.bundle}"}, ensure_ascii=False))
        return 2

    c = Stdio(a.node, cli, a.project_dir)
    try:
        c.send({"jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"protocolVersion": "2024-11-05", "capabilities": {},
                           "clientInfo": {"name": "brain_index_sync", "version": "1"}}})
        if not c.read():
            print(json.dumps({"ok": False, "error": "initialize 실패"}, ensure_ascii=False))
            return 1
        c.send({"jsonrpc": "2.0", "method": "notifications/initialized"})
        c.send({"jsonrpc": "2.0", "id": 2, "method": "tools/call",
                "params": {"name": "ctx_index",
                           "arguments": {"path": a.bundle, "source": a.source}}})
        res = c.read()
    finally:
        c.close()

    if not res or "result" not in res:
        print(json.dumps({"ok": False, "error": f"ctx_index 응답 없음/오류: {str(res)[:200]}"},
                         ensure_ascii=False))
        return 1

    txt = ""
    for blk in res["result"].get("content", []):
        if blk.get("type") == "text":
            txt += blk.get("text", "")
    print(json.dumps({"ok": True, "project_dir": a.project_dir, "source": a.source,
                      "bundle": a.bundle, "result": txt[:300]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
