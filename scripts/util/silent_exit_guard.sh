#!/usr/bin/env bash
# silent_exit_guard.sh — claude CLI silent exit 감시 + backoff 자동 재호출
#
# 사용법:
#   bash silent_exit_guard.sh <step_result.json 경로> -- <command...>
#
# 동작:
#   1. 호출 직전 step_result.json mtime 기록
#   2. command 실행 → exit 0 이면 step_result.json mtime 검사
#   3. mtime 갱신 안 됨 = silent exit → backoff 대기 후 재호출 (최대 RETRY_MAX회)
#   4. 모든 재시도 후에도 미갱신 → exit 12 (silent exit 확정)
#
# 재시도 정책 (2026-05-27 보강):
#   - 기존: 5초 × 1회 (일시장애 가시기 전 재호출 → 동일 실패 빈번)
#   - 변경: backoff 30/60/120초 × 최대 3회. fixer turn 조기종료 등
#           일시 silent exit를 자동복구하기 위함.
#   - 환경변수로 조정 가능: SILENT_GUARD_BACKOFFS="30 60 120"
#
# 종료 코드:
#   0   성공 (파일 갱신됨)
#   N   command 자체 실패 (그대로 전달)
#   12  silent exit (모든 재시도 후에도 미갱신)

set -o pipefail

# backoff 대기 시간(초) 목록 — 재시도 횟수 = 항목 수
BACKOFFS=(${SILENT_GUARD_BACKOFFS:-30 60 120})

if [ "$#" -lt 3 ]; then
    echo "사용법: bash silent_exit_guard.sh <step_result.json 경로> -- <command> [args...]" >&2
    exit 1
fi

RESULT_FILE="$1"
shift
if [ "$1" != "--" ]; then
    echo "[silent_exit_guard] 두 번째 인자는 '--' 여야 합니다" >&2
    exit 1
fi
shift

mtime_or_zero() {
    if [ -f "$1" ]; then
        stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null || echo 0
    else
        echo 0
    fi
}

BEFORE_MTIME=$(mtime_or_zero "$RESULT_FILE")
START_TIME=$(date +%s)

# 1차 시도
"$@"
RC=$?

# command 자체 실패 시 그대로 전달
if [ $RC -ne 0 ]; then
    exit $RC
fi

AFTER_MTIME=$(mtime_or_zero "$RESULT_FILE")

# 갱신 감지: mtime이 START_TIME 이후로 바뀌었는가
if [ "$AFTER_MTIME" -ge "$START_TIME" ] && [ "$AFTER_MTIME" -gt "$BEFORE_MTIME" ]; then
    exit 0
fi

# silent exit 의심 — backoff 재시도
echo "[silent_exit_guard] step_result.json 미갱신 감지 — backoff 재시도 시작 (최대 ${#BACKOFFS[@]}회)" >&2
echo "[silent_exit_guard] BEFORE_MTIME=$BEFORE_MTIME START_TIME=$START_TIME AFTER_MTIME=$AFTER_MTIME" >&2

ATTEMPT=0
for WAIT in "${BACKOFFS[@]}"; do
    ATTEMPT=$((ATTEMPT+1))
    echo "[silent_exit_guard] ${WAIT}초 대기 후 재시도 ${ATTEMPT}/${#BACKOFFS[@]}" >&2
    sleep "$WAIT"

    "$@"
    RC=$?
    if [ $RC -ne 0 ]; then
        exit $RC
    fi

    AFTER_MTIME=$(mtime_or_zero "$RESULT_FILE")
    if [ "$AFTER_MTIME" -ge "$START_TIME" ] && [ "$AFTER_MTIME" -gt "$BEFORE_MTIME" ]; then
        echo "[silent_exit_guard] 재시도 ${ATTEMPT}회차 성공 — step_result.json 갱신됨" >&2
        exit 0
    fi
    echo "[silent_exit_guard] 재시도 ${ATTEMPT}회차 미갱신 (AFTER_MTIME=$AFTER_MTIME)" >&2
done

echo "[silent_exit_guard] ${#BACKOFFS[@]}회 재시도 후에도 미갱신 — silent exit 확정 (exit 12)" >&2
exit 12
