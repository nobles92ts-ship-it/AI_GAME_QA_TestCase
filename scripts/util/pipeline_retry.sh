#!/usr/bin/env bash
# pipeline_retry.sh — 에러 유형별 재시도 래퍼 (S1/S4/S6)
#
# 사용법:
#   bash pipeline_retry.sh <logfile> -- <command> [args...]
#
# 예시:
#   bash pipeline_retry.sh "$SPECS/feature/step4_stderr.log" -- \
#     "$NODE" "$CLI_JS" -p --agent tc-writer-v2 --model haiku ...
#
# 종료 코드:
#   0   성공
#   1   일반 실패 (재시도 후에도 실패)
#   10  OAuth/토큰 만료 (재시도 금지, 재인증 필요)
#   11  쿼터 초과 (3회 backoff 후에도 실패)
#
# 에러 분류:
#   쿼터 (429 / RESOURCE_EXHAUSTED / rateLimit / 503) → 30/60/120초 backoff 최대 3회
#   토큰 만료 (OAuth / invalid_grant / 401 / UNAUTHENTICATED / invalid_token) → 즉시 중단
#   네트워크 (ETIMEDOUT / ECONNRESET / 500 / 502) → 10/30초 backoff 최대 2회
#   기타 exit ≠ 0 → 1회 재시도 즉시

set -o pipefail

# ─────────────────────────────────────
# --self-test: 환경 의존성 & 에러 분류 로직 검증 (실행 없이)
# ─────────────────────────────────────
if [ "${1:-}" = "--self-test" ]; then
    PASS=0; FAIL=0
    check() { if eval "$2"; then PASS=$((PASS+1)); echo "  ✅ $1"; else FAIL=$((FAIL+1)); echo "  ❌ $1"; fi; }

    echo "── pipeline_retry.sh 자기 검증 ──"
    check "claude CLI PATH"     'command -v claude >/dev/null'
    check "node.exe 실행가능"   '[ -x "C:/Users/Admin/Downloads/AI_AntiGravity/node-v20.11.1-win-x64/node.exe" ]'
    check "bash grep 지원"      'echo "429 RESOURCE_EXHAUSTED" | grep -qE "429|RESOURCE_EXHAUSTED"'
    check "tmp 디렉터리 쓰기"   'touch "C:/Users/Admin/AppData/Local/Temp/.tcv2_selftest" && rm -f "C:/Users/Admin/AppData/Local/Temp/.tcv2_selftest"'

    # 에러 분류 함수 dry-run
    TMP_LOG="C:/Users/Admin/AppData/Local/Temp/.tcv2_classify_$$"
    echo "HTTP 429 Too Many Requests" > "$TMP_LOG"
    grep -qE "429|RESOURCE_EXHAUSTED|Quota exceeded|rateLimit|userRateLimitExceeded|503" "$TMP_LOG" && check "분류: quota 감지" 'true' || check "분류: quota 감지" 'false'
    echo "invalid_grant OAuth error" > "$TMP_LOG"
    grep -qE "OAuth|invalid_grant|401 Unauthorized|UNAUTHENTICATED|invalid_token|Invalid API key|Fix external API key|Please run /login|authentication_error" "$TMP_LOG" && check "분류: token 감지 (OAuth)" 'true' || check "분류: token 감지 (OAuth)" 'false'
    echo "Invalid API key · Fix external API key" > "$TMP_LOG"
    grep -qE "OAuth|invalid_grant|401 Unauthorized|UNAUTHENTICATED|invalid_token|Invalid API key|Fix external API key|Please run /login|authentication_error" "$TMP_LOG" && check "분류: token 감지 (API key)" 'true' || check "분류: token 감지 (API key)" 'false'
    echo "ECONNRESET by peer" > "$TMP_LOG"
    grep -qE "ETIMEDOUT|ECONNRESET|500 Internal|502 Bad Gateway|ENETUNREACH" "$TMP_LOG" && check "분류: network 감지" 'true' || check "분류: network 감지" 'false'
    rm -f "$TMP_LOG"

    echo "결과: PASS=$PASS FAIL=$FAIL"
    [ "$FAIL" -gt 0 ] && exit 1 || exit 0
fi

if [ "$#" -lt 3 ]; then
    echo "사용법: bash pipeline_retry.sh <logfile> -- <command> [args...]" >&2
    echo "       bash pipeline_retry.sh --self-test" >&2
    exit 1
fi

LOGFILE="$1"
shift
if [ "$1" != "--" ]; then
    echo "[pipeline_retry] 두 번째 인자는 '--' 여야 합니다" >&2
    exit 1
fi
shift

RETRY_LOG="${LOGFILE%.log}_retry.log"
RETRY2_LOG="${LOGFILE%.log}_retry2.log"
RETRY3_LOG="${LOGFILE%.log}_retry3.log"

classify_error() {
    local log="$1"
    if grep -qE "OAuth|invalid_grant|401 Unauthorized|UNAUTHENTICATED|invalid_token|Invalid API key|Fix external API key|Please run /login|authentication_error" "$log" 2>/dev/null; then
        echo "token"
    elif grep -qE "429|RESOURCE_EXHAUSTED|Quota exceeded|rateLimit|userRateLimitExceeded|503" "$log" 2>/dev/null; then
        echo "quota"
    elif grep -qE "ETIMEDOUT|ECONNRESET|500 Internal|502 Bad Gateway|ENETUNREACH" "$log" 2>/dev/null; then
        echo "network"
    else
        echo "other"
    fi
}

# 첫 시도
"$@" 2>"$LOGFILE"
RC=$?
if [ $RC -eq 0 ]; then
    exit 0
fi

TYPE=$(classify_error "$LOGFILE")
echo "[pipeline_retry] 첫 시도 실패 (exit $RC, type=$TYPE)" >&2

case "$TYPE" in
    token)
        echo "[pipeline_retry] OAuth/토큰 만료 감지 — 재시도 금지. 재인증 후 재개하세요." >&2
        exit 10
        ;;
    quota)
        # 30/60/120 backoff 최대 3회
        for i in 1 2 3; do
            case $i in
                1) DELAY=30; RLOG="$RETRY_LOG" ;;
                2) DELAY=60; RLOG="$RETRY2_LOG" ;;
                3) DELAY=120; RLOG="$RETRY3_LOG" ;;
            esac
            echo "[pipeline_retry] 쿼터 초과 — ${DELAY}초 대기 후 재시도 (#$i)" >&2
            sleep "$DELAY"
            "$@" 2>"$RLOG"
            RC=$?
            if [ $RC -eq 0 ]; then
                exit 0
            fi
            NEWTYPE=$(classify_error "$RLOG")
            if [ "$NEWTYPE" = "token" ]; then
                echo "[pipeline_retry] 재시도 중 토큰 만료 감지 — 중단" >&2
                exit 10
            fi
        done
        echo "[pipeline_retry] 쿼터 초과 3회 재시도 실패" >&2
        exit 11
        ;;
    network)
        # 10/30 backoff 최대 2회
        for i in 1 2; do
            case $i in
                1) DELAY=10; RLOG="$RETRY_LOG" ;;
                2) DELAY=30; RLOG="$RETRY2_LOG" ;;
            esac
            echo "[pipeline_retry] 네트워크 오류 — ${DELAY}초 대기 후 재시도 (#$i)" >&2
            sleep "$DELAY"
            "$@" 2>"$RLOG"
            RC=$?
            if [ $RC -eq 0 ]; then
                exit 0
            fi
        done
        echo "[pipeline_retry] 네트워크 오류 재시도 실패" >&2
        exit 1
        ;;
    other)
        # 1회 즉시 재시도
        echo "[pipeline_retry] 일반 오류 — 즉시 1회 재시도" >&2
        "$@" 2>"$RETRY_LOG"
        RC=$?
        if [ $RC -eq 0 ]; then
            exit 0
        fi
        echo "[pipeline_retry] 재시도 실패 (exit $RC)" >&2
        exit 1
        ;;
esac
