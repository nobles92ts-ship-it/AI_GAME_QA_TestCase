#!/bin/bash
# transition.sh — tc-팀-v2 STEP 전환 매크로 (Phase 2-C, 2026-06-11)
#
# 팀장이 STEP 경계마다 반복 작성하던 인라인 블록(결과 복제 + completed_at + state.json 갱신 +
# attempts 가드)을 단일 호출로 대체. LLM 재타이핑 오류 제거 + 토큰 절감 (−1분).
#
# 사용:
#   bash transition.sh --feature <기능명> --state <state> --review-round <R> \
#        --sheet-id <ID> --tab <탭명> \
#        [--prev-step <N>] [--attempts-file <PATH> --attempts-max <K>]
#
# 동작 순서:
#   ① --prev-step N 있으면: step_result.json → step{N}_result.json 복제(존재 시)
#      + state.json에 step{N}_completed_at 기록 (이미 있으면 보존 — 재진입 시 시각 왜곡 방지)
#   ② --attempts-file 있으면: 한도(K) 검사 — 도달 시 exit 2 (state 변경 없이 중단), 미달이면 +1
#   ③ state.json 갱신 (ALLOWED 9종 · FEATURE_NAME 가드 · done은 review_round=2 무결성 — 팀장 인라인 로직 이식)
#
# rc 계약 (I11 — rc≠0 시 후속 CLI 호출 금지):
#   0 = 전환 완료 (다음 STEP CLI 진행)
#   1 = 상태 기록 실패 (중단 — state.json 손상/검증 실패)
#   2 = attempts 한도 도달 (후속 CLI 호출 금지 — failed 마킹/스킵 판단은 팀장)
#
# ⚠ 부록 2(step_result 필드 계약) 변경 시 이 스크립트의 done 무결성 가드도 함께 검토 (4곳 동시 갱신).

set -u

NODE="${TCTEAM_NODE:-node}"
# 테스트 격리용 env 오버라이드 (tests/run_tests.js [9]) — 운영에선 항상 기본값
# pwd -W = git-bash 에서 Windows 형(C:/...) 출력. /c/... 형은 node.exe 에 넘기면 깨진다.
PROJECT_ROOT="${TCTEAM_PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && { pwd -W 2>/dev/null || pwd; })}"
SPECS="${TCV2_SPECS_DIR:-$PROJECT_ROOT/team/specs}"
STATE_FILE="${TCV2_STATE_FILE:-$PROJECT_ROOT/team/state.json}"

FEATURE="" NEW_STATE="" REVIEW_ROUND="" SHEET_ID="" TAB_NAME=""
PREV_STEP="" ATTEMPTS_FILE="" ATTEMPTS_MAX=""

while [ $# -gt 0 ]; do
  case "$1" in
    --feature)       FEATURE="$2"; shift 2 ;;
    --state)         NEW_STATE="$2"; shift 2 ;;
    --review-round)  REVIEW_ROUND="$2"; shift 2 ;;
    --sheet-id)      SHEET_ID="$2"; shift 2 ;;
    --tab)           TAB_NAME="$2"; shift 2 ;;
    --prev-step)     PREV_STEP="$2"; shift 2 ;;
    --attempts-file) ATTEMPTS_FILE="$2"; shift 2 ;;
    --attempts-max)  ATTEMPTS_MAX="$2"; shift 2 ;;
    *) echo "[TRANSITION][CRITICAL] 알 수 없는 인자: $1" >&2; exit 1 ;;
  esac
done

if [ -z "$FEATURE" ] || [ -z "$NEW_STATE" ] || [ -z "$REVIEW_ROUND" ]; then
  echo "[TRANSITION][CRITICAL] --feature/--state/--review-round 필수" >&2
  exit 1
fi

SPEC_DIR="$SPECS/$FEATURE"

# ── ① 이전 STEP 결과 복제 + completed_at ──────────────────────────────────────
# ⚠ success 가드: step_result.json이 fail이면 복제 금지 — 재시도 재진입 시 실패 결과가
#   직전 STEP의 성공 결과(step[N]_result.json)를 덮어쓰는 오염 차단. fail 진단은
#   step_result.json 원본 + stderr 로그가 담당.
if [ -n "$PREV_STEP" ]; then
  if [ -f "$SPEC_DIR/step_result.json" ]; then
    SRC_STATUS=$(SPEC_DIR_ENV="$SPEC_DIR" "$NODE" -e "try{const r=JSON.parse(require('fs').readFileSync(process.env.SPEC_DIR_ENV+'/step_result.json','utf8'));console.log(r.status||'')}catch{console.log('')}")
    SRC_STEP=$(SPEC_DIR_ENV="$SPEC_DIR" "$NODE" -e "try{const r=JSON.parse(require('fs').readFileSync(process.env.SPEC_DIR_ENV+'/step_result.json','utf8'));console.log(r.step??'')}catch{console.log('')}")
    # ⚠ step 정체성 대조 (L2P3-02): 직전 STEP이 silent 크래시하면 step_result.json에는
    #   그 이전 STEP의 success가 잔존 — 이를 step{N}_result.json으로 복제하면 P-식 검증
    #   기준선까지 오염된다. 단, 오염은 '복제'에서만 발생하고 복제는 success에서만 하므로
    #   step 불일치 AND status=success일 때만 치명(rc=1). fail 잔존은 정당한 재개이므로 복제 스킵 후 속행.
    if [ -n "$SRC_STEP" ] && [ "$SRC_STEP" != "$PREV_STEP" ]; then
      if [ "$SRC_STATUS" = "success" ]; then
        echo "[TRANSITION][CRITICAL] step_result.json step=$SRC_STEP ≠ --prev-step $PREV_STEP — 직전 STEP silent exit 의심, 복제 거부·중단 (수동 확인 필요)" >&2
        exit 1
      else
        echo "[TRANSITION][경고] step_result.json step=$SRC_STEP status='$SRC_STATUS'(≠success) ≠ --prev-step $PREV_STEP — fail 잔존 재개로 판단, 복제 스킵 후 속행" >&2
      fi
    fi
    [ -z "$SRC_STEP" ] && echo "[TRANSITION][경고] step_result.json에 step 필드 없음 (구버전 결과) — 정체성 대조 생략" >&2
    if [ "$SRC_STATUS" = "success" ]; then
      cp "$SPEC_DIR/step_result.json" "$SPEC_DIR/step${PREV_STEP}_result.json" \
        || { echo "[TRANSITION][CRITICAL] step${PREV_STEP}_result.json 복제 실패" >&2; exit 1; }
    else
      echo "[TRANSITION][경고] step_result.json status='$SRC_STATUS' (≠success) — step${PREV_STEP}_result.json 복제 스킵 (오염 방지)" >&2
    fi
  else
    echo "[TRANSITION][경고] step_result.json 없음 — step${PREV_STEP}_result.json 복제 스킵 (silent exit 여부는 GUARD/P-식 검증이 판단)" >&2
  fi

  FEATURE_NAME="$FEATURE" STEP_KEY="step${PREV_STEP}_completed_at" "$NODE" -e "
const fs=require('fs'),f='$STATE_FILE';
const d=fs.existsSync(f)?JSON.parse(fs.readFileSync(f,'utf8')):{specs:[]};
const feature=process.env.FEATURE_NAME;
if(!feature){console.error('[TRANSITION][CRITICAL] FEATURE_NAME 미설정');process.exit(1);}
const s=(d.specs||[]).find(x=>x&&x.feature===feature);
if(s){ if(!s[process.env.STEP_KEY]) s[process.env.STEP_KEY]=new Date().toISOString(); fs.writeFileSync(f,JSON.stringify(d,null,2)); }
else { console.error('[TRANSITION][경고] feature 항목 없음 — completed_at 스킵:',feature); }
" || { echo "[TRANSITION][CRITICAL] completed_at 기록 실패" >&2; exit 1; }
fi

# ── ② attempts 가드 (check-then-increment) ────────────────────────────────────
if [ -n "$ATTEMPTS_FILE" ]; then
  [ -n "$ATTEMPTS_MAX" ] || { echo "[TRANSITION][CRITICAL] --attempts-file에는 --attempts-max 필수" >&2; exit 1; }
  ATTEMPTS=$(cat "$ATTEMPTS_FILE" 2>/dev/null || echo 0)
  case "$ATTEMPTS" in (*[!0-9]*|'') ATTEMPTS=0 ;; esac
  if [ "$ATTEMPTS" -ge "$ATTEMPTS_MAX" ]; then
    echo "[TRANSITION][GUARD] attempts 한도 도달 ($ATTEMPTS/$ATTEMPTS_MAX) — 전환 중단 (rc=2, 후속 CLI 호출 금지)" >&2
    exit 2
  fi
  echo $((ATTEMPTS+1)) > "$ATTEMPTS_FILE"
fi

# ── ③ state.json 갱신 (팀장 인라인 로직 이식 — ALLOWED·가드·done 무결성 동일) ──
FEATURE_NAME="$FEATURE" TAB_NAME_VAL="$TAB_NAME" NEW_STATE_VAL="$NEW_STATE" \
REVIEW_ROUND_VAL="$REVIEW_ROUND" SHEET_ID_VAL="$SHEET_ID" "$NODE" -e "
const fs=require('fs');
const f='$STATE_FILE';
const ALLOWED=['designing','design_reviewing','design_fixing','writing','reviewing','fixing','reviewing_fixing','done','failed'];
const data=fs.existsSync(f)?JSON.parse(fs.readFileSync(f,'utf8')):{specs:[]};
if(!Array.isArray(data.specs)){console.error('[STATE] specs 배열 손상 — 초기화');data.specs=[];}
data.specs=data.specs.filter(s=>s&&typeof s.feature==='string'&&ALLOWED.includes(s.state));
const feature=process.env.FEATURE_NAME;
const tabName=process.env.TAB_NAME_VAL;
if(!feature||typeof feature!=='string'){console.error('[STATE][CRITICAL] FEATURE_NAME 미설정');process.exit(1);}
const newState=process.env.NEW_STATE_VAL;
if(!ALLOWED.includes(newState)){console.error('[STATE][CRITICAL] 잘못된 state 값:',newState);process.exit(1);}
const reviewRound=parseInt(process.env.REVIEW_ROUND_VAL,10);
if(Number.isNaN(reviewRound)){console.error('[STATE][CRITICAL] review_round 숫자 아님');process.exit(1);}
if(newState==='done'&&reviewRound!==2){console.error('[STATE][CRITICAL] done 상태는 review_round=2 필수, 현재:',reviewRound);process.exit(1);}
const idx=data.specs.findIndex(s=>s.feature===feature);
const spec={feature,state:newState,review_round:reviewRound,spreadsheet_id:process.env.SHEET_ID_VAL||'',tab_name:tabName,updated_at:new Date().toISOString()};
if(idx>=0) data.specs[idx]={...data.specs[idx],...spec}; else data.specs.push(spec);
data.savedAt=new Date().toISOString();
fs.writeFileSync(f,JSON.stringify(data,null,2));
" || { echo "[TRANSITION][CRITICAL] state.json 갱신 실패" >&2; exit 1; }

echo "[TRANSITION] $FEATURE → state=$NEW_STATE (round=$REVIEW_ROUND)${PREV_STEP:+ / step${PREV_STEP} 마감}${ATTEMPTS_FILE:+ / attempts=$(cat "$ATTEMPTS_FILE")}"
exit 0
