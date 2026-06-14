#!/usr/bin/env bash
# run_pipeline.sh — tc-v2 체인 러너 (2026-06-12, 용어 개정판: STEP 1~6 + 완료처리)
#
# 목적: STEP 사이 LLM(팀장) 턴 경유를 제거 — 시작 시퀀스→STEP 1~6→완료처리를 단일 프로세스로
#       연속 실행. 모든 분기(재진입·STEP 3 라우팅·ⓑ 복구)는 인라인 자동 해결.
#
# 정지 예외 3종 (멈추는 게 더 안전한 경우만):
#   exit 10 — 인증 만료 (사용자만 해결 가능)
#   exit 13 — 같은 STEP 재시도 한도 도달 (transition rc=2, 무한 루프 방지)
#   exit 14 — 무결성·수지 불일치 / 시트 부작용 검출 (계속하면 데이터 오염)
#   그 외 오류 exit 1
#
# 전제: specs/[기능명]/confluence_raw.md + sheet_info.txt 준비됨 (팀장이 fetch 후 호출)
# 사용: bash run_pipeline.sh --feature <기능명> --sheet-id <ID> --conf-url <URL>

set -uo pipefail

NODE="{NODE_PATH}"
UTIL="{WORK_ROOT}/scripts/util"
SPECS="{WORK_ROOT}/team/specs"
RUNAGENT="$UTIL/run-agent.sh"
RETRY="$UTIL/pipeline_retry.sh"
GUARD="$UTIL/silent_exit_guard.sh"
CLI_BASE='-p --permission-mode bypassPermissions'

FEAT="" ; SHEET_ID="" ; CONF_URL="" ; RESUME=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --feature)  FEAT="$2"; shift 2 ;;
    --sheet-id) SHEET_ID="$2"; shift 2 ;;
    --conf-url) CONF_URL="$2"; shift 2 ;;
    --resume-from) RESUME="$2"; shift 2 ;;
    *) echo "알 수 없는 인자: $1" >&2; exit 1 ;;
  esac
done
[[ -n "$FEAT" && -n "$SHEET_ID" ]] || { echo "사용법: --feature <명> --sheet-id <ID> [--conf-url <URL>] [--resume-from step3-blocker|step4|step5|step6|final]" >&2; exit 1; }

# 정지 예외 후 구간 재개 (--resume-from): 시작 시퀀스·앞 STEP 스킵, 산출물은 specs 기존 파일 사용
START=0
case "$RESUME" in
  "")            START=0 ;;
  step3-blocker) START=3 ;;   # STEP 4 blocker 정지 후: STEP 3(blocker) → 4 → 5 → 6 → 완료처리
  step4)         START=4 ;;
  step5)         START=5 ;;
  step6)         START=6 ;;
  final)         START=7 ;;
  *) echo "잘못된 --resume-from: $RESUME (step3-blocker|step4|step5|step6|final)" >&2; exit 1 ;;
esac

SPEC="$SPECS/$FEAT"
TAB="$FEAT"
CHAIN_LOG="$SPEC/chain.log"
[[ -f "$SPEC/confluence_raw.md" ]] || { echo "[CHAIN] confluence_raw.md 없음 — 셋업 먼저" >&2; exit 1; }

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$CHAIN_LOG"; }
stop_auth()      { log "[STOP:인증] $1 — 재인증 후 재실행"; exit 10; }
stop_attempts()  { log "[STOP:한도] $1 — 카운터 확인 후 재실행"; exit 13; }
stop_integrity() { log "[STOP:무결성] $1 — 사람 확인 필요 (백업탭 보존됨)"; exit 14; }

# step_result 판정: ok / silent / fail:<error>
check_step() { # $1=기대 step
  "$NODE" -e "
const fs=require('fs');
try{
  const r=JSON.parse(fs.readFileSync('$SPEC/step_result.json','utf8'));
  if(r.step!==$1){console.log('silent');process.exit(0);}
  if(r.status!=='success'){console.log('fail:'+(r.error||''));process.exit(0);}
  console.log('ok');
}catch(e){console.log('silent');}
"
}

do_transition() { # state round prev attempts_file attempts_max(optional)
  local state="$1" round="$2" prev="$3" afile="${4:-}" amax="${5:-}"
  local args=(--feature "$FEAT" --state "$state" --review-round "$round" --sheet-id "$SHEET_ID" --tab "$TAB")
  [[ -n "$prev" ]] && args+=(--prev-step "$prev")
  [[ -n "$afile" ]] && args+=(--attempts-file "$afile" --attempts-max "$amax")
  bash "$UTIL/transition.sh" "${args[@]}" >>"$CHAIN_LOG" 2>&1
  local rc=$?
  [[ $rc -eq 2 ]] && stop_attempts "transition $state attempts 한도"
  [[ $rc -ne 0 ]] && { log "[CHAIN] transition $state rc=$rc"; exit 1; }
  return 0
}

# ── 시작 시퀀스 ──────────────────────────────────────────────────────────────
if [[ $START -eq 0 || ! -f "$SPEC/.pipeline_start_epoch" ]]; then date +%s > "$SPEC/.pipeline_start_epoch"; fi
if [[ $START -eq 0 ]]; then log "[CHAIN] 시작 — $FEAT (체인 모드)"; else log "[CHAIN] 재개 — $FEAT (resume-from=$RESUME)"; fi

if [[ $START -eq 0 ]]; then
FEATURE_NAME="$FEAT" "$NODE" -e "
const fs=require('fs');const f='{WORK_ROOT}/team/state.json';
const d=fs.existsSync(f)?JSON.parse(fs.readFileSync(f,'utf8')):{specs:[]};
const feat=process.env.FEATURE_NAME;
const allDone=!d.specs.length||d.specs.every(s=>s.state==='done');
if(allDone)d.currentBatch=[];
d.currentBatch=(d.currentBatch||[]).filter(x=>x&&typeof x==='string');
if(!d.currentBatch.includes(feat))d.currentBatch.push(feat);
fs.writeFileSync(f,JSON.stringify(d,null,2));
" >>"$CHAIN_LOG" 2>&1

printf '[{"feature":"%s","confluence":"%s"}]\n' "$FEAT" "${CONF_URL:-}" > "$SPECS/.kickoff_items.json"
"$NODE" "$UTIL/send_slack_tc_request.js" --items "$SPECS/.kickoff_items.json" \
  --sheet "https://docs.google.com/spreadsheets/d/$SHEET_ID/edit" --dedup-dir "$SPECS" >>"$CHAIN_LOG" 2>&1 \
  && log "[SLACK] 착수 공지 OK" || log "[SLACK][경고] 실패 — 계속"
fi

LOCK="$SPEC/.pipeline.lock"
[[ -f "$LOCK" ]] && "$NODE" -e "require('fs').rmSync(process.argv[1],{force:true})" "$LOCK"
date +%s > "$LOCK"
[[ $START -eq 0 ]] && do_transition designing 0 ""

# ── STEP 1 설계 (opus) ───────────────────────────────────────────────────────
if [[ $START -le 1 ]]; then
log "[STEP 1] 설계 시작"
HANDOFF="## HANDOFF
- 기능명: $FEAT
- STEP: 1 (step_result.json의 step 필드에 그대로 기재)
- 기획서 원문 파일: $SPEC/confluence_raw.md
- Confluence URL: ${CONF_URL:-} (참조용)
- specs 경로: $SPEC

## 작업 지시
confluence_raw.md 읽어 analysis.md + tc_design.md 생성 → 직변환 사전 게이트(tc-설계.md Step 11.5, exit 0 필수) → 드라이브 업로드.
tc-학습.md 활성 설계 패턴 반영 필수 — 특히 P-18(상태이상·연출 상호작용 4유형), P-19(서술형 섹션을 대조표에 분해), P-20(BVA 상·하한 분리, 통합 1건 금지).
Confluence MCP 재호출 금지."
bash "$GUARD" "$SPEC/step_result.json" -- bash -c "
RUNAGENT_DEBUG_FILE='$SPEC/step1_debug.log' bash '$RETRY' '$SPEC/step1_stderr.log' -- \
bash '$RUNAGENT' $CLI_BASE --model opus --effort medium --agent tc-designer-v2 \"\$0\"" "$HANDOFF" >>"$CHAIN_LOG" 2>&1
rc=$?
[[ $rc -eq 10 ]] && stop_auth "STEP 1"
[[ $rc -eq 12 ]] && stop_attempts "STEP 1 silent exit 3회 (GUARD)"
[[ "$(check_step 1)" == "ok" ]] || { log "[STEP 1] 실패: $(check_step 1)"; exit 1; }
log "[STEP 1] 완료"
fi

# ── STEP 2 설계검수 (sonnet) ─────────────────────────────────────────────────
NEEDS_FIX=0; GAP=0
if [[ $START -le 2 ]]; then
do_transition design_reviewing 0 1
# 전개기 완전성 게이트 (결정론 floor) — candidates.json 있을 때만, 비차단(advisory)
GATE_LINE="- (전개기 게이트 미산출 — candidates.json 없음)"
if [[ -f "$SPEC/candidates.json" ]]; then
  "$NODE" "$UTIL/expander/coverage_gate.js" "$SPEC/candidates.json" "$SPEC/tc_design.md" \
    --out "$SPEC/coverage_gaps.json" >>"$CHAIN_LOG" 2>&1 \
    || log "[STEP 2][경고] coverage_gate 실패 — 비차단 계속"
  GATE_LINE="- 전개기 완전성 게이트: $SPEC/coverage_gaps.json (gaps = 결정론 바닥 미충족 잠재 누락 — 각 건 원문 대비 확인 후 케이스 추가(HIGH) 또는 근거 기각(⊘). C-12 1:1 매핑표 기계 사전 패스)"
fi
log "[STEP 2] 설계검수 시작"
HANDOFF="## HANDOFF
- 기능명: $FEAT
- specs 경로: $SPEC
- 분석 파일: $SPEC/analysis.md
- 설계 파일: $SPEC/tc_design.md
- 기획서 원문 파일: $SPEC/confluence_raw.md
$GATE_LINE
- ⚠ C-05 분모 완전성 교차 시 tc-학습.md P-18·P-19·P-20으로 원문 대비 누락 확인."
bash "$GUARD" "$SPEC/step_result.json" -- bash -c "
RUNAGENT_DEBUG_FILE='$SPEC/step2_debug.log' bash '$RETRY' '$SPEC/step2_stderr.log' -- \
bash '$RUNAGENT' $CLI_BASE --model sonnet --agent tc-설계검수-v2 \"\$0\"" "$HANDOFF" >>"$CHAIN_LOG" 2>&1
rc=$?
[[ $rc -eq 10 ]] && stop_auth "STEP 2"
[[ $rc -eq 12 ]] && stop_attempts "STEP 2 silent exit 3회"
[[ "$(check_step 2)" == "ok" ]] || { log "[STEP 2] 실패"; exit 1; }
NEEDS_FIX=$("$NODE" -e "console.log(JSON.parse(require('fs').readFileSync('$SPEC/step_result.json','utf8')).needs_fix===true?'1':'0')")
GAP=$("$NODE" -e "console.log(JSON.parse(require('fs').readFileSync('$SPEC/step_result.json','utf8')).analysis_gap||0)")
log "[STEP 2] 완료 — needs_fix=$NEEDS_FIX analysis_gap=$GAP"
fi

# ── STEP 3 설계수정 (조건부) ──────────────────────────────────────────────────
run_step3() { # $1=모드 라벨 (review|blocker)
  local mode="$1"
  # review: 직전 STEP 2 success 복제 (prev=2) / blocker: 직전 STEP 4가 fail이므로 복제·정체성 대조 대상 아님 (prev 생략)
  # L4-F11: prev=2 하드코딩이 blocker 재진입에서 step=4 fail과 충돌 → transition CRITICAL 정지 (2026-06-12 v5 실전 적발)
  local prev=2; [[ "$mode" == "blocker" ]] && prev=""
  do_transition design_fixing 0 "$prev"
  local model_args=(--model sonnet)
  [[ "$GAP" -gt 0 ]] && model_args=(--model opus --effort medium)
  log "[STEP 3] 설계수정 시작 (mode=$mode, model=${model_args[1]})"
  HANDOFF="## HANDOFF
- 기능명: $FEAT
- STEP: 3 (step_result.json의 step 필드에 그대로 기재)
- 기획서 원문 파일: $SPEC/confluence_raw.md
- specs 경로: $SPEC
- 검수 보고서: $SPEC/design_review.md
- 직변환 차단 보고서: $SPEC/conversion_blocker.json (존재 시 최우선 — 차단 항목 외과 수정)

## 작업 지시
design_review.md 이슈(존재 시) + conversion_blocker.json 차단(존재 시) 반영하여 analysis.md/tc_design.md 외과 수정.
수정 후 직변환 사전 게이트(tc-설계.md Step 11.5) 재실행 — exit 0 필수 (배분표 3자 동치 재계산).
드라이브 재업로드."
  bash "$GUARD" "$SPEC/step_result.json" -- bash -c "
RUNAGENT_DEBUG_FILE='$SPEC/step3_debug.log' bash '$RETRY' '$SPEC/step3_stderr.log' -- \
bash '$RUNAGENT' $CLI_BASE ${model_args[*]} --agent tc-designer-v2 \"\$0\"" "$HANDOFF" >>"$CHAIN_LOG" 2>&1
  local rc=$?
  [[ $rc -eq 10 ]] && stop_auth "STEP 3"
  [[ $rc -eq 12 ]] && stop_attempts "STEP 3 silent exit 3회"
  [[ "$(check_step 3)" == "ok" ]] || { log "[STEP 3] 실패"; exit 1; }
  log "[STEP 3] 완료"
}
PREV_FOR_4=2
if [[ $START -le 2 && "$NEEDS_FIX" == "1" ]]; then run_step3 review; PREV_FOR_4=3; fi
# 재개 진입점: step3-blocker → STEP 3(blocker 모드) 선실행 / step4 직행 시 직전 설계 STEP 자동 판별
if [[ $START -eq 3 ]]; then GAP=0; run_step3 blocker; PREV_FOR_4=3; fi
if [[ $START -eq 4 && -f "$SPEC/step3_result.json" ]]; then PREV_FOR_4=3; fi

# ── STEP 4 작성 (silent exit 자동 재진입 P1-2b + blocker→STEP 3 루프) ─────────
if [[ $START -le 4 ]]; then
while true; do
  do_transition writing 0 "$PREV_FOR_4" "$SPEC/step4_attempts.txt" 3
  # S2 백업 (기존 탭 존재 시)
  TS=$(date +%Y%m%d_%H%M%S)
  if "$NODE" "$UTIL/duplicate_tab.js" "$SHEET_ID" "$TAB" "${TAB}_backup_${TS}" >>"$CHAIN_LOG" 2>&1; then
    echo "${TAB}_backup_${TS}" > "$SPEC/backup_tab.txt"
    if [[ ! -f "$SPEC/tc_snapshot.json" ]]; then
      "$NODE" "$UTIL/duplicate_tab.js" "$SHEET_ID" "$TAB" --delete >>"$CHAIN_LOG" 2>&1 || true
    fi
  else
    brc=$?; [[ $brc -eq 10 ]] && stop_auth "S2 백업"
  fi
  log "[STEP 4] 작성 시작 (attempts=$(cat "$SPEC/step4_attempts.txt" 2>/dev/null))"
  HANDOFF="## HANDOFF
- 기능명: $FEAT
- 스프레드시트 ID: $SHEET_ID
- 탭명: $TAB
- 설계 파일: $SPEC/tc_design.md
- 검수 보고서: $SPEC/design_review.md (writer 전달 지시 섹션 반영 — S4-4ⓐ)
- specs 경로: $SPEC

## 작업 지시
직변환 3단: direct_convert convert(골격) → F열 문장화 → merge → Step A2 → create_gsheet 업로드.
⚠⚠ L4-F9 분할 생성 필수: tc_f_map_part1~N.json에 25행 이하씩 Write 후 node 기계 병합. part 사이 군더더기 설명·재계획 금지.
⚠ 기본기능 행 1차 문장부터 ④영문 키/리소스명+수치 괄호 병기 + ⑤큰따옴표 인용 (L4-F8).
convert/merge exit 4 = blocker 저장 → LLM 패치 금지, step_result fail 저장 후 즉시 종료."
  RUNAGENT_DEBUG_FILE="$SPEC/step4_debug.log" bash "$RETRY" "$SPEC/step4_stderr.log" -- \
    bash "$RUNAGENT" $CLI_BASE --model sonnet --agent tc-writer-v2 "$HANDOFF" >>"$CHAIN_LOG" 2>&1
  rc=$?
  [[ $rc -eq 10 ]] && stop_auth "STEP 4"
  ST=$(check_step 4)
  if [[ "$ST" == "ok" && -f "$SPEC/tc_snapshot.json" ]]; then
    log "[STEP 4] 완료"; break
  fi
  if [[ -f "$SPEC/conversion_blocker.json" ]]; then
    log "[STEP 4] 직변환 차단 — STEP 3 재진입 (fail-closed)"
    GAP=0; run_step3 blocker; PREV_FOR_4=3; continue
  fi
  if [[ "$ST" == "silent" && ! -f "$SPEC/tc_snapshot.json" ]]; then
    # P1-2b 4조건: step≠4 ✓ / blocker 없음 ✓ / snapshot 없음 ✓ / 시트 부작용 검사
    if "$NODE" "$UTIL/duplicate_tab.js" "$SHEET_ID" "$TAB" "__p12b_probe__" >>"$CHAIN_LOG" 2>&1; then
      "$NODE" "$UTIL/duplicate_tab.js" "$SHEET_ID" "__p12b_probe__" --delete >>"$CHAIN_LOG" 2>&1 || true
      stop_integrity "STEP 4 silent exit인데 탭 존재 (부분 업로드 의심)"
    fi
    log "[STEP 4] silent exit (L4-F10) — 산출물 폐기 후 자동 재진입 (P1-2b)"
    "$NODE" -e "['tc_skeleton.json','tc_f_map.json','tc_data.json'].concat(require('fs').readdirSync('$SPEC').filter(f=>/^tc_f_map_part/.test(f))).forEach(f=>require('fs').rmSync('$SPEC/'+f,{force:true}))" >>"$CHAIN_LOG" 2>&1
    continue
  fi
  log "[STEP 4] 실패 (status=$ST)"; exit 1
done
fi

# ── STEP 5 리뷰1+수정1 ───────────────────────────────────────────────────────
if [[ $START -le 5 ]]; then
"$NODE" -e "const f='$SPEC/sheet_info.txt';const fs=require('fs');fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace(/^TAB_NAME=$/m,'TAB_NAME=$TAB'))" 2>/dev/null || true
cp "$SPEC/tc_snapshot.json" "$SPEC/_prev_step4_snap.json"
do_transition reviewing 1 4 "$SPEC/step5_attempts.txt" 3
"$NODE" "$UTIL/review_precheck.js" --round 1 --input "$SPEC/tc_snapshot.json" --design "$SPEC/tc_design.md" \
  --out "$SPEC/precheck_round1.json" >>"$CHAIN_LOG" 2>&1 || log "[WARN] precheck r1 실패 — LLM 폴백 (비차단)"
log "[STEP 5] 리뷰1+수정1 시작"
HANDOFF="## HANDOFF
- 기능명: $FEAT
- 스프레드시트 ID: $SHEET_ID
- 시트명: $TAB
- 설계 파일: $SPEC/tc_design.md
- 분석 파일: $SPEC/analysis.md
- 리뷰 차수: 1 / 유형: 구조 리뷰 + 즉시 수정 (통합)
- 리뷰 파일 저장: $SPEC/review_$FEAT.md
- 시트 스냅샷: $SPEC/tc_snapshot.json (Read 도구 사용, read_gsheet_data.js 재호출 금지)
- 기계 사전 패스: $SPEC/precheck_round1.json (있으면 기계 EVAL 재열거 금지)
- Confluence 원문: $SPEC/confluence_raw.md (MCP 재호출 금지)
- 수정 후 스냅샷 저장: $SPEC/tc_after_fix1.json (수정 1건 이상 시 의무 — I1)"
RUNAGENT_DEBUG_FILE="$SPEC/step5_debug.log" bash "$RETRY" "$SPEC/step5_stderr.log" -- \
  bash "$RUNAGENT" $CLI_BASE --model sonnet --agent tc-리뷰1수정1-v2 "$HANDOFF" >>"$CHAIN_LOG" 2>&1
rc=$?
[[ $rc -eq 10 ]] && stop_auth "STEP 5"
P5=$("$NODE" -e "
const fs=require('fs');
try{const r=JSON.parse(fs.readFileSync('$SPEC/step_result.json','utf8'));
const fresh=fs.statSync('$SPEC/step_result.json').mtimeMs>fs.statSync('$SPEC/step4_result.json').mtimeMs;
console.log(r.status==='success'&&r.review_round===1&&r.step===5&&!('fix_round'in r)&&fresh?'ok':'partial');}catch(e){console.log('partial')}")
if [[ "$P5" != "ok" ]]; then
  log "[STEP 5] 부분완료/silent — 자동 ⓑ 복구 (수지일치 게이트)"
  "$NODE" "$UTIL/step_recover.js" "$SPEC" "$SHEET_ID" "$TAB" 5 "$SPEC/_prev_step4_snap.json" >>"$CHAIN_LOG" 2>&1
  rrc=$?
  [[ $rrc -eq 3 ]] && stop_integrity "STEP 5 복구 게이트 불일치"
  [[ $rrc -ne 0 ]] && { log "[STEP 5] 복구 실패 rc=$rrc"; exit 1; }
fi
log "[STEP 5] 완료"
fi

# ── STEP 6 리뷰2+수정2 ───────────────────────────────────────────────────────
if [[ $START -le 6 ]]; then
SNAP6="$SPEC/tc_after_fix1.json"; [[ -f "$SNAP6" ]] || SNAP6="$SPEC/tc_snapshot.json"
cp "$SNAP6" "$SPEC/_prev_step5_snap.json"
do_transition reviewing_fixing 2 5 "$SPEC/step6_attempts.txt" 3
"$NODE" "$UTIL/review_precheck.js" --round 2 --input "$SNAP6" --design "$SPEC/tc_design.md" \
  --added-source "$SPEC/step5_result.json" --out "$SPEC/precheck_round2.json" >>"$CHAIN_LOG" 2>&1 || log "[WARN] precheck r2 실패 — 비차단"
log "[STEP 6] 리뷰2+수정2 시작"
HANDOFF="## HANDOFF
- 기능명: $FEAT
- 스프레드시트 ID: $SHEET_ID
- 시트명: $TAB
- 설계 파일: $SPEC/tc_design.md
- 분석 파일: $SPEC/analysis.md
- 시트 스냅샷: $SNAP6
- 이전 리뷰 파일: $SPEC/review_$FEAT.md
- 리뷰 파일 저장: $SPEC/review_${FEAT}_v2.md
- Confluence 원문 파일: $SPEC/confluence_raw.md (MCP 재호출 금지)
- 기계 사전 패스: $SPEC/precheck_round2.json (있으면 기계 EVAL 재열거 금지)"
RUNAGENT_DEBUG_FILE="$SPEC/step6_debug.log" bash "$RETRY" "$SPEC/step6_stderr.log" -- \
  bash "$RUNAGENT" $CLI_BASE --model sonnet --agent tc-리뷰2수정2-v2 "$HANDOFF" >>"$CHAIN_LOG" 2>&1
rc=$?
[[ $rc -eq 10 ]] && stop_auth "STEP 6"
P6=$("$NODE" -e "
const fs=require('fs');
try{const r=JSON.parse(fs.readFileSync('$SPEC/step_result.json','utf8'));
const fresh=fs.statSync('$SPEC/step_result.json').mtimeMs>fs.statSync('$SPEC/step5_result.json').mtimeMs;
console.log(r.status==='success'&&r.review_round===2&&r.step===6&&fresh?'ok':'partial');}catch(e){console.log('partial')}")
if [[ "$P6" != "ok" ]]; then
  log "[STEP 6] 부분완료/silent — 자동 ⓑ 복구"
  "$NODE" "$UTIL/step_recover.js" "$SPEC" "$SHEET_ID" "$TAB" 6 "$SPEC/_prev_step5_snap.json" >>"$CHAIN_LOG" 2>&1
  rrc=$?
  [[ $rrc -eq 3 ]] && stop_integrity "STEP 6 복구 게이트 불일치"
  [[ $rrc -ne 0 ]] && { log "[STEP 6] 복구 실패 rc=$rrc"; exit 1; }
fi
log "[STEP 6] 완료"
do_transition done 2 6
fi

# ── 완료처리 (FINAL-1~5) ─────────────────────────────────────────────────────
log "[완료처리] 시작"
( cd "$UTIL" && "$NODE" update_dashboard.js "$SHEET_ID" ) >>"$CHAIN_LOG" 2>&1 && log "[FINAL-1] 대시보드 OK" || log "[FINAL-1][경고] 실패"
"$NODE" "$UTIL/add_project_info.js" "$SHEET_ID" "$TAB" "${CONF_URL:-}" >>"$CHAIN_LOG" 2>&1 && log "[FINAL-2] K~O OK" || log "[FINAL-2][경고] 실패"
"$NODE" "$UTIL/upload_md_to_drive.js" --sync "$FEAT" >>"$CHAIN_LOG" 2>&1 && log "[FINAL-3] 드라이브 OK" || log "[FINAL-3][경고] 실패"

"$NODE" "$UTIL/read_gsheet_data.js" "$SHEET_ID" "$TAB" > "$SPEC/_final_dump.json" 2>>"$CHAIN_LOG" || { log "[FINAL-4] 덤프 실패"; exit 1; }
METRICS=$("$NODE" -e "
const {loadSnapshot}=require('$UTIL/load_snapshot.js');
const rows=loadSnapshot('$SPEC/_final_dump.json').rows;
let B='';const body=rows.map(r=>{if(r[1])B=r[1];return{B,E:r[4],F:r[5]||'',G:r[6],J:(r[9]||'').trim(),raw:r};});
const bad=[];
const abs=body.filter(r=>/올바르게|정상적으로|적절히|제대로|문제없이/.test(r.F)).length; if(abs)bad.push('추상'+abs);
const err=body.filter(r=>r.raw.some(v=>typeof v==='string'&&(v.includes('#ERROR!')||v.includes('Output Format:')))).length; if(err)bad.push('ERROR'+err);
const g=body.filter(r=>!['PC','모바일','PC/모바일'].includes(r.G)).length; if(g)bad.push('G'+g);
const jW=['','추후 구현','구현 우선순위 낮음','기획 확인 필요'];
const j=body.filter(r=>!(jW.includes(r.J)||/^버그ID-\d+/.test(r.J))).length; if(j)bad.push('J'+j);
console.log(bad.length?('FAIL:'+bad.join(',')+':'+body.length):('PASS:'+body.length));")
[[ "$METRICS" == FAIL:* ]] && stop_integrity "FINAL-4 지표 위반 ($METRICS)"
TOTAL_TC="${METRICS#PASS:}"
log "[FINAL-4] 전수 지표 0건 (${TOTAL_TC}행)"

# FINAL-5 라벨링 — 소형 CLI로 자동 도출 (실패 시 비차단)
HANDOFF="다음 파일을 읽고 라벨 JSON을 생성하라 (출력·설명 없이 파일만 작성):
- 분석: $SPEC/analysis.md 의 'C-1. 미지정값'·'C-2. 분석자 코멘트' 표
- 산출: $SPEC/_labels.json — 형식 {\"기획확인\":[\"[값 미정|규칙 없음|규칙 모호] <기획서에 없는/모호한 내용 1문장>\\n→ <QA 판정 불가 사유 1문장>\", ...], \"테스트데이터\":[]}
- 기획확인: C-1 '필수' 항목 + C-2 '확인 필요=O' 항목 전수 (각 1건씩, 한국어)
- 테스트데이터: 전투/보스/스킬·시스템형이면 빈 배열 유지 (억지 생성 금지)"
RUNAGENT_DEBUG_FILE="$SPEC/final5_debug.log" bash "$RUNAGENT" $CLI_BASE --model sonnet "$HANDOFF" >>"$CHAIN_LOG" 2>&1 || true
if "$NODE" -e "const l=JSON.parse(require('fs').readFileSync('$SPEC/_labels.json','utf8'));process.exit(Array.isArray(l['기획확인'])?0:1)" 2>/dev/null; then
  "$NODE" "$UTIL/apply_labeling.js" "$SHEET_ID" "$TAB" "$SPEC/_labels.json" >>"$CHAIN_LOG" 2>&1 \
    && log "[FINAL-5] 라벨링 OK" || log "[FINAL-5][경고] 기재 실패 — 수동 필요"
else
  log "[FINAL-5][경고] 라벨 생성 실패 — 수동 필요 (비차단)"
fi

# 백업탭 정리 + 락 해제 + 진행시간
BACKUP=$(cat "$SPEC/backup_tab.txt" 2>/dev/null || true)
[[ -n "${BACKUP:-}" ]] && "$NODE" "$UTIL/duplicate_tab.js" "$SHEET_ID" "$BACKUP" --delete >>"$CHAIN_LOG" 2>&1 && log "[정리] 백업탭 삭제"
"$NODE" -e "require('fs').rmSync(process.argv[1],{force:true})" "$LOCK"
S=$(cat "$SPEC/.pipeline_start_epoch"); E=$(( $(date +%s) - S ))
log "[CHAIN] 완주 — ${TOTAL_TC}행, 진행시간 $(printf '%02d:%02d:%02d' $((E/3600)) $((E%3600/60)) $((E%60)))"
exit 0
