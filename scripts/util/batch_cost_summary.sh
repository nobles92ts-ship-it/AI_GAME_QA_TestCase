#!/usr/bin/env bash
# batch_cost_summary.sh — 현재 배치의 누적 비용 집계
#
# 사용법: bash batch_cost_summary.sh
# 출력: 기능별 소계 + 배치 누적 + 임계값 경고
#
# 환경: STATE_FILE의 currentBatch 배열 기반
# 각 기능 폴더의 cost.log (라인 형식: "YYYY-MM-DD HH:MM | STEP N | model | $X.XX")

STATE_FILE="${STATE_FILE:-{WORK_ROOT}/team/state.json}"
SPECS="${SPECS:-{WORK_ROOT}/team/specs}"
NODE="${NODE:-{NODE_PATH}}"

BATCH_LIMIT=30.00
FEATURE_LIMIT=10.00

[ -f "$STATE_FILE" ] || { echo "[cost] state.json 없음"; exit 0; }

# currentBatch 배열 파싱
BATCH_FEATURES=$("$NODE" -e "
const d=JSON.parse(require('fs').readFileSync('$STATE_FILE','utf8'));
console.log((d.currentBatch||[]).join('\n'));
" 2>/dev/null)

if [ -z "$BATCH_FEATURES" ]; then
    echo "[cost] 활성 배치 없음"
    exit 0
fi

TOTAL=0.00
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "배치 누적 비용 현황"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
printf "%-40s %10s\n" "기능" "비용($)"
printf "%-40s %10s\n" "────" "────"

while IFS= read -r FEATURE; do
    [ -z "$FEATURE" ] && continue
    LOG="$SPECS/$FEATURE/cost.log"
    if [ -f "$LOG" ]; then
        SUB=$(awk -F'\\$' '{sum+=$2} END {printf "%.2f", sum+0}' "$LOG")
    else
        SUB="0.00"
    fi
    printf "%-40s %10s\n" "$FEATURE" "$SUB"
    # 단일 기능 임계값 체크
    OVER_FEATURE=$(awk -v a="$SUB" -v b="$FEATURE_LIMIT" 'BEGIN{print (a>b)?1:0}')
    [ "$OVER_FEATURE" = "1" ] && echo "    ⚠️  단일 기능 \$$FEATURE_LIMIT 초과 — 루프 의심"
    TOTAL=$(awk -v t="$TOTAL" -v s="$SUB" 'BEGIN{printf "%.2f", t+s}')
done <<< "$BATCH_FEATURES"

echo "────────────────────────────────────"
printf "%-40s %10s\n" "배치 총합" "\$$TOTAL"

OVER_BATCH=$(awk -v a="$TOTAL" -v b="$BATCH_LIMIT" 'BEGIN{print (a>b)?1:0}')
if [ "$OVER_BATCH" = "1" ]; then
    echo "ℹ️  배치 누적 \$$BATCH_LIMIT 초과 (정지 기능 OFF — 계속 진행)"
    # 정지 기능 비활성화: exit 2 제거됨. 정보성 로그만 출력.
fi

REMAIN=$(awk -v l="$BATCH_LIMIT" -v t="$TOTAL" 'BEGIN{printf "%.2f", l-t}')
echo "잔여 예산: \$$REMAIN / \$$BATCH_LIMIT"
exit 0
