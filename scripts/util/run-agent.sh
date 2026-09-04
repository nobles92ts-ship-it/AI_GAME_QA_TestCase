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

# 모델 alias 변환 정책 (2026-08-27 갱신 — opus 도 노브화 + sonnet 기본값 승급):
# - sonnet → $TCTEAM_SONNET_MODEL  (기본값 claude-sonnet-5)
# - opus   → $TCTEAM_OPUS_MODEL    (기본값 claude-opus-5)
#   전환·시험은 env 로만 한다:  TCTEAM_SONNET_MODEL=claude-sonnet-4-6 bash <파이프라인>
#   롤백 = env 를 주는 것(무비용). 이 저장소는 git 이 아니라 롤백 경로를 코드 밖에 둔다.
# - ⚠ 별칭(sonnet/opus)을 그대로 CLI 에 흘리지 않는 이유 2가지:
#   (a) 재현성 — 별칭이 가리키는 모델은 CLI 업데이트마다 로그 한 줄 없이 바뀐다. S3PAR=4·
#       COVSIZE=50·재시도 상한 2회·handoff 임계(n=165)가 전부 '그때 그 모델' 기준이라,
#       회귀가 나도 '언제부터'를 못 짚는다. 전환 시점은 사람이 정한다.
#   (b) 1M 누출 — 'sonnet[1m]'·'opus[1m]' 도 이 case 를 타야 200K 로 접힌다.
#       ⚠ settings.json 의 "model": "opus[1m]" 이 실사용 중이라 이 분기가 실제 방어다.
# - sonnet 기본값 승급 근거(2026-08-27 A/B 실측, 108행·190행 2런):
#   s4 −35~54% · 같은 8청크 웨이브 208→81초 · 재시도 0 유지 · 구조 지표 전부 Δ0 ·
#   1NF(복합 기대결과 금지) 준수는 4-6보다 개선. 257행급은 미검증.
# - haiku 등 다른 alias는 그대로 전달 (CLI 표준 라우팅)
# - 1M 차단 추가 안전망: 위쪽 env unset (ANTHROPIC_BETAS 등)
SONNET_PIN="${TCTEAM_SONNET_MODEL:-claude-sonnet-5}"
OPUS_PIN="${TCTEAM_OPUS_MODEL:-claude-opus-5}"
MODEL_FIXED_ARGS=()
for arg in "${NEW_ARGS[@]}"; do
  case "$arg" in
    sonnet|"sonnet[1m]") MODEL_FIXED_ARGS+=("$SONNET_PIN") ;;
    opus|"opus[1m]")     MODEL_FIXED_ARGS+=("$OPUS_PIN") ;;
    *)                   MODEL_FIXED_ARGS+=("$arg") ;;
  esac
done
NEW_ARGS=("${MODEL_FIXED_ARGS[@]}")

# 디버그 관측 (L4-F10 사인 확정용, 2026-06-12): env RUNAGENT_DEBUG_FILE 지정 시 CLI 내부 로그를 전용 파일로 — stdout/stderr 무오염
if [[ -n "$RUNAGENT_DEBUG_FILE" ]]; then
  NEW_ARGS+=(--debug-file "$RUNAGENT_DEBUG_FILE")
fi

# Windows 네이티브 node 에 넘길 경로 정규화 (2026-07-30):
# git-bash 에서 $HOME 은 드라이브 접두 형태(/<드라이브문자>/...)라 AGENT_FILE 도 그렇게 된다.
# bash 의 [[ -f ]] 는 통과하지만 Windows node 는 이를 드라이브 밑의 하위 폴더로 해석해 ENOENT 로 죽는다.
# (퍼블리시 스캔에서 로컬 경로 오탐이 나지 않도록 예시 리터럴은 쓰지 않는다.)
to_win_path() {
  local p="$1"
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$p"
    return
  fi
  # 폴백: /c/foo → C:/foo
  if [[ "$p" =~ ^/([a-zA-Z])/ ]]; then
    local d="${BASH_REMATCH[1]}"
    printf '%s:%s\n' "${d^^}" "${p:2}"
  else
    printf '%s\n' "$p"
  fi
}

if [[ -n "$AGENT_NAME" ]]; then
  AGENT_FILE="$AGENTS_DIR/$AGENT_NAME.md"
  if [[ ! -f "$AGENT_FILE" ]]; then
    echo "[run-agent] ERROR: 에이전트 파일 없음: $AGENT_FILE" >&2
    exit 1
  fi
  AGENT_FILE_WIN=$(to_win_path "$AGENT_FILE")
  # 경로는 argv 로 전달 — 셸 보간을 없애 경로 안의 역슬래시가 JS 이스케이프로 깨지는 것도 함께 차단
  if ! AGENT_BODY=$("$NODE" -e '
const fs = require("fs");
const c = fs.readFileSync(process.argv[1], "utf8");
process.stdout.write(c.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, ""));
' "$AGENT_FILE_WIN"); then
    echo "[run-agent] ERROR: 에이전트 파일 읽기 실패(node): $AGENT_FILE_WIN (원본: $AGENT_FILE)" >&2
    exit 1
  fi
  # 빈 본문으로 진행하면 claude 가 빈 --system-prompt 로 정상 종료해 '조용한 실패'가 된다 → 여기서 차단
  if [[ -z "$AGENT_BODY" ]]; then
    echo "[run-agent] ERROR: 에이전트 본문이 비어 있음: $AGENT_FILE_WIN (원본: $AGENT_FILE)" >&2
    exit 1
  fi
  exec claude "${NEW_ARGS[@]}" --system-prompt "$AGENT_BODY"
else
  exec claude "${NEW_ARGS[@]}"
fi
