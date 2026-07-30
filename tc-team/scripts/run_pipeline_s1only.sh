#!/usr/bin/env bash
# run_pipeline_s1only.sh — tc-team S1 설계 체인 러너 (설계→검수→수정→대조주입, 07-27 tc-team 이주)
#
# 목적: STEP 사이 LLM(팀장) 턴 경유를 제거 — 시작 시퀀스→STEP 1~6→완료처리를 단일 프로세스로
#       연속 실행. 모든 분기(재진입·STEP 3 라우팅·ⓑ 복구)는 인라인 자동 해결.
#
# 정지 예외 4종 (멈추는 게 더 안전한 경우만):
#   exit 10 — 인증 만료 (사용자만 해결 가능)
#   exit 13 — 같은 STEP 재시도 한도 도달 (transition rc=2, state=failed 마킹 후 중단)
#   exit 14 — 무결성·수지 불일치 / 시트 부작용 검출 (계속하면 데이터 오염)
#   exit 15 — CLI 쿼터 3회 실패 (pipeline_retry rc=11 — 재실행 대기)
#   그 외 오류 exit 1
#   ※ STEP 5/6 완전 silent(step_recover rc=5)는 exit 16 즉시 멈춤이 아니라 자동 재시도
#     — 한도 3회 소진 시 do_transition rc=2 → stop_attempts(state=failed, exit 13)로 멈춤.
#
# 전제: specs/[기능명]/confluence_raw.md + sheet_info.txt 준비됨 (팀장이 fetch 후 호출)
# 사용: bash run_pipeline_s1only.sh --feature <기능명> --sheet-id <ID> --conf-url <URL>

set -uo pipefail

# 경로 해석(2026-07-29 이식성): tc-team/scripts/ → ../.. = 프로젝트 루트
# pwd -W = git-bash에서 Windows 형(C:/...)으로 출력. node.exe에 env로 넘길 때 /c/... 형은 깨진다.
PROJECT_ROOT="${TCTEAM_PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && { pwd -W 2>/dev/null || pwd; })}"

NODE="${TCTEAM_NODE:-node}"
UTIL="$PROJECT_ROOT/scripts/util"
SPECS="$PROJECT_ROOT/team/specs"
CONFIG="$PROJECT_ROOT/team/tc_config.json"   # DXR 대조 토글 (crossref_brain: off|on)
RUNAGENT="$UTIL/run-agent.sh"
RETRY="$UTIL/pipeline_retry.sh"
GUARD="$UTIL/silent_exit_guard.sh"
CLI_BASE='-p --permission-mode bypassPermissions'

FEAT="" ; SHEET_ID="" ; CONF_URL="" ; RESUME="" ; LOCAL=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --feature)  FEAT="$2"; shift 2 ;;
    --sheet-id) SHEET_ID="$2"; shift 2 ;;
    --conf-url) CONF_URL="$2"; shift 2 ;;
    --resume-from) RESUME="$2"; shift 2 ;;
    --local)    LOCAL=1; shift ;;   # 로컬 .xlsx 출력 모드 (Google Sheets 미사용): STEP 4까지만, 5/6·완료처리 스킵
    *) echo "알 수 없는 인자: $1" >&2; exit 1 ;;
  esac
done
# 로컬 모드: 시트 ID 없이도 동작 (create_gsheet argv 자리만 채움 — 로컬 분기에서 무시됨)
[[ "$LOCAL" == "1" && -z "$SHEET_ID" ]] && SHEET_ID="LOCAL_XLSX"
[[ -n "$FEAT" && -n "$SHEET_ID" ]] || { echo "사용법: --feature <명> --sheet-id <ID> [--conf-url <URL>] [--resume-from step3-blocker|step4|step5|step6|final] [--local]" >&2; exit 1; }

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
RAW_SIZE=$(wc -c < "$SPEC/confluence_raw.md" 2>/dev/null | tr -d '[:space:]')
echo "[CHAIN] confluence_raw.md 크기: ${RAW_SIZE:-0}B" >&2
[[ "${RAW_SIZE:-0}" -lt 500 ]] && { echo "[CHAIN] confluence_raw.md 크기 이상(<500B) — fetch 재확인" >&2; exit 1; }

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$CHAIN_LOG"; }
stop_auth()      { log "[STOP:인증] $1 — 재인증 후 재실행"; exit 10; }
stop_attempts()  {
  log "[STOP:한도] $1 — 카운터 확인 후 재실행"
  # rc=2 (attempts 한도) → 사양: 현재 기능 state=failed 마킹 후 중단
  FEATURE_NAME="$FEAT" TCTEAM_STATE_JSON="$PROJECT_ROOT/team/state.json" "$NODE" -e "
const fs=require('fs');const f=process.env.TCTEAM_STATE_JSON;
const d=fs.existsSync(f)?JSON.parse(fs.readFileSync(f,'utf8')):{specs:[]};
const feat=process.env.FEATURE_NAME;
const s=(d.specs=d.specs||[]).find(x=>x&&x.feature===feat);
if(s){s.state='failed';s.updated_at=new Date().toISOString();s.failure_reason='attempts 한도 도달 (transition rc=2)';}
else d.specs.push({feature:feat,state:'failed',review_round:0,tab_name:'',updated_at:new Date().toISOString(),failure_reason:'attempts 한도 도달 (transition rc=2)'});
fs.writeFileSync(f,JSON.stringify(d,null,2));
" >>"$CHAIN_LOG" 2>&1 || log "[STOP:한도][경고] state=failed 마킹 실패 — 무시하고 중단"
  exit 13
}
stop_quota()     { log "[STOP:쿼터] $1 — 쿼터 3회 실패, 재실행 대기"; exit 15; }
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
FEATURE_NAME="$FEAT" TCTEAM_STATE_JSON="$PROJECT_ROOT/team/state.json" "$NODE" -e "
const fs=require('fs');const f=process.env.TCTEAM_STATE_JSON;
const d=fs.existsSync(f)?JSON.parse(fs.readFileSync(f,'utf8')):{specs:[]};
const feat=process.env.FEATURE_NAME;
const allDone=!d.specs.length||d.specs.every(s=>s.state==='done');
if(allDone)d.currentBatch=[];
d.currentBatch=(d.currentBatch||[]).filter(x=>x&&typeof x==='string');
if(!d.currentBatch.includes(feat))d.currentBatch.push(feat);
fs.writeFileSync(f,JSON.stringify(d,null,2));
" >>"$CHAIN_LOG" 2>&1

# 착수 공지 — per-feature 항목 파일 + 기능별 dedup 격리 (stale 공유 .kickoff_items.json / 잔존 suppress 마커 충돌 방지, 2026-07-14)
printf '[{"feature":"%s","confluence":"%s"}]\n' "$FEAT" "${CONF_URL:-}" > "$SPEC/.kickoff_item.json"
"$NODE" "$UTIL/send_slack_tc_request.js" --items "$SPEC/.kickoff_item.json" \
  --sheet "https://docs.google.com/spreadsheets/d/$SHEET_ID/edit" --dedup-dir "$SPEC" >>"$CHAIN_LOG" 2>&1 \
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
tc-학습.md 활성 설계 패턴 반영 필수 — 특히 P-18(상태이상·연출 상호작용 4유형), P-19(서술형 섹션을 대조표에 분해), P-20(BVA 상·하한 분리, 통합 1건 금지), P-22(자원 증감 소분류의 재접속복구·롤백·동시요청·반복재판정 4유형), P-23(열거값은 값 수만큼 개별 전개, '각 ~별' 통합 1건 금지).
Confluence MCP 재호출 금지."
bash "$GUARD" "$SPEC/step_result.json" -- bash -c "
RUNAGENT_DEBUG_FILE='$SPEC/step1_debug.log' bash '$RETRY' '$SPEC/step1_stderr.log' -- \
bash '$RUNAGENT' $CLI_BASE --model opus --effort medium --agent tc-team-designer \"\$0\"" "$HANDOFF" >>"$CHAIN_LOG" 2>&1
rc=$?
[[ $rc -eq 10 ]] && stop_auth "STEP 1"
[[ $rc -eq 11 ]] && stop_quota "STEP 1"
[[ $rc -eq 12 ]] && stop_attempts "STEP 1 silent exit 3회 (GUARD)"
[[ "$(check_step 1)" == "ok" ]] || { log "[STEP 1] 실패: $(check_step 1)"; exit 1; }
log "[STEP 1] 완료"
fi

# ── STEP 2 설계검수 (sonnet) ─────────────────────────────────────────────────
NEEDS_FIX=0; GAP=0
if [[ $START -le 2 ]]; then
do_transition design_reviewing 0 1
# ── STEP 2-대조 (조건부·결정론) — bash가 DXR 뇌 대조를 강제 호출 (LLM 자율 의존 제거, 2026-06-19) ──
# off/파일없음/뇌 미탑재 = 스킵(현행 동작 100% 동일). on = 전용 tc-team-대조 에이전트 무조건 호출 + fail-safe(비차단).
CROSSREF=$("$NODE" -e "try{const c=JSON.parse(require('fs').readFileSync('$CONFIG','utf8'));process.stdout.write(c.crossref_brain==='on'?'on':'off')}catch(e){process.stdout.write('off')}" 2>/dev/null)
[[ -z "$CROSSREF" ]] && CROSSREF=off
# 색인 이름도 config 에서 읽는다 — tc-대조.md §도구 "하드코딩 금지"의 이행 (2026-07-30 드리프트 수정:
# 규칙은 config 를 읽으라고 했는데 아래 핸드오프가 "brain-corpus" 를 리터럴로 박아 config 가 무력했다).
XSRC=$("$NODE" -e "try{const c=JSON.parse(require('fs').readFileSync('$CONFIG','utf8'));process.stdout.write(c.crossref_source||'brain-corpus')}catch(e){process.stdout.write('brain-corpus')}" 2>/dev/null)
[[ -z "$XSRC" ]] && XSRC=brain-corpus
"$NODE" -e "require('fs').rmSync('$SPEC/dxr_crossref.json',{force:true})" 2>/dev/null || true
if [[ "$CROSSREF" == "on" ]]; then
  log "[STEP 2-대조] DXR 뇌 대조 시작 (crossref_brain=on)"
  XHANDOFF="## HANDOFF
- 기능명: $FEAT
- specs 경로: $SPEC
- 분석 파일: $SPEC/analysis.md (입력 = C-1 미지정값 '필수' + B-2 외부 의존성)
- 산출: $SPEC/dxr_crossref.json (tc-대조.md §2.1 스키마)

## 작업 지시
tc-대조.md 지침대로 analysis.md의 미지정/외부의존 항목을 제2의 뇌(DXR 위키 색인, ctx_search source=\"$XSRC\")에 대조 → dxr_crossref.json 생성.
4분기(apply/locate/discover/keep) + 가드 전부 ON(스텁·(작성중)·애매·출처없음→keep) + 스코프경계(로컬 데이터테이블 실제값은 가져오지 말고 locate=위치만).
§1.6 비파괴: 무적중·빈입력·뇌 미탑재·에러 = keep(또는 counts.in=0) 빈 JSON 저장 후 정상 종료. step_result.json 건드리지 말 것."
  RUNAGENT_DEBUG_FILE="$SPEC/crossref_debug.log" bash "$RUNAGENT" $CLI_BASE --model sonnet --agent tc-team-대조 "$XHANDOFF" >>"$CHAIN_LOG" 2>&1 \
    || log "[STEP 2-대조][경고] 대조 에이전트 비정상 종료 — fail-safe 스킵(비차단)"
  if [[ -f "$SPEC/dxr_crossref.json" ]]; then
    XC=$("$NODE" -e "try{const c=JSON.parse(require('fs').readFileSync('$SPEC/dxr_crossref.json','utf8'));const it=c.items||[];const ap=it.filter(x=>x.branch==='apply'&&x.approved===true).length;const lo=it.filter(x=>x.branch==='locate').length+it.filter(x=>x.branch==='apply'&&x.approved!==true).length;const di=it.filter(x=>x.branch==='discover').length+(c.discovered||[]).length;const ke=it.filter(x=>x.branch==='keep').length;process.stdout.write('apply='+ap+' locate='+lo+' discover='+di+' keep='+ke)}catch(e){process.stdout.write('파싱불가')}" 2>/dev/null)
    log "[STEP 2-대조] 완료 — $XC"
  else
    log "[STEP 2-대조] 산출 없음 — 뇌 미적중/미탑재로 간주(비차단, 현행 동작)"
  fi
else
  log "[STEP 2-대조] 스킵 (crossref_brain=$CROSSREF)"
fi
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
- DXR 대조 결과: $SPEC/dxr_crossref.json (있으면 소비 — discover→C-05/C-12 커버리지 분모 포함, apply/locate→중복 재지적 금지. 없으면 현행대로. 규칙 SSoT=tc-설계검수.md 'DXR 대조 연동')
- ⚠ C-05 분모 완전성 교차 시 tc-학습.md P-18·P-19·P-20·P-22·P-23으로 원문 대비 누락 확인."
bash "$GUARD" "$SPEC/step_result.json" -- bash -c "
RUNAGENT_DEBUG_FILE='$SPEC/step2_debug.log' bash '$RETRY' '$SPEC/step2_stderr.log' -- \
bash '$RUNAGENT' $CLI_BASE --model sonnet --agent tc-team-설계검수 \"\$0\"" "$HANDOFF" >>"$CHAIN_LOG" 2>&1
rc=$?
[[ $rc -eq 10 ]] && stop_auth "STEP 2"
[[ $rc -eq 11 ]] && stop_quota "STEP 2"
[[ $rc -eq 12 ]] && stop_attempts "STEP 2 silent exit 3회"
[[ "$(check_step 2)" == "ok" ]] || { log "[STEP 2] 실패"; exit 1; }
NEEDS_FIX=$("$NODE" -e "const r=JSON.parse(require('fs').readFileSync('$SPEC/step_result.json','utf8'));const nf=(r.needs_fix??(r.review&&r.review.needs_fix)??(r.step2_review&&r.step2_review.needs_fix));console.log(nf===true?'1':'0')")
GAP=$("$NODE" -e "const r=JSON.parse(require('fs').readFileSync('$SPEC/step_result.json','utf8'));const g=(r.analysis_gap??(r.review&&r.review.analysis_gap)??(r.step2_review&&r.step2_review.analysis_gap));console.log(Number(g)||0)")
# 대조 결정론 OR: apply(approved:true) 또는 discover ≥1 → needs_fix 강제 (검수 LLM 누락 방지). locate/keep은 트리거 아님.
if [[ -f "$SPEC/dxr_crossref.json" ]]; then
  XFIX=$("$NODE" -e "try{const c=JSON.parse(require('fs').readFileSync('$SPEC/dxr_crossref.json','utf8'));const it=c.items||[];const ap=it.filter(x=>x.branch==='apply'&&x.approved===true).length;const di=it.filter(x=>x.branch==='discover').length+(c.discovered||[]).length;process.stdout.write((ap+di)>0?'1':'0')}catch(e){process.stdout.write('0')}" 2>/dev/null)
  if [[ "$XFIX" == "1" && "$NEEDS_FIX" != "1" ]]; then NEEDS_FIX=1; log "[STEP 2-대조] apply(approved)/discover ≥1 → needs_fix=1 강제 (STEP3 반영)"; fi
fi
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
- DXR 대조 결과: $SPEC/dxr_crossref.json (있으면 직접 소비) — apply(approved:true)→커버리지 매핑표에 확정 규칙+출처, discover→TC 후보 추가. approved:false·locate·keep은 기획확인 블록 유지(설계 변경 아님). 규칙 SSoT=tc-대조.md §3. 분석누락 아닌 설계보강이라 sonnet.
- 직변환 차단 보고서: $SPEC/conversion_blocker.json (존재 시 최우선 — 차단 항목 외과 수정)

## 작업 지시
design_review.md 이슈(존재 시) + DXR 대조 결과(apply/discover, 존재 시) + conversion_blocker.json 차단(존재 시) 반영하여 analysis.md/tc_design.md 외과 수정.
수정 후 직변환 사전 게이트(tc-설계.md Step 11.5) 재실행 — exit 0 필수 (배분표 3자 동치 재계산).
드라이브 재업로드."
  bash "$GUARD" "$SPEC/step_result.json" -- bash -c "
RUNAGENT_DEBUG_FILE='$SPEC/step3_debug.log' bash '$RETRY' '$SPEC/step3_stderr.log' -- \
bash '$RUNAGENT' $CLI_BASE ${model_args[*]} --agent tc-team-designer \"\$0\"" "$HANDOFF" >>"$CHAIN_LOG" 2>&1
  local rc=$?
  [[ $rc -eq 10 ]] && stop_auth "STEP 3"
  [[ $rc -eq 11 ]] && stop_quota "STEP 3"
  [[ $rc -eq 12 ]] && stop_attempts "STEP 3 silent exit 3회"
  [[ "$(check_step 3)" == "ok" ]] || { log "[STEP 3] 실패"; exit 1; }
  log "[STEP 3] 완료"
}
PREV_FOR_4=2
if [[ $START -le 2 && "$NEEDS_FIX" == "1" ]]; then run_step3 review; PREV_FOR_4=3; fi
# 재개 진입점: step3-blocker → STEP 3(blocker 모드) 선실행 / step4 직행 시 직전 설계 STEP 자동 판별
if [[ $START -eq 3 ]]; then GAP=0; run_step3 blocker; PREV_FOR_4=3; fi
if [[ $START -eq 4 && -f "$SPEC/step3_result.json" ]]; then PREV_FOR_4=3; fi

# ── locate/apply(외부) 출처 주입 (결정론·멱등, 2026-06 배선 보강 / 2026-07-12 적대리뷰 #9) ──
# needs_fix 와 무관하게(=STEP 3가 안 돌아도) locate·apply(approved:false) 위치·출처를 tc_design 에 삽입.
# 이전엔 locate-only 런에서 대조 산출물이 설계에 전혀 반영 안 돼 '완료 locate=N' 로그만 남던 문제(#9).
if [[ -f "$SPEC/dxr_crossref.json" ]]; then
  "$NODE" "$UTIL/crossref_annotate.js" "$SPEC/dxr_crossref.json" "$SPEC/tc_design.md" >>"$CHAIN_LOG" 2>&1 \
    || log "[STEP 3.5-대조주입][경고] crossref_annotate 실패 — 비차단"
fi


log "[S1-ONLY] 설계 구간(STEP 1~3.5) 완료 — tc-v3 콜드런용 조기 종료"
exit 0
