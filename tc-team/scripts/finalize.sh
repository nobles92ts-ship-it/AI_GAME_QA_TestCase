#!/usr/bin/env bash
# finalize.sh — tc-team S7 완료처리 공용 실행기 (2026-07-28)
#
# 데스크톱 세션(SKILL.md S7)과 Loki 풀체인(run_pipeline_full.sh S7)이 **똑같이 이 스크립트를
# 호출**한다. 두 경로의 동작을 문자 그대로 일치시키기 위한 단일 실행기다(구 복제 폐기).
#
# SSoT: rules/완료처리.md — 실행 순서와 완료 안내 문구를 **런타임에 파싱**한다.
#       (패널 라벨·메모 문구는 add_project_info.js가 같은 md에서 읽는다)
#       → md만 고치면 데스크톱·Loki 양쪽에 반영. 사본 없음.
#
# 정책(규칙서 §실행 순서·정책): 한 단계 실패해도 다음 단계 계속(try/continue).
#   따라서 이 스크립트는 단계 실패로 종료하지 않는다 — 결과는 요약 라인과 exit 코드로 보고.
# exit 0=전 단계 성공 / 20=일부 단계 실패(파이프라인은 계속 진행 가능) / 1=인자 오류
#
# 사용: bash finalize.sh --feature <기능명> --sheet-id <ID> --tab <실제탭명> [--conf-url <URL>]
#       [--only "5"]  단발 재실행 — 지정 단계만 실행(규칙서 순서 무시). 예: 인증 만료로
#                     라벨링만 다시 돌릴 때 `--only 5`, 패널만 다시 그릴 때 `--only 2`.

set -uo pipefail

# 경로 해석(2026-07-29 이식성): tc-team/scripts/ → ../.. = 프로젝트 루트
# pwd -W = git-bash에서 Windows 형(C:/...)으로 출력. node.exe에 env로 넘길 때 /c/... 형은 깨진다.
PROJECT_ROOT="${TCTEAM_PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && { pwd -W 2>/dev/null || pwd; })}"
CLAUDE_HOME="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"

NODE="${TCTEAM_NODE:-node}"
UTIL="${TCTEAM_UTIL:-$PROJECT_ROOT/scripts/util}"
SPECS="${TCTEAM_SPECS:-$PROJECT_ROOT/team/specs}"
RULESDIR="${TCTEAM_RULES_DIR:-$CLAUDE_HOME/skills/tc-team/rules}"
RUNAGENT="$UTIL/run-agent.sh"
RULES_MD="$RULESDIR/완료처리.md"
CONFDIR="${TCTEAM_CONF_DIR:-$PROJECT_ROOT/tc-team/scripts/confidence}"

FEAT="" ; SHEET_ID="" ; TAB="" ; CONF_URL="" ; ONLY=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --feature)  FEAT="$2"; shift 2 ;;
    --sheet-id) SHEET_ID="$2"; shift 2 ;;
    --tab)      TAB="$2"; shift 2 ;;
    --conf-url) CONF_URL="$2"; shift 2 ;;
    --only)     ONLY="$2"; shift 2 ;;
    *) echo "알 수 없는 인자: $1" >&2; exit 1 ;;
  esac
done
[[ -n "$FEAT" && -n "$SHEET_ID" ]] || { echo "사용법: --feature <명> --sheet-id <ID> [--tab <탭명>] [--conf-url <URL>]" >&2; exit 1; }

SPEC="$SPECS/$FEAT"
# 탭명 미지정 시 sheet_info.txt(sheet_write가 _vN 해석 후 갱신)에서 회수
if [[ -z "$TAB" ]]; then
  TAB=$(grep -m1 '^TAB_NAME=' "$SPEC/sheet_info.txt" 2>/dev/null | cut -d= -f2- | tr -d '\r')
  [[ -z "$TAB" ]] && TAB="$FEAT"
fi
[[ -z "$CONF_URL" ]] && CONF_URL=$(grep -m1 '^CONFLUENCE_URL=' "$SPEC/sheet_info.txt" 2>/dev/null | cut -d= -f2- | tr -d '"\r')

say() { echo "[FINALIZE] $*"; }

# ── 실행 순서: 규칙서 "순서: **FINAL-1 → 2 → 5 → 3**" 라인에서 파싱 ────────────
ORDER=$("$NODE" -e "
const fs=require('fs');
try{
  const md=fs.readFileSync(process.argv[1],'utf8');
  const m=md.match(/^-\s*순서:\s*\*\*(.+?)\*\*/m);
  if(!m) throw new Error('순서 라인 없음');
  const nums=(m[1].match(/\d+/g)||[]).filter(n=>['0','1','2','3','5'].includes(n));
  if(!nums.length) throw new Error('단계 번호 없음');
  process.stdout.write([...new Set(nums)].join(' '));
}catch(e){ process.stderr.write('[경고] 순서 파싱 실패('+e.message+') — 기본값 0 1 2 5 3 사용\n'); process.stdout.write('0 1 2 5 3'); }
" "$RULES_MD")   # stderr(경고)은 캡처하지 않고 그대로 흘려보낸다
[[ -z "$ORDER" ]] && ORDER="0 1 2 5 3"
if [[ -n "$ONLY" ]]; then
  # 단발 재실행: 지정 단계만. 규칙서 순서는 무시하되 지원 단계(0·1·2·3·5)로 필터.
  ORDER=$(echo "$ONLY" | tr ',' ' ' | tr -s ' ' | xargs -n1 2>/dev/null | grep -E '^[01235]$' | tr '\n' ' ')
  ORDER="${ORDER% }"
  [[ -z "$ORDER" ]] && { echo "--only 값에 유효한 단계(0·1·2·3·5)가 없음: $ONLY" >&2; exit 1; }
  say "단발 재실행(--only): FINAL-${ORDER// / · }"
else
  say "실행 순서(규칙서): FINAL-${ORDER// / → }"
fi

declare -A RESULT=( [0]="—" [1]="—" [2]="—" [3]="—" [5]="—" )

# FINAL-5a validate_labels.js가 센 금지 어휘(라벨링_기준.md §문장 형식) 건수.
# 기재를 막지 않는 경고라 RESULT[5]는 ✓로 남는다 — 요약 줄에 안 실으면 chain.log에 묻힌다.
# 2026-08-10 실측: 규칙 도입 후 라벨 77건 중 9건에 금지어가 남았는데 아무도 못 봤다.
# FINAL-5를 안 도는 런(--only 1 등)에서는 0으로 남아 배너에 아무것도 붙지 않는다.
LABEL_BANNED=0

# ── FINAL-0: 확신도 스탬핑 (TC별 근거 점수 → A열 색·메모 + confidence.json/HTML) ──
# 판단 0 — S1~S2가 남긴 신호를 확정된 행에 옮겨 적기만 한다. 실패해도 완료처리는 계속.
# 2026-08-16 실사고(자동_사냥_기능_v3): 설계 트리 파싱이 0건이라 점수 0·색칠 0·드리프트 218행이
#   났는데 confidence_apply.js가 rc=0으로 끝나 FINAL-0:✓로 보고됐다. 이제 게이트가 rc=2를 내므로
#   ✗가 찍히지만, ✗ 한 글자는 완료 보고에서 묻힌다 — FINAL-5와 같은 방식으로 배너를 남긴다.
final_0() {
  rm -f "$SPEC/.final0_alert.txt"          # 지난 런의 배너를 물려받지 않는다
  say "FINAL-0 확신도 스탬핑"
  if "$NODE" "$CONFDIR/confidence_apply.js" --spec "$SPEC" --sheet-id "$SHEET_ID" --tab "$TAB" \
     && "$NODE" "$CONFDIR/confidence_report.js" --spec "$SPEC"; then
    RESULT[0]="✓"
  else
    RESULT[0]="✗"
    { echo "❌ FINAL-0 실패 — 확신도 미적용 (A열 색·메모 없음, 시트는 변경되지 않음)"
      echo "   사유: 위 [확신도] 라인 참조 (설계 트리 파싱 0건 / 설계↔시트 드리프트 과반)"
      echo "   확인: $SPEC/tc_design.md 의 '## 분류 그룹핑 트리'"
      echo "   복구: bash finalize.sh --feature \"$FEAT\" --sheet-id \"$SHEET_ID\" --tab \"$TAB\" --only 0"
    } > "$SPEC/.final0_alert.txt"
    say "══════════════════════════════════════════════════════════════"
    while IFS= read -r l; do say "$l"; done < "$SPEC/.final0_alert.txt"
    say "══════════════════════════════════════════════════════════════"
  fi
}

# ── FINAL-1: 대시보드 ─────────────────────────────────────────────────────────
final_1() {
  say "FINAL-1 대시보드 업데이트"
  if ( cd "$UTIL" && "$NODE" update_dashboard.js "$SHEET_ID" ); then RESULT[1]="✓"; else RESULT[1]="✗"; fi
}

# ── FINAL-2: K~O열 패널 (+ 담당자 Jira 자동 채움) ─────────────────────────────
final_2() {
  say "FINAL-2 K~O열 패널 (담당자 Jira 조회)"
  local assign
  assign=$("$NODE" "$UTIL/jira_assignees.js" "$SPEC/confluence_raw.md") || assign='{}'
  [[ -z "$assign" ]] && assign='{}'
  if "$NODE" "$UTIL/add_project_info.js" "$SHEET_ID" "$TAB" "$CONF_URL" --assignees "$assign"; then
    RESULT[2]="✓"
  else RESULT[2]="✗"; fi
}

# ── FINAL-5 실패 배너 — 경고 한 줄로 흘려보내지 않는다 ───────────────────────
# 2026-08-07 실사고(기능B_v3): 5a가 인용부호를 이스케이프하지 않아 _labels.json이
#   무효 JSON이 됐고, try/continue 정책 탓에 "기재 스킵" 한 줄만 남기고 런이 완주했다.
#   L/M 패널(기획 확인 요청 9건)이 통째로 빠진 걸 사흘 뒤 사람이 시트를 열어보고서야 발견.
# → 사유를 $SPEC/.final5_alert.txt 에 남긴다. chain_helpers.js final-report가 이 파일을 읽어
#   완주 보고(final_report.txt) 최상단에 붙이므로 초록불 보고로 끝나지 않는다.
alert_5() {
  { echo "❌ FINAL-5 실패 — L/M 패널(기획 확인 요청) 미기재"
    echo "   사유: $1"
    echo "   확인: $SPEC/_labels.json  (교정 실패한 원본은 _labels.broken.json)"
    echo "   복구: bash finalize.sh --feature \"$FEAT\" --sheet-id \"$SHEET_ID\" --tab \"$TAB\" --only 5"
  } > "$SPEC/.final5_alert.txt"
  say "══════════════════════════════════════════════════════════════"
  while IFS= read -r l; do say "$l"; done < "$SPEC/.final5_alert.txt"
  say "══════════════════════════════════════════════════════════════"
}

# 5a 에이전트 1회 실행 — 최초 도출과 교정 라운드가 같은 경로를 쓰도록 분리(2026-09-03).
# 쿼터·인증 감지는 pipeline_retry.sh가 소유(rc 10=인증, 11=쿼터) — 있으면 경유한다.
_run_5a() {
  if [[ -f "$UTIL/pipeline_retry.sh" ]]; then
    bash "$UTIL/pipeline_retry.sh" "$SPEC/.final5_stderr.log" -- \
      bash "$RUNAGENT" -p --permission-mode bypassPermissions --model sonnet "$1" >/dev/null 2>&1
    arc=$?
  else
    bash "$RUNAGENT" -p --permission-mode bypassPermissions --model sonnet "$1" >/dev/null 2>&1
    arc=$?
  fi
}

# ── FINAL-5: 기획 확인 라벨링 (5a 도출=agent 위임 / 5b 기재=스크립트) ─────────
final_5() {
  rm -f "$SPEC/.final5_alert.txt" "$SPEC/.final5_notice.txt"   # 지난 런의 배너를 물려받지 않는다
  say "FINAL-5a 기획확인 라벨 도출 (agent)"
  local p
  p="너는 기획 확인 라벨 도출 담당이다 (tc-team S7 FINAL-5a — 절차 SSoT: 완료처리.md).
1. \"$SPEC/analysis.md\"(C-1 미지정값·C-2 모호) + \"$SPEC/tc_design.md\"(기획 확인 필요 항목) Read.
2. \"$RULESDIR/라벨링_기준.md\" Read — **기획 확인(태그 4종)만** 도출. 품질 가드 4종 적용, 근거 확인, 키워드 매칭 금지.
3. \"$SPEC/_labels.json\" Write: {\"기획확인\": [\"[태그] 질문 한 문장?\\n왜 필요한지 한 줄 (사람 말)\", ...]} — 라벨링_기준.md §문장 형식 그대로. 화살표 접두 금지(구 형식 \\n→ 는 08-04 폐기). 테스트데이터 키는 생략(선택·수동 정책).
다른 파일 금지. 저장 후 \"LABELS_DONE\"만 출력."
  # 쿼터·인증 감지는 pipeline_retry.sh가 소유(rc 10=인증, 11=쿼터) — 있으면 경유한다.
  local arc=0
  _run_5a "$p"
  [[ $arc -eq 10 ]] && say "FINAL-5a 인증 만료 — 재로그인 후 라벨링만 재실행 필요"
  [[ $arc -eq 11 ]] && say "FINAL-5a 쿼터 초과 — 리셋 후 라벨링만 재실행 필요"
  # 산출물 검증 — 깨진 JSON을 apply_labeling에 넘기지 않는다.
  # validate_labels.js가 파싱·규격을 보고, 깨졌으면 인용부호 이스케이프 교정을 1회 시도한다.
  local vout vrc
  vout=$("$NODE" "$UTIL/validate_labels.js" "$SPEC/_labels.json" 2>&1); vrc=$?
  while IFS= read -r l; do [[ -n "$l" ]] && say "FINAL-5a $l"; done <<< "$vout"
  # rc 5 = 질문줄 영문 키(차단 등급, 2026-09-03 오너 지시). 내용은 멀쩡하므로 버리지 않고
  # 교정 라운드를 1회 돌린다 — S3 F열 재문장화 루프와 같은 방식(런을 죽이지 않고 그 항목만 고침).
  if [[ $vrc -eq 5 ]]; then
    say "FINAL-5a 질문줄 영문 키 — 교정 라운드 1"
    _run_5a "$p

⚠ 교정 라운드다. 아래 검사 결과에서 지목된 항목의 **질문줄에 영문 키가 그대로 노출**돼 있다.
한국어로 묻고 키는 문장 끝 괄호 각주로 내려라 (라벨링_기준.md §문장 형식). 지목되지 않은 항목은 건드리지 마라.
$vout"
    vout=$("$NODE" "$UTIL/validate_labels.js" "$SPEC/_labels.json" 2>&1); vrc=$?
    while IFS= read -r l; do [[ -n "$l" ]] && say "FINAL-5a(교정후) $l"; done <<< "$vout"
  fi
  if [[ $vrc -eq 2 ]]; then
    alert_5 "_labels.json 검증 실패 (위 FINAL-5a 라인 참조) — 기획 확인 요청이 한 건도 기재되지 않았습니다"
    RESULT[5]="✗"; return
  fi
  # 금지 어휘 건수 회수 — 요약 첫 줄만 본다(상세 라인엔 숫자 대신 어휘명이 온다).
  # 구버전 validate_labels.js(이 필드 없음)로 롤백돼도 매칭 실패 → 0 유지(fail-safe).
  LABEL_BANNED=$(grep -o '금지 어휘 [0-9]\+' <<< "$vout" | head -1 | grep -o '[0-9]\+')
  LABEL_BANNED=${LABEL_BANNED:-0}
  say "FINAL-5b 라벨 기재"
  if "$NODE" "$UTIL/apply_labeling.js" "$SHEET_ID" "$TAB" "$SPEC/_labels.json"; then
    RESULT[5]="✓"
    # 교정 라운드 뒤에도 질문줄 영문 키가 남았으면 — 기재는 했으되 초록불로 끝내지 않는다.
    # 라벨을 버리면 30건이 통째로 사라지므로 '기재 + 실패 보고'가 손실 없는 차단이다.
    if [[ $vrc -eq 5 ]]; then
      alert_5 "질문줄 영문 키가 교정 라운드 뒤에도 남았습니다 — 기재는 완료됐으나 라벨링_기준.md §문장 형식 위반입니다 (항목 번호는 위 FINAL-5a(교정후) 라인)"
      RESULT[5]="✗"
    fi
    # 기재는 됐고 문구만 손볼 건 → alert_5(실패)와 통을 나눈다.
    # 같은 통에 넣으면 chain_helpers.js가 헤더를 ⚠(일부 실패)로 뒤집어 성공한 런이 실패로 보고된다.
    if [[ "$LABEL_BANNED" -gt 0 ]]; then
      echo "⚠ 라벨 금지 어휘 ${LABEL_BANNED}건 — 기재는 완료, 문구만 손보면 됩니다 (라벨링_기준.md §문장 형식 · 항목 번호는 chain.log FINAL-5a 라인)" \
        > "$SPEC/.final5_notice.txt"
    fi
  else
    alert_5 "apply_labeling.js 기재 실패 — _labels.json은 정상인데 시트 기재가 실패했습니다"
    RESULT[5]="✗"
  fi
}

# ── FINAL-3: 드라이브 업로드 (신규 파일만 — 재업로드 시 타임스탬프 사본 생성) ──
final_3() {
  if [[ -f "$SPEC/.drive_uploaded" ]]; then
    say "FINAL-3 스킵 — 이미 업로드됨(.drive_uploaded)"; RESULT[3]="✓(스킵)"; return
  fi
  say "FINAL-3 드라이브 업로드 (신규만)"
  local files=("$SPEC/analysis.md" "$SPEC/tc_design.md")
  [[ -f "$SPEC/_labels.json" ]] && files+=("$SPEC/_labels.json")
  if "$NODE" "$UTIL/upload_md_to_drive.js" --folder "$FEAT" "${files[@]}"; then
    RESULT[3]="✓"; date +%s > "$SPEC/.drive_uploaded"
  else
    say "FINAL-3 실패 — 60초 후 1회 재시도"
    sleep 60
    if "$NODE" "$UTIL/upload_md_to_drive.js" --folder "$FEAT" "${files[@]}"; then
      RESULT[3]="✓"; date +%s > "$SPEC/.drive_uploaded"
    else RESULT[3]="✗"; fi
  fi
}

for step in $ORDER; do
  case "$step" in
    0) final_0 ;;
    1) final_1 ;;
    2) final_2 ;;
    3) final_3 ;;
    5) final_5 ;;
    *) say "알 수 없는 단계 $step — 스킵" ;;
  esac
done

# ── FINAL-6 안내 (실행 금지 — 규칙서 문구 그대로 회수해 출력) ─────────────────
"$NODE" -e "
const fs=require('fs');
try{
  const md=fs.readFileSync(process.argv[1],'utf8');
  const sec=md.split('## FINAL-6')[1]||'';
  const blk=(sec.match(/\`\`\`([\s\S]*?)\`\`\`/)||[])[1]||'';
  const lines=blk.split(/\r?\n/).filter(l=>l.trim());
  if(lines.length) console.log(lines.join('\n'));
}catch(e){}
" "$RULES_MD" > "$SPEC/.final6_notice.txt" 2>/dev/null
[[ -s "$SPEC/.final6_notice.txt" ]] && { echo "[FINALIZE] FINAL-6 안내:"; cat "$SPEC/.final6_notice.txt"; }

LABEL_WARN=""
[[ "${LABEL_BANNED:-0}" -gt 0 ]] && LABEL_WARN="  ⚠ 라벨 금지어 ${LABEL_BANNED}건"
say "완료 — FINAL-0:${RESULT[0]} 1:${RESULT[1]} 2:${RESULT[2]} 5:${RESULT[5]} 3:${RESULT[3]}${LABEL_WARN}"
# 실패는 요약의 ✗ 한 글자로 묻히지 않게 마지막에 한 번 더 — 완료 보고에 그대로 옮긴다
for a in "$SPEC/.final0_alert.txt" "$SPEC/.final5_alert.txt"; do
  [[ -s "$a" ]] && { echo "[FINALIZE] ⚠ 완료 보고에 반드시 포함할 것:"; cat "$a"; }
done
for k in 0 1 2 3 5; do [[ "${RESULT[$k]}" == "✗" ]] && exit 20; done
exit 0
