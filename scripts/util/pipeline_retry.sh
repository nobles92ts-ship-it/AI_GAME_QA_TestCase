#!/usr/bin/env bash
# pipeline_retry.sh — 에러 유형별 재시도 래퍼 (S1/S4/S6)
#
# 사용법:
#   bash pipeline_retry.sh <logfile> -- <command> [args...]
#
# 예시:
#   bash pipeline_retry.sh "$SPECS/feature/step4_stderr.log" -- \
#     "$NODE" "$CLI_JS" -p --agent tc-team-designer --model haiku ...
#
# 종료 코드:
#   0   성공
#   1   일반 실패 (재시도 후에도 실패)
#   10  OAuth/토큰 만료 (재시도 금지, 재인증 필요)
#   11  쿼터 초과 (3회 backoff 후에도 실패)
#
# 에러 분류:
#   토큰 만료 (OAuth / invalid_grant / 401 / UNAUTHENTICATED / invalid_token) → 즉시 중단
#   세션 한도 (You've hit your session limit / usage limit reached) → 즉시 중단(rc=11)
#   쿼터 (429 / RESOURCE_EXHAUSTED / rateLimit / 503) → 30/60/120초 backoff 최대 3회
#   네트워크 (ETIMEDOUT / ECONNRESET / 500 / 502) → 10/30초 backoff 최대 2회
#   기타 exit ≠ 0 → 1회 재시도 즉시
#
# ※ 분류는 stderr + stdout 양쪽을 본다. claude CLI 의 한도 배너
#   ("You've hit your session limit · resets 4:20pm")는 stdout 으로만 나오기 때문에
#   stderr 만 보면 type=other 로 오분류된다 (2026-08-07 실사고).

set -o pipefail

# ─────────────────────────────────────
# --self-test: 환경 의존성 & 에러 분류 로직 검증 (실행 없이)
# ─────────────────────────────────────
if [ "${1:-}" = "--self-test" ]; then
    PASS=0; FAIL=0
    check() { if eval "$2"; then PASS=$((PASS+1)); echo "  ✅ $1"; else FAIL=$((FAIL+1)); echo "  ❌ $1"; fi; }

    echo "── pipeline_retry.sh 자기 검증 ──"
    check "claude CLI PATH"     'command -v claude >/dev/null'
    check "node 실행가능"       'command -v node >/dev/null'
    check "bash grep 지원"      'echo "429 RESOURCE_EXHAUSTED" | grep -qE "429|RESOURCE_EXHAUSTED"'
    check "tmp 디렉터리 쓰기"   'touch "${TMPDIR:-${TEMP:-/tmp}}/.tcv2_selftest" && rm -f "${TMPDIR:-${TEMP:-/tmp}}/.tcv2_selftest"'

    # 에러 분류 함수 dry-run
    TMP_LOG="${TMPDIR:-${TEMP:-/tmp}}/.tcv2_classify_$$"
    echo "HTTP 429 Too Many Requests" > "$TMP_LOG"
    grep -qE "429|RESOURCE_EXHAUSTED|Quota exceeded|rateLimit|userRateLimitExceeded|503" "$TMP_LOG" && check "분류: quota 감지" 'true' || check "분류: quota 감지" 'false'
    echo "invalid_grant OAuth error" > "$TMP_LOG"
    grep -qE "OAuth|invalid_grant|401 Unauthorized|401 Invalid|Failed to authenticate|Invalid authentication credentials|UNAUTHENTICATED|invalid_token|Invalid API key|Fix external API key|Please run /login|authentication_error" "$TMP_LOG" && check "분류: token 감지 (OAuth)" 'true' || check "분류: token 감지 (OAuth)" 'false'
    echo "Invalid API key · Fix external API key" > "$TMP_LOG"
    grep -qE "OAuth|invalid_grant|401 Unauthorized|401 Invalid|Failed to authenticate|Invalid authentication credentials|UNAUTHENTICATED|invalid_token|Invalid API key|Fix external API key|Please run /login|authentication_error" "$TMP_LOG" && check "분류: token 감지 (API key)" 'true' || check "분류: token 감지 (API key)" 'false'
    # L4-F12 회귀 (2026-06-13 v6): "Failed to authenticate. API Error: 401 Invalid authentication credentials"가
    #   옛 정규식에 안 잡혀 type=other로 오분류 → 무의미 재시도 → 체인이 "silent" 오인. 이 문자열 필수 포착.
    echo "Failed to authenticate. API Error: 401 Invalid authentication credentials" > "$TMP_LOG"
    grep -qE "OAuth|invalid_grant|401 Unauthorized|401 Invalid|Failed to authenticate|Invalid authentication credentials|UNAUTHENTICATED|invalid_token|Invalid API key|Fix external API key|Please run /login|authentication_error" "$TMP_LOG" && check "분류: token 감지 (v6 401 Invalid auth)" 'true' || check "분류: token 감지 (v6 401 Invalid auth)" 'false'
    # 2026-08-07 실사고 회귀: 한도 배너는 stdout 으로만 나와 stderr 만 보던 옛 분류기가
    #   type=other 로 오분류 → 즉시 재시도 → exit 1 → 슬랙에 "종료코드 1"만 떠서 원인 은폐.
    echo "You've hit your session limit · resets 4:20pm (Asia/Seoul)" > "$TMP_LOG"
    grep -qE "hit your session limit|session limit ·|usage limit reached|Claude usage limit" "$TMP_LOG" && check "분류: limit 감지 (세션 한도)" 'true' || check "분류: limit 감지 (세션 한도)" 'false'
    check "PIPESTATUS 지원(stdout tee 후 rc 보존)" '(exit 7) | tee /dev/null; [ "${PIPESTATUS[0]}" = "7" ]'

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

LIMIT_RE="hit your session limit|session limit ·|usage limit reached|Claude usage limit"

classify_error() {
    # 인자: 검사할 로그 파일들 (stderr + stdout). 한도 배너는 stdout 으로만 나온다.
    if grep -qE "OAuth|invalid_grant|401 Unauthorized|401 Invalid|Failed to authenticate|Invalid authentication credentials|UNAUTHENTICATED|invalid_token|Invalid API key|Fix external API key|Please run /login|authentication_error" "$@" 2>/dev/null; then
        echo "token"
    elif grep -qE "$LIMIT_RE" "$@" 2>/dev/null; then
        echo "limit"
    elif grep -qE "429|RESOURCE_EXHAUSTED|Quota exceeded|rateLimit|userRateLimitExceeded|503" "$@" 2>/dev/null; then
        echo "quota"
    elif grep -qE "ETIMEDOUT|ECONNRESET|500 Internal|502 Bad Gateway|ENETUNREACH" "$@" 2>/dev/null; then
        echo "network"
    else
        echo "other"
    fi
}

# 시도 1회 — stdout 은 그대로 흘려보내되(체인 로그 유지) 분류용으로 사본을 남긴다.
CMD=("$@")
out_log() { echo "${1%.log}_stdout.log"; }
attempt() {
    local elog="$1" olog rc
    olog="$(out_log "$elog")"
    : > "$olog"
    "${CMD[@]}" 2>"$elog" | tee -a "$olog"
    rc=${PIPESTATUS[0]}
    return "$rc"
}

# 첫 시도
attempt "$LOGFILE"
RC=$?
if [ $RC -eq 0 ]; then
    exit 0
fi

TYPE=$(classify_error "$LOGFILE" "$(out_log "$LOGFILE")")
echo "[pipeline_retry] 첫 시도 실패 (exit $RC, type=$TYPE)" >&2

case "$TYPE" in
    token)
        echo "[pipeline_retry] OAuth/토큰 만료 감지 — 재시도 금지. 재인증 후 재개하세요." >&2
        exit 10
        ;;
    limit)
        # 구독 세션 한도는 리셋까지 수십 분~수 시간 — backoff 재시도는 무의미하고
        # 실패 원인만 가린다. 리셋 시각이 적힌 원문 줄을 체인 로그로 올려보낸다.
        BANNER=$(grep -hoE "[^\"]*(${LIMIT_RE})[^\"]*" "$LOGFILE" "$(out_log "$LOGFILE")" 2>/dev/null | head -1 | tr -d '\r')
        echo "[STOP:한도] 구독 세션 한도 소진 — 재시도 없이 중단. ${BANNER:-리셋 시각은 CLI 출력 참조}" >&2
        exit 11
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
            attempt "$RLOG"
            RC=$?
            if [ $RC -eq 0 ]; then
                exit 0
            fi
            NEWTYPE=$(classify_error "$RLOG" "$(out_log "$RLOG")")
            if [ "$NEWTYPE" = "token" ]; then
                echo "[pipeline_retry] 재시도 중 토큰 만료 감지 — 중단" >&2
                exit 10
            fi
            if [ "$NEWTYPE" = "limit" ]; then
                BANNER=$(grep -hoE "[^\"]*(${LIMIT_RE})[^\"]*" "$RLOG" "$(out_log "$RLOG")" 2>/dev/null | head -1 | tr -d '\r')
                echo "[STOP:한도] 재시도 중 세션 한도 소진 — 중단. ${BANNER:-리셋 시각은 CLI 출력 참조}" >&2
                exit 11
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
            attempt "$RLOG"
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
        attempt "$RETRY_LOG"
        RC=$?
        if [ $RC -eq 0 ]; then
            exit 0
        fi
        # 첫 시도에서 못 잡힌 한도가 재시도 출력에 드러나는 경우(배너 타이밍) 여기서 승격
        if [ "$(classify_error "$RETRY_LOG" "$(out_log "$RETRY_LOG")")" = "limit" ]; then
            BANNER=$(grep -hoE "[^\"]*(${LIMIT_RE})[^\"]*" "$RETRY_LOG" "$(out_log "$RETRY_LOG")" 2>/dev/null | head -1 | tr -d '\r')
            echo "[STOP:한도] 재시도에서 세션 한도 확인 — 중단. ${BANNER:-리셋 시각은 CLI 출력 참조}" >&2
            exit 11
        fi
        echo "[pipeline_retry] 재시도 실패 (exit $RC)" >&2
        exit 1
        ;;
esac
