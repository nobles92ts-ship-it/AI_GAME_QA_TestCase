#!/usr/bin/env bash
# run_local_xlsx.sh — 기획서 파일 1개로 테스트케이스를 만들어 로컬 .xlsx 로 저장
#   Google Sheets·Confluence·OAuth 설정이 전혀 필요 없다 (불특정다수 배포용 로컬 모드).
#
# 사용법:  bash run_local_xlsx.sh "<기능명>" "<기획서파일(md/txt/pdf/docx)>"
#
# 동작: 스펙 → confluence_raw.md 추출 → sheet_info.txt/tc_config.json 셋업 →
#       run_pipeline.sh --local (STEP 1~4: 설계→검수→수정→작성, 시트 대신 .xlsx 출력).
set -uo pipefail

UTIL="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$UTIL/../.." && pwd)"     # 설치 루트 (scripts/util → repo root)

FEATURE="${1:-}"; SPEC_FILE="${2:-}"
if [ -z "$FEATURE" ] || [ -z "$SPEC_FILE" ]; then
  echo "사용법: bash run_local_xlsx.sh \"<기능명>\" \"<기획서파일(md/txt/pdf/docx)>\"" >&2; exit 1
fi
[ -f "$SPEC_FILE" ] || { echo "기획서 파일을 찾을 수 없습니다: $SPEC_FILE" >&2; exit 1; }

SPECS="$ROOT/team/specs/$FEATURE"
mkdir -p "$SPECS"
RAW="$SPECS/confluence_raw.md"

# ── 스펙 → confluence_raw.md (md/txt=복사, pdf=pdftotext, docx=pandoc) ──
ext="${SPEC_FILE##*.}"; ext="$(printf '%s' "$ext" | tr '[:upper:]' '[:lower:]')"
case "$ext" in
  md|markdown|txt) cp "$SPEC_FILE" "$RAW" ;;
  pdf)  if command -v pdftotext >/dev/null 2>&1; then pdftotext -layout "$SPEC_FILE" "$RAW"
        else echo "PDF 추출에는 poppler(pdftotext)가 필요합니다. 기획서를 md/txt로 저장해 다시 시도하세요." >&2; exit 2; fi ;;
  doc|docx) if command -v pandoc >/dev/null 2>&1; then pandoc "$SPEC_FILE" -t gfm -o "$RAW"
        else echo "Word 추출에는 pandoc이 필요합니다. 기획서를 md/txt로 저장해 다시 시도하세요." >&2; exit 2; fi ;;
  *) echo "지원하지 않는 형식입니다: .$ext (md/txt/pdf/docx 지원)" >&2; exit 2 ;;
esac
[ -s "$RAW" ] || { echo "기획서 추출 결과가 비어 있습니다." >&2; exit 2; }

# ── 파이프라인 입력 셋업 (시트 없이) ──
cat > "$SPECS/sheet_info.txt" <<EOF
SHEET_ID=LOCAL_XLSX
TAB_NAME=$FEATURE
CONFLUENCE_URL=
FEATURE_NAME=$FEATURE
EOF
echo '{"crossref_brain":"off"}' > "$ROOT/team/tc_config.json"

echo "[로컬] 파이프라인 시작 (Google 미사용) — 기능=$FEATURE, 입력=$SPEC_FILE"
bash "$UTIL/run_pipeline.sh" --feature "$FEATURE" --local
rc=$?

OUT="$SPECS/${FEATURE}.xlsx"
if [ "$rc" -eq 0 ] && [ -f "$OUT" ]; then
  echo "[완료] 테스트케이스 엑셀: $OUT"
else
  echo "[실패] rc=$rc — 로그: $SPECS/chain.log" >&2
fi
exit $rc
