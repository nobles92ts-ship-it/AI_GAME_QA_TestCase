#!/usr/bin/env bash
# run_pipeline_full.sh — tc-team 풀체인 러너 (S1 위임 + S2~S7 결정론 체인, 2026-07-28)
#
# 목적: Loki `!tc-team` 등 무인 경로에서 tc-team 전 구간을 단일 프로세스로 실행.
#       데스크톱 런북(SKILL.md)을 대체하지 않는 **추가 러너** — 같은 lib/유틸/규칙을 쓴다.
# 구조: LLM 단계(S3 문장화·S4 리뷰·커버리지·봉합·FINAL-5a)는 run-agent.sh(claude -p)
#       짧은 호출 + 결정론 검증. 헤드리스 LLM "드라이버"는 없다(07-23 고아화 실증).
# SSoT: S3 문장화 규칙·S4 렌즈는 workflows/*.js 에서 **런타임 추출**(chain_helpers.js)
#       — 워크플로우 파일을 고치면 데스크톱 팬아웃과 이 체인이 같이 바뀐다(사본 0).
#       S1 에이전트·라벨링 기준은 ~/.claude (rules 서랍) 실행 시점 참조.
#
# 정지 예외 (s1only 프로토콜 승계):
#   exit 10 인증 만료 / exit 13 재시도 한도(state=failed) / exit 14 무결성·설계결함·게이트
#   (사람 확인 필요) / exit 15 CLI 쿼터. 그 외 오류 exit 1.
#
# 사용: bash run_pipeline_full.sh --feature <기능명> --sheet-id <ID> [--conf-url <URL>]
#                                 [--start-from s1|s2|s3|s4|s5|s6|s7]   (복구 재개용)
# 전제: specs/<기능명>/confluence_raw.md + sheet_info.txt (S0는 호출자 소관 — Loki S0 턴)

set -uo pipefail

# 경로 해석(2026-07-29 이식성): 스크립트 자기 위치에서 프로젝트 루트를 유도한다
#   (tc-team/scripts/ → ../.. = 루트). 배포본·로컬이 같은 레이아웃이라 양쪽에서 동작.
# pwd -W = git-bash에서 Windows 형(C:/...)으로 출력. node.exe에 env로 넘길 때 /c/... 형은 깨진다.
PROJECT_ROOT="${TCTEAM_PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && { pwd -W 2>/dev/null || pwd; })}"
CLAUDE_HOME="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"

NODE="${TCTEAM_NODE:-node}"
TCTEAM="$PROJECT_ROOT/tc-team"
LIB="$TCTEAM/lib"
WFDIR="$TCTEAM/workflows"
UTIL="$PROJECT_ROOT/scripts/util"
SPECS="$PROJECT_ROOT/team/specs"
RULESDIR="${TCTEAM_RULES_DIR:-$CLAUDE_HOME/skills/tc-team/rules}"
HELPERS="$TCTEAM/scripts/chain_helpers.js"
S1ONLY="$TCTEAM/scripts/run_pipeline_s1only.sh"
RUNAGENT="$UTIL/run-agent.sh"
RETRY="$UTIL/pipeline_retry.sh"
STATEJSON="$PROJECT_ROOT/team/state.json"
TEAMLOCK="$PROJECT_ROOT/team/.pipeline.lock"
CLI_BASE='-p --permission-mode bypassPermissions'

FEAT="" ; SHEET_ID="" ; CONF_URL="" ; START_FROM="s1"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --feature)    FEAT="$2"; shift 2 ;;
    --sheet-id)   SHEET_ID="$2"; shift 2 ;;
    --conf-url)   CONF_URL="$2"; shift 2 ;;
    --start-from) START_FROM="$2"; shift 2 ;;
    *) echo "알 수 없는 인자: $1" >&2; exit 1 ;;
  esac
done
[[ -n "$FEAT" && -n "$SHEET_ID" ]] || { echo "사용법: --feature <명> --sheet-id <ID> [--conf-url <URL>] [--start-from s1..s7]" >&2; exit 1; }
case "$START_FROM" in
  s1) ST=1 ;; s2) ST=2 ;; s3) ST=3 ;; s4) ST=4 ;; s5) ST=5 ;; s6) ST=6 ;; s7) ST=7 ;;
  *) echo "잘못된 --start-from: $START_FROM" >&2; exit 1 ;;
esac

SPEC="$SPECS/$FEAT"
WORK="$SPEC"   # 작업장 = SPEC 단일 경로 (07-29 통합, 구 $TCTEAM/runs/$FEAT 폐지)
TAB="$FEAT"
CHAIN_LOG="$SPEC/chain.log"
mkdir -p "$WORK"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$CHAIN_LOG"; }
stop_auth()      { log "[STOP:인증] $1 — 재인증 후 재실행"; exit 10; }
stop_quota()     { log "[STOP:쿼터] $1 — 쿼터 실패, 재실행 대기"; exit 15; }
stop_integrity() { log "[STOP:무결성] $1 — 사람 확인 필요"; exit 14; }
fail()           { log "[CHAIN-FULL][실패] $1"; exit 1; }

# 실행락 (SKILL.md S0-0 A정책 준용): 차단 없음 — 신선 락이면 경고만 남기고 인수.
if [[ -f "$TEAMLOCK" ]]; then
  AGE=$(( $(date +%s) - $(cat "$TEAMLOCK" 2>/dev/null || echo 0) ))
  [[ $AGE -lt 10800 ]] && log "[CHAIN-FULL][경고] 신선 락(${AGE}s) 발견 — 고아/동시 실행 가능성, 인수 진행"
fi
date +%s > "$TEAMLOCK"
trap 'rm -f "$TEAMLOCK"' EXIT   # 완료·중단 공통 해제 (S0-0)

T0=$SECONDS
mark() { echo "$1=$((SECONDS-T0))" >> "$WORK/.stage_times.txt"; T0=$SECONDS; }
[[ $ST -le 1 ]] && : > "$WORK/.stage_times.txt"

# LLM 호출: RETRY(쿼터/인증 감지) + run-agent.sh(claude -p, env 격리·모델 고정)
run_llm() { # $1=라벨 $2=모델 $3=프롬프트 [$4=effort]
  # 병렬 호출 시 RUN_LLM_ERRLOG로 stderr 로그를 호출별 분리할 것 — 공유하면 재시도 분류가 타 호출 출력을 읽는다 (2026-08-09)
  local extra=()
  [[ -n "${4:-}" ]] && extra=(--effort "$4")
  bash "$RETRY" "${RUN_LLM_ERRLOG:-$SPEC/.chain_llm_stderr.log}" -- \
    bash "$RUNAGENT" $CLI_BASE --model "$2" "${extra[@]}" "$3" >>"$CHAIN_LOG" 2>&1
  local rc=$?
  [[ $rc -eq 10 ]] && stop_auth "$1"
  [[ $rc -eq 11 ]] && stop_quota "$1"
  return $rc
}
vhelp() { "$NODE" "$HELPERS" "$@" >>"$CHAIN_LOG" 2>&1; }   # 헬퍼(로그 흡수형)

resolved_tab() { # sheet_write가 _vN 해석 후 갱신하는 TAB_NAME 회수 — 4번째 인자(=WORK) 우선, SPEC 폴백
  local t
  t=$(grep -m1 '^TAB_NAME=' "$WORK/sheet_info.txt" 2>/dev/null | cut -d= -f2- | tr -d '\r')
  [[ -z "$t" ]] && t=$(grep -m1 '^TAB_NAME=' "$SPEC/sheet_info.txt" 2>/dev/null | cut -d= -f2- | tr -d '\r')
  [[ -z "$t" ]] && t="$TAB"
  echo "$t"
}

log "[CHAIN-FULL] 시작 — $FEAT (start-from=$START_FROM)"

# ══ S1 — 설계 체인 (s1only 위임) ═══════════════════════════════════════════════
if [[ $ST -le 1 ]]; then
  bash "$S1ONLY" --feature "$FEAT" --sheet-id "$SHEET_ID" ${CONF_URL:+--conf-url "$CONF_URL"}
  rc=$?
  [[ $rc -ne 0 ]] && exit $rc   # 10/13/14/15/1 그대로 전파 (s1only가 이미 로그·마킹)
  mark s1
fi
[[ -f "$SPEC/analysis.md" && -f "$SPEC/tc_design.md" ]] || fail "설계 산출물 없음 — S1 먼저"

# ══ S2 — 격리 게이트 + 슬라이스 (결정론) ═══════════════════════════════════════
if [[ $ST -le 2 ]]; then
  log "[S2] 격리 게이트 + 슬라이스"
  "$NODE" "$LIB/design_gate.js" "$SPEC/tc_design.md" >>"$CHAIN_LOG" 2>&1
  rc=$?
  [[ $rc -eq 4 ]] && stop_integrity "S2 design_gate 설계 결함(blocker) — 세션에서 설계 수정 필요"
  [[ $rc -ne 0 ]] && fail "S2 design_gate 오류 rc=$rc"
  "$NODE" "$LIB/slicer.js" "$SPEC/confluence_raw.md" "$WORK/slices.json" >>"$CHAIN_LOG" 2>&1 || fail "S2 slicer 실패"
  mark s2
fi

# ══ S3 — 문장화 (결정론 골격 + LLM 청크 + 결정론 merge) ═══════════════════════
s3_fix_agent() { # $1=위반 힌트 파일 (f_violations.json 또는 content_gate 출력 텍스트)
  local hint; hint=$(head -c 6000 "$1")
  local p
  read -r -d '' p <<'PEOF' || true
너는 TC F열 문장 교정 담당이다. 아래 위반 보고의 해당 idx 행만 고친다.

__RULES__

## 위반 보고
__HINT__

## 작업
"__WORK__/tc_f_map.json" 을 Read하고, 위반된 idx 행의 f만 위 규칙에 맞게 재작성해 같은 파일에 반영하라(Edit 도구).
idx·d는 절대 바꾸지 마라. 다른 파일 생성·수정 금지. 완료 후 "FIX_DONE"만 출력.
PEOF
  p=${p//__RULES__/$S3RULES}; p=${p//__HINT__/$hint}; p=${p//__WORK__/$WORK}
  run_llm "S3-교정" sonnet "$p" || fail "S3 문장 교정 에이전트 실패"
}

if [[ $ST -le 3 ]]; then
  log "[S3] 골격 생성 (direct_convert convert)"
  "$NODE" "$UTIL/direct_convert.js" convert "$SPEC/tc_design.md" "$WORK" >>"$CHAIN_LOG" 2>&1
  rc=$?
  [[ $rc -eq 4 ]] && stop_integrity "S3 직변환 blocker — conversion_blocker.json 확인, 세션에서 설계 수정 필요"
  [[ $rc -ne 0 ]] && fail "S3 convert 오류 rc=$rc"
  vhelp ranges "$WORK/tc_skeleton.json" "$WORK/s3_ranges.json" || fail "S3 ranges 계산 실패"

  S3RULES=$("$NODE" "$HELPERS" extract-s3-rules "$WFDIR") || fail "S3 규칙 추출 실패(워크플로우 구조 변경?)"
  rm -f "$WORK"/fmap_chunk_*.json "$WORK"/.chunk_verr_*.txt

  # 문장화 청크 병렬 (2026-08-19, 근거: docs/s3_병렬화_실측_20260816.md):
  #   청크는 서로 독립(fmap_chunk_<S>.json 분리)이라 동시 진행 가능. S4 커버리지 원장과 같은
  #   웨이브 배치 — 동시 인스턴스를 S3PAR로 묶는다(무제한 팬아웃 = 순간 레이트 폭주).
  #   실측 300TC 환산: 순차 40분46초 → 동시 3에서 16분36초 / 동시 4에서 13분08초 [estimated].
  #   기본값 4 (2026-08-19 승인). 실측 문서 권고는 3이었으나 그 근거인 "K=4 지연 +13.2%"는
  #   13행 이상치 청크 1개(213초)에 기인하고, 같은 문서 관측 2가 그 청크를 분산 이상치로 지목한다.
  #   그 하나를 빼면 K=4 평균 131.3초 < K=1 기준선 135.5초. K=6 이상은 실측 표본 없음 — 올리려면 먼저 재기.
  #   - stderr 로그는 청크별 분리(.chunk_<S>_stderr.log) — 공유하면 재시도 분류가 타 청크 출력을 읽는다(85행 경고).
  #   - 검증 실패 사유도 청크별 분리(.chunk_verr_<S>.txt) — 공유하면 재시도 프롬프트에 남의 실패 사유가 붙는다.
  #   - 자식 안 stop_auth/stop_quota의 exit 10/15는 서브셸만 종료 → 부모가 wait 코드로 회수해 전파.
  #   - 청크 재시도(2회)는 서브셸 안에 지역화 — 한 청크 재시도가 웨이브의 다른 청크를 막지 않는다.
  #   - 웨이브 전원 wait 완료 전에는 assemble-fmap 진입 불가 — 부분 완료가 merge로 새는 경로 없음.
  S3PAR="${TCTEAM_S3_PAR:-4}"
  N_CHUNK=$("$NODE" -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).ranges.length)" "$WORK/s3_ranges.json")
  log "[S3] 문장화 — 청크 ${N_CHUNK}개(25행/청크) · 동시 ${S3PAR}"
  S3_AUTH="" ; S3_QUOTA="" ; S3_FAIL=""
  CI=0
  while [[ $CI -lt $N_CHUNK ]]; do
    # 인증·한도는 남은 배치를 띄워봐야 같이 죽는다. 검증 2회 실패(S3_FAIL)도 여기서 끊는다 —
    # 구 직렬판이 그 자리에서 fail 하던 fail-fast 보존. S4 렌즈·커버리지와 달리 S3는 재진입 시
    # fmap_chunk_*.json 을 전부 지우고 다시 만들므로, 계속 띄운 청크의 산출물은 재개에 쓰이지 않는다(순수 낭비).
    [[ -n "$S3_AUTH$S3_QUOTA$S3_FAIL" ]] && break
    declare -A S3_PID=()
    B=0
    while [[ $B -lt $S3PAR && $CI -lt $N_CHUNK ]]; do
      RANGE=$("$NODE" -e "const r=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).ranges[process.argv[2]];console.log(r[0]+' '+r[1])" "$WORK/s3_ranges.json" "$CI")
      S=${RANGE% *}; E=${RANGE#* }
      log "[S3] 문장화 청크 $((CI+1))/$N_CHUNK (idx $S~$((E-1)))"
      (
        RUN_LLM_ERRLOG="$WORK/.chunk_${S}_stderr.log"
        VERR="$WORK/.chunk_verr_$S.txt"
        ATT=0
        while :; do
          read -r -d '' P <<'PEOF' || true
__RULES__

## 작업
"__WORK__/tc_skeleton.json" 파일을 Read 도구로 읽어라. rows 배열에서 **idx가 __S__ 이상 __E__ 미만**인 행만 처리한다(정확히 __CNT__개). 각 행의 leaf를 위 규칙대로 완성 문장 f로 만들고, idx·d(소분류)는 그대로 echo.
결과는 반드시 "__WORK__/fmap_chunk___S__.json" 에 아래 형식 JSON으로 Write 도구로 저장하라(다른 파일 생성·수정 금지):
{"rows":[{"idx":<번호>,"d":"<입력 그대로>","f":"<완성 문장>"}, ...]}
저장 후 "CHUNK_DONE __S__" 한 줄만 출력하고 종료.
PEOF
          P=${P//__RULES__/$S3RULES}; P=${P//__WORK__/$WORK}; P=${P//__S__/$S}; P=${P//__E__/$E}; P=${P//__CNT__/$((E-S))}
          [[ $ATT -gt 0 ]] && P="$P

⚠ 직전 시도는 검증 실패였다: $(cat "$VERR" 2>/dev/null). 형식·개수·echo를 정확히 지켜 다시."
          run_llm "S3-fmap($S-$E)" sonnet "$P" || true
          if "$NODE" "$HELPERS" validate-chunk "$WORK/tc_skeleton.json" "$WORK/fmap_chunk_$S.json" "$S" "$E" > "$VERR" 2>&1; then
            exit 0
          fi
          ATT=$((ATT+1))
          if [[ $ATT -ge 2 ]]; then log "[S3] 청크 $S~$E 검증 2회 실패: $(cat "$VERR")"; exit 1; fi
          log "[S3] 청크 $S 재시도 ($(cat "$VERR"))"
        done
      ) &
      S3_PID[$S]=$!
      CI=$((CI+1)); B=$((B+1))
    done
    for K in "${!S3_PID[@]}"; do
      wait "${S3_PID[$K]}"; rc=$?
      case $rc in
        0)  ;;
        10) S3_AUTH="$S3_AUTH $K" ;;
        15) S3_QUOTA="$S3_QUOTA $K" ;;
        *)  S3_FAIL="$S3_FAIL $K" ;;
      esac
    done
    unset S3_PID
  done
  [[ -n "$S3_AUTH" ]]  && exit 10
  [[ -n "$S3_QUOTA" ]] && exit 15
  [[ -n "$S3_FAIL" ]]  && fail "S3 문장화 청크 실패(시작 idx):$S3_FAIL — 청크별 .chunk_verr_<S>.txt / .chunk_<S>_stderr.log 확인"

  vhelp assemble-fmap "$WORK" || fail "S3 fmap 조립 실패"

  MROUND=0
  while :; do
    "$NODE" "$UTIL/direct_convert.js" merge "$WORK" >>"$CHAIN_LOG" 2>&1
    rc=$?
    [[ $rc -eq 0 ]] && break
    if [[ $rc -eq 5 && $MROUND -lt 2 && -f "$WORK/f_violations.json" ]]; then
      MROUND=$((MROUND+1)); log "[S3] F열 위반 — 교정 라운드 $MROUND"
      s3_fix_agent "$WORK/f_violations.json"
    else
      [[ $rc -eq 5 ]] && stop_integrity "S3 F열 위반 교정 2회 실패 — f_violations.json 확인"
      fail "S3 merge 오류 rc=$rc"
    fi
  done

  "$NODE" "$LIB/snapshot_local.js" "$WORK/tc_data.json" "$WORK/tcteam_snapshot.json" "$TAB" >>"$CHAIN_LOG" 2>&1 || fail "S3 snapshot_local 실패"
  "$NODE" "$LIB/content_gate.js" "$WORK/tcteam_snapshot.json" > "$WORK/.content_gate_out.txt" 2>&1
  rc=$?; cat "$WORK/.content_gate_out.txt" >>"$CHAIN_LOG"
  if [[ $rc -eq 7 ]]; then
    log "[S3] content_gate 위반 — 교정 1라운드"
    s3_fix_agent "$WORK/.content_gate_out.txt"
    "$NODE" "$UTIL/direct_convert.js" merge "$WORK" >>"$CHAIN_LOG" 2>&1 || stop_integrity "S3 교정 후 merge 재실패"
    "$NODE" "$LIB/snapshot_local.js" "$WORK/tc_data.json" "$WORK/tcteam_snapshot.json" "$TAB" >>"$CHAIN_LOG" 2>&1 || fail "S3 snapshot 재생성 실패"
    "$NODE" "$LIB/content_gate.js" "$WORK/tcteam_snapshot.json" >>"$CHAIN_LOG" 2>&1 || stop_integrity "S3 content_gate 재위반 — 사람 확인"
  elif [[ $rc -ne 0 ]]; then
    fail "S3 content_gate 오류 rc=$rc"
  fi
  log "[S3] 완료 — 스냅샷 생성"
  mark s3
fi

# ══ S4 — 적대 리뷰(3렌즈+판정) + 커버리지 원장 (LLM, 파일 계약) ═══════════════
if [[ $ST -le 4 ]]; then
  # S3→S4 입력 계약 (2026-08-09): 재개(--start-from s4) 경로에서 S3 산출물이 없으면
  # dup_gate는 경고만 남기고 렌즈가 빈 입력으로 진행하는 사각이 있다 — 여기서 명시 정지.
  [[ -f "$WORK/tcteam_snapshot.json" ]] || fail "S4 입력 없음 — tcteam_snapshot.json (S3 먼저 완료 필요)"
  log "[S4] 리뷰 입력 배치"
  # tc_design.md는 $WORK=$SPEC이라 이미 제자리 (07-29 경로 통합 — 구 cp 제거)
  [[ -f "$TCTEAM/docs/eval_digest.md" ]] && cp "$TCTEAM/docs/eval_digest.md" "$WORK/eval_digest.md"
  [[ -f "$RULESDIR/tc-학습.md" ]] && cp "$RULESDIR/tc-학습.md" "$WORK/tc-학습.md"

  # 결정론 후보 추출기 2종 → 렌즈·판정자 입력 (2026-07-28 신설).
  #   비차단(리포트 전용): 판정은 S4 LLM이 원문 문맥을 보고 한다. 여기서 exit로 체인을 세우지 않는다.
  #   ⚠ 산출물에 소비자가 없으면 데드가 되므로 워크플로우 렌즈 프롬프트가 이 두 파일을 Read하도록 배선돼 있다.
  log "[S4] 결정론 후보 추출 (중복·원문대조)"
  "$NODE" "$LIB/dup_gate.js" "$WORK/tcteam_snapshot.json" --out "$WORK/dup_report.json" >>"$CHAIN_LOG" 2>&1
  DRC=$?
  [[ $DRC -eq 2 ]] && log "[S4][경고] dup_gate 입력 오류 — 중복 후보 없이 진행"
  [[ $DRC -eq 1 ]] && log "[S4] 중복 후보 검출(완전동일 포함) — dup_report.json → 판정자 입력"
  "$NODE" "$LIB/origin_gate.js" "$WORK/tcteam_snapshot.json" "$SPEC/confluence_raw.md" --out "$WORK/origin_report.json" >>"$CHAIN_LOG" 2>&1
  ORC=$?
  [[ $ORC -eq 2 ]] && log "[S4][경고] origin_gate 입력 오류 — 원문대조 후보 없이 진행"
  [[ $ORC -eq 3 ]] && log "[S4] 원문 미근거 후보 검출 — origin_report.json → 판정자 입력"
  # 아이템 실명 병기 게이트 (2026-08-13) — item_dict.json 있을 때만. 확정 위반 4종 + 축1 후보.
  #   규칙 SSoT=rules/tc-설계.md §아이템 실명 병기. 사전 없으면 exit 4로 스킵(비차단).
  "$NODE" "$LIB/item_cite_gate.js" "$WORK/tcteam_snapshot.json" "$SPEC/item_dict.json" --out "$WORK/item_cite_report.json" >>"$CHAIN_LOG" 2>&1
  IRC=$?
  [[ $IRC -eq 2 ]] && log "[S4][경고] item_cite_gate 입력 오류 — 병기 검사 없이 진행"
  [[ $IRC -eq 4 ]] && log "[S4] item_cite_gate 스킵 — item_dict.json 없음(비차단)"
  [[ $IRC -eq 3 ]] && log "[S4] 아이템 병기 위반·후보 검출 — item_cite_report.json → 판정자 입력"

  LENSJSON=$("$NODE" "$HELPERS" extract-s4-lenses "$WFDIR" "$WORK") || fail "S4 렌즈 추출 실패(워크플로우 구조 변경?)"
  # 렌즈 3종 병렬 실행 (2026-08-09, 실측: 순차 렌즈 구간 중앙값 9.9분/런 단축):
  #   - 입출력이 서로 독립(lens_<key>.json 분리)이라 동시 진행 가능. 재시도 루프째 서브셸로 격리.
  #   - stderr 로그는 렌즈별 분리(.lens_<key>_stderr.log) — 공유하면 재시도 분류가 타 렌즈 출력을 읽는다.
  #   - 자식 안 stop_auth/stop_quota의 exit 10/15는 서브셸만 종료 → 부모가 wait 코드로 회수해 전파.
  #     ([STOP:...] 로그는 자식 run_llm이 이미 남기므로 부모는 exit만 한다 — 중복 로그 금지)
  #   - 3렌즈 전원 wait 완료 전에는 판정자 진입 불가 — 부분 완료 상태가 S5로 새는 경로 없음.
  #     실패 렌즈가 있어도 나머지는 끝까지 기다린다(산출물 보존 → --start-from s4 재개 시 활용).
  declare -A LENS_PID=()
  for KEY in structure quality crossref; do
    FOCUS=$("$NODE" -e "const l=JSON.parse(process.argv[1]).find(x=>x.key===process.argv[2]);if(!l)process.exit(1);console.log(l.focus)" "$LENSJSON" "$KEY") || fail "S4 렌즈($KEY) 없음"
    log "[S4] 렌즈 진단(병렬): $KEY"
    (
      RUN_LLM_ERRLOG="$WORK/.lens_${KEY}_stderr.log"
      ATT=0
      while :; do
        read -r -d '' P <<'PEOF' || true
너는 TC 리뷰어의 "__KEY__" 렌즈다. 아래 관점으로만 진단(타 렌즈 영역 침범 금지). 확실한 것만, 없으면 빈 배열.

__FOCUS__

각 결함에 tc_id·severity(CRITICAL|HIGH|MEDIUM|LOW)·issue·suggested_fix·kind(edit|add|delete).
결과는 반드시 "__WORK__/lens___KEY__.json" 에 {"findings":[...]} JSON으로 Write 도구로 저장하라(다른 파일 생성·수정 금지). 저장 후 "LENS_DONE __KEY__"만 출력.
PEOF
        P=${P//__KEY__/$KEY}; P=${P//__FOCUS__/$FOCUS}; P=${P//__WORK__/$WORK}
        run_llm "S4-렌즈($KEY)" sonnet "$P" || true
        if "$NODE" "$HELPERS" validate-json "$WORK/lens_$KEY.json" findings >/dev/null 2>&1; then exit 0; fi
        ATT=$((ATT+1))
        if [[ $ATT -ge 2 ]]; then log "[S4] 렌즈 $KEY 산출 검증 2회 실패"; exit 1; fi
        log "[S4] 렌즈 $KEY 재시도"
      done
    ) &
    LENS_PID[$KEY]=$!
  done
  LENS_AUTH="" ; LENS_QUOTA="" ; LENS_FAIL=""
  for KEY in structure quality crossref; do
    wait "${LENS_PID[$KEY]}"; rc=$?
    case $rc in
      0)  ;;
      10) LENS_AUTH="$LENS_AUTH $KEY" ;;
      15) LENS_QUOTA="$LENS_QUOTA $KEY" ;;
      *)  LENS_FAIL="$LENS_FAIL $KEY" ;;
    esac
  done
  [[ -n "$LENS_AUTH" ]]  && exit 10
  [[ -n "$LENS_QUOTA" ]] && exit 15
  [[ -n "$LENS_FAIL" ]]  && fail "S4 렌즈 병렬 실행 실패:$LENS_FAIL (렌즈별 .lens_<key>_stderr.log 확인)"

  log "[S4] 판정자 (상호반박 → fix_plan)"
  ATT=0
  while :; do
    read -r -d '' P <<'PEOF' || true
너는 리뷰 판정자다. 3렌즈 findings를 상호 검증(상호반박)해 **실제 수정만** fix_plan(patches)으로 확정한다. 오탐·중복·저가치는 드롭.
(⚠ 이 프롬프트의 규칙은 workflows/tcteam-s4-review.js 판정자와 동일 계약이어야 한다 — 규칙 변경 시 양쪽 함께.)

findings 3파일을 Read하라: "__WORK__/lens_structure.json" · "__WORK__/lens_quality.json" · "__WORK__/lens_crossref.json"
"__WORK__/tcteam_snapshot.json" 을 Read해 실제 tc_id(A열)와 현재 셀값 확인. 규칙:
- edit_cell: {"op":"edit_cell","tc_id":"...","col":"F|J|E|G","before":"현재값 그대로","after":"...","reason":"..."}. after는 추상표현 금지·사람언어·단일문장.
- add_row: {"op":"add_row","after_tc_id":"앵커","row":{"b":"","c":"","d":"","e":"","f":"","g":"","j":""},"reason":"..."}. 커버리지 누락 신규행. g는 정확히 PC|모바일|PC/모바일. ⚠ 앵커는 같은 소분류(d)의 마지막 행으로 골라 그룹 분산(V-17) 방지.
- delete_row: {"op":"delete_row","tc_id":"...","reason":"..."}. 무의미 중복만.
- 확신 없으면 배제. patches 비어도 정상.
결과는 "__WORK__/fix_plan.json" 에 {"rationale":"...","patches":[...]} JSON으로 Write하라(다른 파일 금지). 저장 후 "JUDGE_DONE"만 출력.
PEOF
    P=${P//__WORK__/$WORK}
    run_llm "S4-판정" sonnet "$P" high || true
    if "$NODE" "$HELPERS" validate-json "$WORK/fix_plan.json" fixplan >/dev/null 2>&1; then break; fi
    ATT=$((ATT+1)); [[ $ATT -ge 2 ]] && fail "S4 fix_plan 산출 검증 2회 실패"
    log "[S4] 판정자 재시도"
  done

  # 커버리지 원장 — 청크 분할 + 청크 병렬 (2026-08-10)
  #   규칙 전량을 한 번에 뱉으면 출력이 **32k 토큰 상한**에 걸린다. 실사고 3건
  #   (아이템_강화_연출·기능B·월드맵_시스템_개선_v2). 상한 초과는 매핑을 다 끝낸 뒤
  #   출력만 못 하고 죽어 시간이 100% 날아가고, 재시도까지 겹쳐 실측 88.3분(LLM 3회분)이 됐다.
  #   → S3 문장화와 같은 방식으로 rules를 끊고 결정론 조립. 청크는 서로 독립이라 병렬 실행하되
  #     동시 인스턴스는 COVPAR로 묶는다(무제한 팬아웃 = 순간 레이트 폭주).
  COVSIZE="${TCTEAM_COV_CHUNK:-50}"
  COVPAR="${TCTEAM_COV_PAR:-3}"
  "$NODE" "$HELPERS" cov-ranges "$WORK/slices.json" "$WORK/s4_cov_ranges.json" "$COVSIZE" >>"$CHAIN_LOG" 2>&1 \
    || fail "S4 커버리지 청크 범위 계산 실패"
  rm -f "$WORK"/cov_chunk_*.json
  N_COV=$("$NODE" -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).chunks.length)" "$WORK/s4_cov_ranges.json")
  if [[ "$N_COV" -eq 0 ]]; then
    # 규칙 0개(슬라이서가 아무것도 못 뽑은 기획서) — LLM 호출 없이 빈 원장. traceability가 이어서 판정한다.
    log "[S4][경고] slices.json 규칙 0개 — 커버리지 원장 빈 배열로 단락"
    printf '[]' > "$WORK/coverage.json"; printf '[]' > "$WORK/exclusions.json"
  else
  log "[S4] 커버리지 원장 — 청크 ${N_COV}개(규칙 ${COVSIZE}개/청크) · 동시 ${COVPAR}"
  COV_AUTH="" ; COV_QUOTA="" ; COV_FAIL=""
  CI=0
  while [[ $CI -lt $N_COV ]]; do
    [[ -n "$COV_AUTH$COV_QUOTA" ]] && break   # 인증·한도는 남은 배치를 띄워봐야 같이 죽는다
    declare -A COV_PID=()
    B=0
    while [[ $B -lt $COVPAR && $CI -lt $N_COV ]]; do
      IDS=$("$NODE" -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).chunks[process.argv[2]].ids.join(', '))" "$WORK/s4_cov_ranges.json" "$CI") \
        || fail "S4 커버리지 청크 $CI id 목록 추출 실패"
      (
        RUN_LLM_ERRLOG="$WORK/.cov_${CI}_stderr.log"
        ATT=0
        while :; do
          read -r -d '' P <<'PEOF' || true
너는 커버리지 원장 담당이다. 규칙→TC 의미 매핑만 한다(문장 수정 금지).
**이번에 담당하는 규칙은 아래 목록뿐이다. 목록 밖 rule_id는 절대 언급·처리하지 마라.**

담당 rule_id: __IDS__

1. "__WORK__/slices.json" Read — rules[] 중 담당 rule_id의 원문만 본다.
2. "__WORK__/tcteam_snapshot.json" Read — rows (A열 tc_id, F열 문장). TC는 전체를 본다(담당 규칙을 커버하는 TC가 어디에 있든 찾아야 한다).
3. 각 담당 rule을 의미로 커버하는 tc_ids 매핑 — 키워드 매칭이 아니라 의미 판단.
4. 커버 TC가 없는 규칙만 제외 검토 — 제외 사유는 딱 3종: "타기획서" | "비TC성서술" | "중복규칙".
   '추후구현'은 제외 사유가 될 수 없다(M-021) — 그런 규칙은 **두 배열 어디에도 넣지 마라**(미커버로 남기면 봉합 루프가 TC로 전개한다).
5. "__WORK__/cov_chunk___CI__.json" 에 아래 형식으로 Write(다른 파일 생성·수정 금지):
{"coverage":[{"rule_id":"...","tc_ids":["..."],"note":"..."}],"exclusions":[{"rule_id":"...","reason":"타기획서|비TC성서술|중복규칙","detail":"..."}]}
   같은 rule_id를 두 배열에 동시에 넣지 마라. 담당 목록 밖 rule_id 금지.
저장 후 "COVERAGE_DONE __CI__"만 출력.
PEOF
          P=${P//__IDS__/$IDS}; P=${P//__WORK__/$WORK}; P=${P//__CI__/$CI}
          run_llm "S4-커버리지($CI)" sonnet "$P" || true
          if "$NODE" "$HELPERS" validate-cov-chunk "$WORK/s4_cov_ranges.json" "$WORK/cov_chunk_$CI.json" "$CI" >/dev/null 2>&1; then exit 0; fi
          ATT=$((ATT+1))
          if [[ $ATT -ge 2 ]]; then log "[S4] 커버리지 청크 $CI 검증 2회 실패"; exit 1; fi
          log "[S4] 커버리지 청크 $CI 재시도"
        done
      ) &
      COV_PID[$CI]=$!
      CI=$((CI+1)); B=$((B+1))
    done
    for K in "${!COV_PID[@]}"; do
      wait "${COV_PID[$K]}"; rc=$?
      case $rc in
        0)  ;;
        10) COV_AUTH="$COV_AUTH $K" ;;
        15) COV_QUOTA="$COV_QUOTA $K" ;;
        *)  COV_FAIL="$COV_FAIL $K" ;;
      esac
    done
    unset COV_PID
  done
  [[ -n "$COV_AUTH" ]]  && exit 10
  [[ -n "$COV_QUOTA" ]] && exit 15
  [[ -n "$COV_FAIL" ]]  && fail "S4 커버리지 청크 실패:$COV_FAIL (청크별 .cov_<n>_stderr.log 확인)"
  vhelp assemble-coverage "$WORK" || fail "S4 커버리지 조립 실패(청크 간 rule_id 중복/동시등재)"
  fi
  "$NODE" "$HELPERS" validate-json "$WORK/coverage.json" coverage >/dev/null 2>&1 \
    && "$NODE" "$HELPERS" validate-json "$WORK/exclusions.json" exclusions >/dev/null 2>&1 \
    || fail "S4 커버리지 조립 결과 검증 실패"
  log "[S4] 완료"
  mark s4
fi

# ══ S5 — 적용 + 게이트 (결정론, 미커버 봉합 1라운드) ══════════════════════════
if [[ $ST -le 5 ]]; then
  log "[S5] fix_plan 적용"
  "$NODE" "$LIB/apply_fix_plan.js" "$WORK/tcteam_snapshot.json" "$WORK/fix_plan.json" "$WORK/tcteam_tc_final.json" --ledger "$WORK/applied_patches.json" >>"$CHAIN_LOG" 2>&1 || fail "S5 apply_fix_plan 실패"
  "$NODE" "$LIB/regroup.js" "$WORK/tcteam_tc_final.json" "$WORK/tcteam_tc_final.json" >>"$CHAIN_LOG" 2>&1 || fail "S5 regroup 실패"
  "$NODE" "$LIB/content_gate.js" "$WORK/tcteam_tc_final.json" >>"$CHAIN_LOG" 2>&1 || stop_integrity "S5 content_gate 위반 — fix_plan 산출 확인 필요"
  # 완전 동일 중복 차단 (2026-07-28): S4 판정자가 dup_report의 exact를 처리하지 않으면 여기서 막는다.
  #   유사쌍은 정당한 분리일 수 있어 차단하지 않는다 — exact(F열 완전 일치)만 게이트.
  "$NODE" "$LIB/dup_gate.js" "$WORK/tcteam_tc_final.json" --out "$WORK/dup_report_final.json" >>"$CHAIN_LOG" 2>&1 || \
    stop_integrity "S5 중복 게이트 — F열 완전 동일 TC 잔존(dup_report_final.json). 병합 또는 조건 차이 명시 필요"

  SEALED=0
  while :; do
    "$NODE" "$LIB/traceability.js" "$WORK/slices.json" "$WORK/coverage.json" "$WORK/exclusions.json" "$WORK/traceability.json" >>"$CHAIN_LOG" 2>&1
    rc=$?
    [[ $rc -eq 0 ]] && break
    [[ $rc -ne 8 ]] && fail "S5 traceability 오류 rc=$rc"
    [[ $SEALED -ge 1 ]] && stop_integrity "S5 봉합 후에도 미커버 잔존 — traceability.json 확인"
    UNCOV=$("$NODE" -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).uncovered.join(', '))" "$WORK/traceability.json")
    log "[S5] 미커버 봉합 라운드 — $UNCOV"
    read -r -d '' P <<'PEOF' || true
너는 커버리지 봉합 담당이다. 미커버 규칙을 TC로 전개한다(add_row만).
미커버 rule_id: __UNCOV__
1. "__WORK__/slices.json" 에서 해당 rules 원문 확인, "__WORK__/tcteam_tc_final.json" Read(현재 행·소분류 구조 파악).
2. 각 미커버 규칙마다 add_row 패치 작성 — {"op":"add_row","after_tc_id":"같은 소분류(d) 마지막 행(V-17)","row":{"b":"...","c":"...","d":"...","e":"정상|부정|예외","f":"...","g":"PC|모바일|PC/모바일","j":"..."},"reason":"..."}.
   f는 F열 규칙(개행 없는 단일문장·"~확인" 종결·추상표현 금지·구체적 기대결과·부정/예외는 사전상태 명시).
   '추후구현' 성격 규칙이면 j="추후 구현" (TC 전개는 필수 — 제외 불가, M-021).
3. "__WORK__/fix_plan_seal.json" 에 {"rationale":"...","patches":[add_row만]} Write.
4. "__WORK__/coverage_seal.json" 에 [{"rule_id":"...","f_texts":["<추가한 각 행의 f 전문 그대로>"]}] Write — 적용 후 f 전문 매칭으로 tc_id를 결정론 회수한다.
다른 파일 금지. 저장 후 "SEAL_DONE"만 출력.
PEOF
    P=${P//__UNCOV__/$UNCOV}; P=${P//__WORK__/$WORK}
    run_llm "S5-봉합" sonnet "$P" || fail "S5 봉합 에이전트 실패"
    "$NODE" "$HELPERS" validate-json "$WORK/fix_plan_seal.json" fixplan >/dev/null 2>&1 || stop_integrity "S5 봉합 fix_plan 검증 실패"
    "$NODE" "$LIB/apply_fix_plan.js" "$WORK/tcteam_tc_final.json" "$WORK/fix_plan_seal.json" "$WORK/tcteam_tc_final.json" --ledger "$WORK/applied_patches_seal.json" >>"$CHAIN_LOG" 2>&1 || stop_integrity "S5 봉합 적용 실패"
    "$NODE" "$LIB/regroup.js" "$WORK/tcteam_tc_final.json" "$WORK/tcteam_tc_final.json" >>"$CHAIN_LOG" 2>&1 || fail "S5 봉합 regroup 실패"
    "$NODE" "$LIB/content_gate.js" "$WORK/tcteam_tc_final.json" >>"$CHAIN_LOG" 2>&1 || stop_integrity "S5 봉합 후 content_gate 위반"
    vhelp seal-coverage "$WORK" || stop_integrity "S5 봉합 coverage 병합 실패(f 전문 미매칭)"
    SEALED=1
  done
  touch "$WORK/tc_final.ok"
  log "[S5] 완료 — tc_final.ok"
  mark s5
fi

# ══ S6 — 라이브 기록 + read-back (시트 1회 접촉) ══════════════════════════════
if [[ $ST -le 6 ]]; then
  log "[S6] 시트 기록 (sheet_write)"
  "$NODE" "$LIB/sheet_write.js" "$WORK/tcteam_tc_final.json" "$SHEET_ID" "$TAB" "$WORK" >>"$CHAIN_LOG" 2>&1 || fail "S6 sheet_write 실패"
  RTAB=$(resolved_tab)
  log "[S6] read-back QA (탭: $RTAB)"
  "$NODE" "$UTIL/read_gsheet_data.js" "$SHEET_ID" "$RTAB" > "$WORK/.readback_dump.json" 2>>"$CHAIN_LOG" || fail "S6 재덤프 실패"
  "$NODE" "$HELPERS" readback-diff "$WORK/tcteam_tc_final.json" "$WORK/.readback_dump.json" >>"$CHAIN_LOG" 2>&1 || stop_integrity "S6 read-back diff — 시트 기록 불일치"
  log "[S6] 완료 — read-back 0-diff"
  mark s6
fi

# ══ S7 — 완료처리 (공용 실행기 위임 — 데스크톱과 동일 동작) ══════════════════
# 절차·순서·문구는 rules/완료처리.md가 소유하고, finalize.sh가 그걸 읽어 실행한다.
# (07-28: 여기 인라인 복제를 폐기 — md만 고치면 데스크톱·Loki 양쪽에 반영되도록)
if [[ $ST -le 7 ]]; then
  RTAB=$(resolved_tab)
  CURL2=$(grep -m1 '^CONFLUENCE_URL=' "$SPEC/sheet_info.txt" | cut -d= -f2- | tr -d '"\r'); [[ -z "$CURL2" ]] && CURL2="$CONF_URL"

  log "[S7] 완료처리 시작 (finalize.sh — 규칙서 순서·문구 참조)"
  bash "$TCTEAM/scripts/finalize.sh" --feature "$FEAT" --sheet-id "$SHEET_ID" \
    --tab "$RTAB" ${CURL2:+--conf-url "$CURL2"} >>"$CHAIN_LOG" 2>&1
  frc=$?
  # exit 20 = 일부 FINAL 단계 실패(try/continue 정책) — 파이프라인은 계속 진행
  [[ $frc -eq 20 ]] && log "[S7][경고] 일부 완료처리 단계 실패 — chain.log의 [FINALIZE] 라인 확인"
  [[ $frc -ne 0 && $frc -ne 20 ]] && log "[S7][경고] finalize.sh rc=$frc"

  "$NODE" "$LIB/state_projection.js" "$STATEJSON" "$FEAT" done >>"$CHAIN_LOG" 2>&1 || log "[S7][경고] state done 기록 실패"
  log "[S7] 완료처리 종료 (rc=$frc)"
  mark s7
  vhelp final-report "$SPEC" "$WORK" "$FEAT" || log "[S7][경고] final_report 생성 실패"
fi

# Evidence Pack 공통 봉투 (정본: {WORK_ROOT}/tool/_registry/evidence_pack.schema.json) — 실패해도 체인에 영향 없음
"$NODE" "$LIB/evidence_pack.js" --feature "$FEAT" --work "$WORK" --spec "$SPEC" --sheet "$SHEET_ID" --tab "$(resolved_tab)" >>"$CHAIN_LOG" 2>&1 || log "[EVIDENCE][경고] evidence pack 기록 실패 (체인 영향 없음)"

log "[CHAIN-FULL] 전 구간 완료 — $FEAT"
exit 0
