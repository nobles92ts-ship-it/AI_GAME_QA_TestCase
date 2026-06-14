#!/usr/bin/env bash
# resume_logic_test.sh — tc-팀-v2 재개 로직 8개 분기 단위 테스트
#
# 사용법: bash resume_logic_test.sh
# 종료 코드: 0 = 모든 분기 통과 / 1 = 실패

set -u
# Windows-native 경로 사용 (node.exe가 POSIX /tmp를 C:\tmp로 오해석하는 이슈 회피)
TMPROOT="~/AppData/Local/Temp/tcv2-resume-$$"
mkdir -p "$TMPROOT"
trap 'rm -rf "$TMPROOT"' EXIT

PASS=0; FAIL=0
declare -a FAILED_CASES

# 재개 로직 평가 함수 (tc-팀-v2.md "재개(Resume) 로직" 섹션 미러)
eval_resume() {
    local SPEC="$1"
    if ls "$SPEC"/review_*_v2.md 2>/dev/null | head -1 | grep -q . \
       && [ -f "$SPEC/step6_result.json" ] \
       && node -e "const r=JSON.parse(require('fs').readFileSync('$SPEC/step6_result.json','utf8'));process.exit(r.status==='success'?0:1)" 2>/dev/null; then
        echo "DONE"
    elif [ -f "$SPEC/tc_after_fix1.json" ]; then echo "STEP6"
    elif ls "$SPEC"/review_*.md 2>/dev/null | grep -v "_v2\.md" | head -1 | grep -q .; then echo "STEP6"
    elif [ -f "$SPEC/tc_snapshot.json" ] || grep -qE "^TAB_NAME=.+" "$SPEC/sheet_info.txt" 2>/dev/null; then echo "STEP5"
    elif [ -f "$SPEC/tc_design.md" ] && [ -f "$SPEC/design_review.md" ]; then
        local NF=$(node -e "try{const r=JSON.parse(require('fs').readFileSync('$SPEC/step2_result.json','utf8'));console.log(r.needs_fix?'true':'false')}catch{console.log('false')}")
        [ "$NF" = "true" ] && echo "STEP3" || echo "STEP4"
    elif [ -f "$SPEC/tc_design.md" ]; then echo "STEP2"
    elif [ -f "$SPEC/confluence_raw.md" ]; then echo "STEP1"
    else echo "NEW"
    fi
}

assert_branch() {
    local NAME="$1" EXPECTED="$2" ACTUAL="$3"
    if [ "$ACTUAL" = "$EXPECTED" ]; then
        PASS=$((PASS+1)); echo "  ✅ $NAME → $ACTUAL"
    else
        FAIL=$((FAIL+1)); FAILED_CASES+=("$NAME (expected=$EXPECTED, got=$ACTUAL)")
        echo "  ❌ $NAME (expected=$EXPECTED, got=$ACTUAL)"
    fi
}

# CASE 1: NEW (빈 디렉터리)
SPEC="$TMPROOT/c1"; mkdir -p "$SPEC"
assert_branch "CASE1 신규" "NEW" "$(eval_resume "$SPEC")"

# CASE 2: STEP1 재개 (confluence_raw.md만)
SPEC="$TMPROOT/c2"; mkdir -p "$SPEC"; touch "$SPEC/confluence_raw.md"
assert_branch "CASE2 STEP1 재개" "STEP1" "$(eval_resume "$SPEC")"

# CASE 3: STEP2 재개 (tc_design.md만)
SPEC="$TMPROOT/c3"; mkdir -p "$SPEC"; touch "$SPEC/confluence_raw.md" "$SPEC/tc_design.md"
assert_branch "CASE3 STEP2 재개" "STEP2" "$(eval_resume "$SPEC")"

# CASE 4: STEP3 재개 (needs_fix=true)
SPEC="$TMPROOT/c4"; mkdir -p "$SPEC"
touch "$SPEC/confluence_raw.md" "$SPEC/tc_design.md" "$SPEC/design_review.md"
echo '{"status":"success","needs_fix":true}' > "$SPEC/step2_result.json"
assert_branch "CASE4 STEP3 재개 (needs_fix=true)" "STEP3" "$(eval_resume "$SPEC")"

# CASE 5: STEP4 재개 (needs_fix=false)
SPEC="$TMPROOT/c5"; mkdir -p "$SPEC"
touch "$SPEC/confluence_raw.md" "$SPEC/tc_design.md" "$SPEC/design_review.md"
echo '{"status":"success","needs_fix":false}' > "$SPEC/step2_result.json"
assert_branch "CASE5 STEP4 재개 (needs_fix=false)" "STEP4" "$(eval_resume "$SPEC")"

# CASE 6: STEP5 재개 (tc_snapshot.json)
SPEC="$TMPROOT/c6"; mkdir -p "$SPEC"
touch "$SPEC/confluence_raw.md" "$SPEC/tc_design.md" "$SPEC/tc_snapshot.json"
assert_branch "CASE6 STEP5 재개 (snapshot)" "STEP5" "$(eval_resume "$SPEC")"

# CASE 7: STEP6 재개 (review_*.md, v2 아님)
SPEC="$TMPROOT/c7"; mkdir -p "$SPEC"
touch "$SPEC/confluence_raw.md" "$SPEC/tc_design.md" "$SPEC/tc_snapshot.json" "$SPEC/review_탭A.md"
assert_branch "CASE7 STEP6 재개" "STEP6" "$(eval_resume "$SPEC")"

# CASE 8: STEP6 재개 (tc_after_fix1.json)
SPEC="$TMPROOT/c8"; mkdir -p "$SPEC"
touch "$SPEC/confluence_raw.md" "$SPEC/tc_design.md" "$SPEC/tc_snapshot.json" "$SPEC/review_탭A.md" "$SPEC/tc_after_fix1.json"
assert_branch "CASE8 STEP6 재개" "STEP6" "$(eval_resume "$SPEC")"

# CASE 9: DONE (review_v2 + step6 success)
SPEC="$TMPROOT/c9"; mkdir -p "$SPEC"
touch "$SPEC/confluence_raw.md" "$SPEC/tc_design.md" "$SPEC/tc_snapshot.json" \
      "$SPEC/review_탭A.md" "$SPEC/tc_after_fix1.json" "$SPEC/review_탭A_v2.md"
echo '{"status":"success"}' > "$SPEC/step6_result.json"
assert_branch "CASE9 DONE" "DONE" "$(eval_resume "$SPEC")"

# CASE 10: DONE 미완성 (step6 실패) → STEP6 재개 우선
SPEC="$TMPROOT/c10"; mkdir -p "$SPEC"
touch "$SPEC/confluence_raw.md" "$SPEC/tc_design.md" "$SPEC/tc_snapshot.json" \
      "$SPEC/review_탭A.md" "$SPEC/tc_after_fix1.json" "$SPEC/review_탭A_v2.md"
echo '{"status":"failed"}' > "$SPEC/step6_result.json"
assert_branch "CASE10 STEP6 실패→재개" "STEP6" "$(eval_resume "$SPEC")"

echo ""
echo "════════════════════════════════"
echo "결과: PASS=$PASS / FAIL=$FAIL"
if [ "$FAIL" -gt 0 ]; then
    echo "실패 케이스:"
    for c in "${FAILED_CASES[@]}"; do echo "  - $c"; done
    exit 1
fi
exit 0
