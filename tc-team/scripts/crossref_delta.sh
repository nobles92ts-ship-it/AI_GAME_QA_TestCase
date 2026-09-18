#!/usr/bin/env bash
# crossref_delta.sh — 델타 대조 함수 정의 (source 전용 — 직접 실행하지 않는다)
#
# 늦게 태어난 「기획 확인 필요」를 사람에게 내보내기 전에 뇌(DXR 위키 색인)에 먼저 물어본다.
# 2026-09-09 오너 지시: "최근에 생기는 것들은 dxr 검색 부터". 본 대조는 S1→S2 사이 1회뿐이라
# 그 뒤에 태어난 질의는 뇌에 한 번도 안 물어본 채 사람에게 나갔다. 두 지점이 이 정의 하나를 쓴다:
#   crossref_delta fixplan S4 — run_pipeline_full.sh S4→S5 사이. 리뷰가 새로 단 「기획 확인 필요」
#   crossref_delta final   S7 — finalize.sh FINAL-5a(패널 도출·검증) 직후 · 5b(시트 기재) 직전.
#                                5a 가 방금 쓴 _labels.json 문장 ∪ 최종 TC 비고열 → 대조 → 답을 찾은 질문은 패널에서 뺀다
#                                (2026-09-11 오너 지시 — 꼬리표 주입 폐지. 남는 질문은 5a 문장 그대로)
#
# ⚠ S7 이 5a 뒤여야 하는 이유 (2026-09-11 이관, backlog §5): 구 자리(run_pipeline_full.sh, finalize 앞)는
#   _labels.json 이 태어나기 전이라 전 런 주입 0건이었다. 자리만 옮겨도 0건이다 — 주입기는 패널 문장과
#   대조 term 의 완전일치로 붙이는데, 패널 없이 모은 term 은 TC 비고열 문장이다. 패널 문장 자체를
#   질의 키로 쓰려면 수집부터 5a 뒤여야 한다.
#
# 호출측이 먼저 정의해야 하는 것: NODE LIB PROJECT_ROOT WORK SPEC FEAT RUNAGENT CLI_BASE CHAIN_LOG · 함수 log
# ⚠ 전 구간 비차단 — 대조는 선택 플러그인이라 어떤 실패도 로그만 남기고 호출측은 계속한다.

crossref_delta() {
  local MODE="$1" ORIGIN="$2"
  local v
  for v in NODE LIB PROJECT_ROOT WORK SPEC FEAT RUNAGENT CLI_BASE CHAIN_LOG; do
    if [[ -z "${!v:-}" ]]; then echo "[$ORIGIN-델타대조][경고] 호출측 변수 $v 미정의 — 스킵(비차단)" >&2; return 0; fi
  done
  declare -F log >/dev/null || { echo "[$ORIGIN-델타대조][경고] 호출측 log 함수 없음 — 스킵(비차단)" >&2; return 0; }
  # 지난 런의 「뺀 질문」 알림을 물려받지 않는다 — 대조 off·스킵 경로에선 아래 거르기가 안 돌아 새로 안 써지고,
  # 남아 있으면 chain_helpers final-report 가 이번 완주 보고에 거짓으로 싣는다. (확신도 배너의 rm 과 같은 이유)
  [[ "$MODE" == "final" ]] && rm -f "$SPEC/.final5_removed.txt"

  local XCFG="$PROJECT_ROOT/team/tc_config.json"
  local XON XSRC2 XIN XOUT XRC

  XON=$("$NODE" -e "try{const c=JSON.parse(require('fs').readFileSync('$XCFG','utf8'));process.stdout.write(c.crossref_brain==='on'?'on':'off')}catch(e){process.stdout.write('off')}" 2>/dev/null)
  [[ "$XON" != "on" ]] && return 0

  XIN="$WORK/crossref_delta_in_${ORIGIN}.json"
  XOUT="$WORK/crossref_delta_out_${ORIGIN}.json"
  "$NODE" "$LIB/crossref_delta_collect.js" --work "$WORK" --mode "$MODE" --out "$XIN" >>"$CHAIN_LOG" 2>&1
  XRC=$?
  if [[ $XRC -eq 4 ]]; then
    log "[$ORIGIN-델타대조] 신규 기획확인 0건 — 대조 스킵"
  elif [[ $XRC -ne 0 ]]; then
    log "[$ORIGIN-델타대조][경고] 수집 실패 — 대조 스킵(비차단)"
  else
    XSRC2=$("$NODE" -e "try{const c=JSON.parse(require('fs').readFileSync('$XCFG','utf8'));process.stdout.write(c.crossref_source||'brain-corpus')}catch(e){process.stdout.write('brain-corpus')}" 2>/dev/null)
    log "[$ORIGIN-델타대조] 신규 기획확인 대조 시작 (source=$XSRC2)"

    local XHD="## HANDOFF
- 기능명: $FEAT
- specs 경로: $SPEC
- 입력: $XIN  ← **이번 런에서 새로 태어난 「기획 확인 필요」 항목만** (본 대조 이후 발생분)
- 산출: $XOUT — {\"items\":[{id,term,branch,source,note,approved}]} (tc-대조.md §2.1 items 스키마)

## 작업 지시
$XIN 의 items 각 항목을 tc-대조.md 지침대로 제2의 뇌(DXR 위키 색인, ctx_search source=\"$XSRC2\")에 대조하라.
입력 item 의 id 를 **그대로 유지**해 결과 items 에 담을 것 — 병합기가 id 로 멱등 처리한다.
4분기(apply/locate/discover/keep) + 가드 전부 ON(스텁·(작성중)·애매·출처없음→keep).
로컬 데이터테이블 값: $SPEC/xlsx_extract.md 를 먼저 Read — 필요한 시트 블록이 있으면 그 값으로 apply(approved:true)하고 source 에 블록 제목을 그대로 옮긴다. 없으면 locate(tc-대조.md §1.2-2).
§1.2-1 그대로 — 브레인은 발명하지 않는다(추출본에 없는 값을 유추하지 않는다). 확신 없으면 keep.
§1.6 비파괴: 무적중·에러·뇌 미탑재 = 입력 전량을 keep 으로 채운 $XOUT 을 저장하고 정상 종료. 다른 파일은 건드리지 말 것."

    # CLAUDE_PROJECT_DIR 못박기 — context-mode 가 KB 를 고르는 최우선 변수다.
    # 안 박으면 체인을 어느 폴더에서 띄웠느냐에 따라 KB 가 조용히 갈린다(2026-08-23 무적중 결함의 경로).
    # 작업 폴더도 프로젝트 루트로 못박는다(2026-09-11) — 변수만 박고 다른 폴더에서 띄우자 KB 가 비어 전량 keep
    # (= 「근거 없음 (뇌 대조 완료)」 거짓 꼬리표)이 됐다. S7 이 finalize.sh 로 옮겨와 수동 `--only 5` 가 아무 폴더에서나 돈다.
    ( cd "$PROJECT_ROOT" && \
      CLAUDE_PROJECT_DIR="$PROJECT_ROOT" CONTEXT_MODE_PROJECT_DIR="$PROJECT_ROOT" \
      RUNAGENT_DEBUG_FILE="$SPEC/crossref_delta_${ORIGIN}.log" \
      bash "$RUNAGENT" $CLI_BASE --model sonnet --agent tc-team-대조 "$XHD" ) >>"$CHAIN_LOG" 2>&1 \
      || log "[$ORIGIN-델타대조][경고] 에이전트 비정상 종료 — fail-safe 스킵(비차단)"

    if [[ -f "$XOUT" ]]; then
      # --input: term·tc_id·context 는 수집 원문으로 되돌린다 — 에이전트가 고쳐 쓴 term 은 주입 매칭을 조용히 끊는다
      "$NODE" "$LIB/crossref_delta_merge.js" "$WORK/dxr_crossref.json" "$XOUT" --origin "$ORIGIN" --input "$XIN" >>"$CHAIN_LOG" 2>&1 \
        || log "[$ORIGIN-델타대조][경고] 병합 실패 — dxr_crossref.json 미갱신(비차단)"
    else
      log "[$ORIGIN-델타대조][경고] 산출 없음 — 병합 스킵(비차단)"
    fi
  fi

  # 소비처 — 답을 찾은 질문을 패널에서 뺀다(crossref_labels_annotate.js = 필터. 이름은 이력상 annotate).
  # 여기서 거르지 않으면 대조는 아무도 안 읽는 조용한 게이트가 되고, 기획자는 답이 이미 있는 질문을 받는다.
  # final 은 새로 물을 게 없어도(수집 0건) 원장 기준으로 매번 거른다 — 5a 가 _labels.json 을 매번 새로 쓰므로,
  # 재실행(finalize --only 5)에서 여기를 건너뛰면 이미 답을 찾은 질문이 패널에 되살아난다.
  [[ "$MODE" == "final" ]] || return 0
  local AOUT ARC AQ=0 AJ=0 AR=0 AM=0
  local RE_Q='질의 ([0-9]+)건' RE_J='판정 ([0-9]+)건' RE_R='제거 ([0-9]+)건' RE_M='남음 ([0-9]+)건'
  AOUT=$("$NODE" "$LIB/crossref_labels_annotate.js" "$SPEC/_labels.json" "$WORK/dxr_crossref.json" 2>&1)
  ARC=$?
  [[ -n "$AOUT" ]] && printf '%s\n' "$AOUT" >>"$CHAIN_LOG"
  if [[ $ARC -ne 0 ]]; then
    log "[$ORIGIN-델타대조][경고] 패널 거르기 스킵(_labels.json 또는 대조결과 없음 — 비차단)"
    return 0
  fi
  [[ $AOUT =~ $RE_Q ]] && AQ=${BASH_REMATCH[1]}
  [[ $AOUT =~ $RE_J ]] && AJ=${BASH_REMATCH[1]}
  [[ $AOUT =~ $RE_R ]] && AR=${BASH_REMATCH[1]}
  [[ $AOUT =~ $RE_M ]] && AM=${BASH_REMATCH[1]}
  log "[$ORIGIN-델타대조] 기획확인 패널 — 답 있는 질문 ${AR}건 제거 · 남은 질문 ${AM}건 (질의 ${AQ} · 판정 ${AJ})"
  # 자리·키가 틀리면 필터는 에러 없이 판정 0건으로 끝난다 — 숫자로 드러낸다(2026-09-11: 전 런이 이 모양이었다).
  # 기준이 「제거 0」이 아니라 「판정 0」인 이유: 답을 찾은 질문이 없는 런은 제거 0 이 정상이다.
  if (( AQ > 0 && AJ == 0 )); then
    log "[$ORIGIN-델타대조][경고] 패널 질의 ${AQ}건 중 판정 0건 — 대조 term 과 패널 문장 불일치 의심(비차단)"
  fi
  return 0
}
