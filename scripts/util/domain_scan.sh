#!/bin/bash
# domain_scan.sh — 도메인 용어(사내 게임 스키마) 유출 스캔. github-repo STEP 3-3 / STEP 8 공용.
#
# 왜 별도 스크립트인가 (2026-08-23, S-2)
#   secret_patterns.txt 는 이 클래스를 "구조적 정규식으로 불가"라며 SKILL.md 본문의 grep 에 넘겼고,
#   그 grep 은 `<테이블명>_<영문>` **한 모양만** 봤다. 그래서 v4.2.0 조립 때
#   `Crafting.xlsx` · `RecipeInfo` · `NeedMaterialId` 같은 **테이블 파일·시트·컬럼 참조**를
#   0건으로 통과시켰다(4종 전부 참조 맵에 있었는데도). 수동 발견이 아니었으면 그대로 발행됐다.
#   → 모양을 3종으로 넓히고, 스킬 본문이 아니라 여기 한 곳에 둔다(본문 복사는 표류를 낳는다).
#
# 검출 3형태
#   ① L10N·에셋 키   `<테이블명>_<영문>`     예) Medal_UI_Title
#   ② 테이블 파일     `<테이블명>.xlsx`        예) Crafting.xlsx
#   ③ 시트·컬럼명     `<구조명>`  ← ⚠ ②가 있는 파일 안에서만
#
# ⚠ ③에 공동출현 조건이 붙은 이유 = 오탐이 게이트를 죽인다.
#   실측(공개본 v4.2.0): 조건 없이 전 파일에 걸면 **96건**이 뜬다 — `GlobalDefine`·`ItemType`·
#   `InventoryCategory` 처럼 **규칙 문서 자신의 어휘**와 겹치기 때문이다. 매번 96건이 뜨면
#   사람은 그 줄을 건너뛰고 진짜 유출도 같이 묻힌다(dep_check 이 정확히 그렇게 죽어 있었다).
#   `.xlsx` 테이블 참조가 있는 파일 = "게임 테이블에 실제로 바인딩된 파일" 로 좁히면
#   공개본 4건 / 살균 전 소스 31건 으로 갈린다. 그 4건은 오탐이 아니라 **놓친 진짜 잔존 유출**이었다.
#
# ⚠ 구조명 사전은 `길이>=8 · 대문자>=2 · 등장 테이블<=2` 로 거른다(실측: 유출 6종 전건 통과,
#   Index·Type·Name·Description·Grade·ItemType·GroupID·SubType·UseInLive 전건 차단).
#
# ⛔ fail-closed — 참조 맵이 없거나 패턴이 비면 **중단한다.** 미실행은 통과가 아니다.
#   (구버전은 빈 변수로 `\b()\b` 를 만들어 전 줄 매칭 = 15,000건 노이즈를 내고도 "스캔했다"고 보였다)
#
# 사용: bash domain_scan.sh <scan_root> [table_map.json]
set -u
ROOT="${1:-.}"
TBLMAP="${2:-C:/work/DXR_관리/_DXR_테이블맵.json}"
INC="--include=*.md --include=*.js --include=*.sh --include=*.gs --include=*.json --include=*.ps1 --include=*.py --include=*.html"

[ -d "$ROOT" ] || { echo "[FATAL] 스캔 대상 없음: $ROOT"; exit 1; }
if [ ! -f "$TBLMAP" ]; then
  echo "[FATAL] 도메인 용어 스캔 **미실행** — 참조 테이블맵 없음: $TBLMAP"
  echo "        이건 PASS 가 아니다. 사내 기획 유출을 막는 유일한 자동 게이트가 죽은 상태다."
  echo "        조치: 경로 복구 후 재실행. 복구 불가면 사람이 수동 대조했다는 확인을 받고서만 진행."
  exit 1
fi

GEN='const t=require(process.argv[1]),tb=t.tables||{};
const tables=Object.keys(tb).filter(k=>k.length>=4);
const sheetIn={},colIn={};
for(const [tn,v] of Object.entries(tb))for(const s of (v.sheets||[])){
  (sheetIn[s.name]??=new Set()).add(tn);
  for(const c of (s.columns||[]))(colIn[c.name]??=new Set()).add(tn);}
const humps=s=>(s.match(/[A-Z]/g)||[]).length;
const keep=(n,i)=>n.length>=8&&humps(n)>=2&&i[n].size<=2;
const struct=[...new Set([...Object.keys(sheetIn).filter(n=>keep(n,sheetIn)),
                          ...Object.keys(colIn).filter(n=>keep(n,colIn))])];'

PT=$(node -e "$GEN process.stdout.write(tables.join('|'))" "$TBLMAP") \
  || { echo "[FATAL] 테이블맵 파싱 실패 — 도메인 스캔 미실행. PASS 아님"; exit 1; }
PS=$(node -e "$GEN process.stdout.write(struct.join('|'))" "$TBLMAP") \
  || { echo "[FATAL] 테이블맵 파싱 실패(구조명) — 도메인 스캔 미실행. PASS 아님"; exit 1; }
[ -z "$PT" ] && { echo "[FATAL] 테이블명 0종 — 맵 구조 변경 의심(t.tables). 스캔 미실행, PASS 아님"; exit 1; }
[ -z "$PS" ] && { echo "[FATAL] 구조명 0종 — 맵에 sheets[].columns[] 없음. 스캔 미실행, PASS 아님"; exit 1; }

PT_N=$(printf '%s' "$PT" | awk -F'|' '{print NF}')
PS_N=$(printf '%s' "$PS" | awk -F'|' '{print NF}')
FILE_N=$(grep -rl '' $INC "$ROOT" 2>/dev/null | grep -v '/\.git/' | wc -l)
echo "[스캔] 도메인 용어: 테이블 ${PT_N}종 · 구조명 ${PS_N}종 × 파일 ${FILE_N}개"
[ "$FILE_N" -eq 0 ] && { echo "[FATAL] 스캔 대상 파일 0개 — 경로 확인. PASS 아님"; exit 1; }

HITS=""
add() { [ -n "$1" ] && HITS="${HITS}${1}"$'\n'; }

# ① L10N·에셋 키
add "$(grep -rnE "\b($PT)\\\\?_[A-Za-z]" $INC "$ROOT" 2>/dev/null | grep -v '/\.git/' | sed 's/^/[①키] /')"
# ② 테이블 파일 참조
add "$(grep -rnE "\b($PT)\.xlsx" $INC "$ROOT" 2>/dev/null | grep -v '/\.git/' | sed 's/^/[②파일] /')"
# ③ 시트·컬럼명 — ②가 있는 파일 안에서만 (공동출현)
BOUND=$(grep -rlE "\b($PT)\.xlsx" $INC "$ROOT" 2>/dev/null | grep -v '/\.git/')
if [ -n "$BOUND" ]; then
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    add "$(grep -nE "\b($PS)\b" "$f" 2>/dev/null | sed "s|^|[③구조] $f:|")"
  done <<< "$BOUND"
fi

HITS=$(printf '%s' "$HITS" | grep -v '^$')
if [ -n "$HITS" ]; then
  printf '%s\n' "$HITS"
  echo "[검토] 도메인 용어 노출 $(printf '%s\n' "$HITS" | wc -l)건 — 건별 판정."
  echo "       실 게임 스키마면 치환(Sample_/SystemA 류) 또는 config 외부화. 이미 치환된 예시는 통과."
  exit 2
fi
echo "[PASS] 도메인 용어 0건 (테이블 ${PT_N}종 · 구조명 ${PS_N}종 × 파일 ${FILE_N}개 실검사)"
exit 0
