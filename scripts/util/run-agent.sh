#!/usr/bin/env bash
# run-agent.sh — claude -p --agent 래퍼
# 문제: CLI 2.1.121에서 claude -p --agent X가 도구를 실행하지 않고 XML로만 출력
# 해결: --agent 플래그를 --system-prompt 로 변환해 실제 도구 실행 보장

NODE="node"
AGENTS_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/agents"

# 1M context 환경변수 차단 — 메인 세션이 1M variant 사용 중이어도 자식은 200K 표준 강제
unset ANTHROPIC_BETAS
unset CLAUDE_CODE_1M_CONTEXT
unset CLAUDE_CODE_ENABLE_1M
unset ANTHROPIC_1M_CONTEXT
unset ANTHROPIC_CONTEXT_LENGTH
unset CLAUDE_CONTEXT_LENGTH
unset CLAUDE_USE_1M
unset CLAUDE_CODE_USE_1M
unset CLAUDE_EFFORT
unset CLAUDE_CODE_EFFORT
unset CLAUDE_MAX_TOKENS

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

# 모델 alias 변환 정책 (2026-05-26 갱신):
# - sonnet → claude-sonnet-4-6 강제 변환 (1M variant 없는 full ID, 부모 세션과 무관하게 200K 강제)
# - opus / haiku 등 다른 alias는 그대로 전달 (CLI 표준 라우팅)
# - 1M 차단 추가 안전망: 위쪽 env unset (ANTHROPIC_BETAS 등)
SONNET_FIXED_ARGS=()
for arg in "${NEW_ARGS[@]}"; do
  case "$arg" in
    sonnet|"sonnet[1m]") SONNET_FIXED_ARGS+=("claude-sonnet-4-6") ;;
    *)                   SONNET_FIXED_ARGS+=("$arg") ;;
  esac
done
NEW_ARGS=("${SONNET_FIXED_ARGS[@]}")

# 디버그 관측 (L4-F10 사인 확정용, 2026-06-12): env RUNAGENT_DEBUG_FILE 지정 시 CLI 내부 로그를 전용 파일로 — stdout/stderr 무오염
if [[ -n "$RUNAGENT_DEBUG_FILE" ]]; then
  NEW_ARGS+=(--debug-file "$RUNAGENT_DEBUG_FILE")
fi

if [[ -n "$AGENT_NAME" ]]; then
  AGENT_FILE="$AGENTS_DIR/$AGENT_NAME.md"
  if [[ ! -f "$AGENT_FILE" ]]; then
    echo "[run-agent] ERROR: 에이전트 파일 없음: $AGENT_FILE" >&2
    exit 1
  fi
  AGENT_BODY=$("$NODE" -e "
const fs=require('fs');
const c=fs.readFileSync('$AGENT_FILE','utf8');
process.stdout.write(c.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/,''));
")
  exec claude "${NEW_ARGS[@]}" --system-prompt "$AGENT_BODY"
else
  exec claude "${NEW_ARGS[@]}"
fi
