#!/usr/bin/env bash
# run-agent.sh — claude -p --agent 래퍼
# 문제: CLI 2.1.121에서 claude -p --agent X가 도구를 실행하지 않고 XML로만 출력
# 해결: --agent 플래그를 --system-prompt 로 변환해 실제 도구 실행 보장

NODE="C:/Users/Admin/Downloads/AI_AntiGravity/node-v20.11.1-win-x64/node.exe"
AGENTS_DIR="C:/Users/Admin/.claude/agents"

AGENT_NAME=""
NEW_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent)
      AGENT_NAME="$2"
      shift 2
      ;;
    *)
      NEW_ARGS+=("$1")
      shift
      ;;
  esac
done

if [[ -n "$AGENT_NAME" ]]; then
  AGENT_FILE="$AGENTS_DIR/$AGENT_NAME.md"
  if [[ ! -f "$AGENT_FILE" ]]; then
    echo "[run-agent] ERROR: 에이전트 파일 없음: $AGENT_FILE" >&2
    exit 1
  fi
  AGENT_BODY=$("$NODE" -e "
const fs=require('fs');
const c=fs.readFileSync('$AGENT_FILE','utf8');
process.stdout.write(c.replace(/^---\n[\s\S]*?\n---\n/,''));
")
  exec claude "${NEW_ARGS[@]}" --system-prompt "$AGENT_BODY"
else
  exec claude "${NEW_ARGS[@]}"
fi
