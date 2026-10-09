#!/bin/bash
# =============================================================================
# Game QA Testcase — Setup Script (Mac / Linux)
# =============================================================================
# 사용법: ./setup.sh              (사람용 — 시트에 TC 를 쓰는 tc-team. 예전과 같다)
#         ./setup.sh --mode ai    (AI용 — 기획서만으로 AI 실행용 md 묶음을 만드는 tc-team-ai. 구글 설정 불필요)
#         ./setup.sh --mode both  (둘 다)
#       --mode 를 안 주면 환경변수 TC_MODE, 그것도 없으면 human.
# =============================================================================

set -e

MODE="${TC_MODE:-human}"
while [ $# -gt 0 ]; do
  case "$1" in
    --mode) MODE="$2"; shift 2 ;;
    *) echo "[ERROR] 알 수 없는 인자: $1 (사용: ./setup.sh [--mode human|ai|both])"; exit 1 ;;
  esac
done
MODE=$(printf '%s' "$MODE" | tr '[:upper:]' '[:lower:]')
case "$MODE" in
  human|ai|both) ;;
  *) echo "[ERROR] --mode 는 human | ai | both 중 하나입니다 (받은 값: $MODE)"; exit 1 ;;
esac
WITH_HUMAN=1; [ "$MODE" = "ai" ] && WITH_HUMAN=0
WITH_AI=1;    [ "$MODE" = "human" ] && WITH_AI=0

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUDE_DIR="$HOME/.claude"
AGENTS_DIR="$CLAUDE_DIR/agents"
SKILLS_DIR="$CLAUDE_DIR/skills"

echo ""
echo "========================================"
echo "  Game QA Testcase — Setup ($MODE)"
echo "========================================"
echo ""

# 1. Claude agents/skills 디렉토리 생성
mkdir -p "$AGENTS_DIR"
mkdir -p "$SKILLS_DIR"

# 2. Node.js 경로 감지
NODE_PATH=$(which node 2>/dev/null || echo "")
if [ -z "$NODE_PATH" ]; then
  echo "[ERROR] node.js를 찾을 수 없습니다. https://nodejs.org 에서 설치 후 다시 실행해주세요."
  exit 1
fi
echo "[OK] Node.js: $NODE_PATH"

# 3. 에이전트 파일 복사 + 플레이스홀더 치환 — 모드 무관(AI용도 S1 설계에서 이 에이전트들을 부른다)
echo ""
echo "[STEP 1] 에이전트 파일 설치..."
for file in "$REPO_DIR/agents/"*.md; do
  filename=$(basename "$file")
  sed \
    -e "s|{NODE_PATH}|$NODE_PATH|g" \
    -e "s|{PROJECT_ROOT}|$REPO_DIR|g" \
    -e "s|{CLAUDE_AGENTS_DIR}|$AGENTS_DIR|g" \
    -e "s|{CLAUDE_SKILLS_DIR}|$SKILLS_DIR|g" \
    "$file" > "$AGENTS_DIR/$filename"
  echo "  -> $filename"
done
echo "[OK] 에이전트 설치 완료"

# 3-1. 슬래시 커맨드 설치 (구버전은 이 단계가 없어 /tc-이미지매칭 이 설치되지 않았다 — 2026-07-29 추가)
#      사람용만 — 지금 커맨드(/tc-이미지매칭)는 시트 TC 용이다
COMMANDS_DIR="$CLAUDE_DIR/commands"
if [ "$WITH_HUMAN" = 1 ] && [ -d "$REPO_DIR/commands" ]; then
  echo ""
  echo "[STEP 1-1] 슬래시 커맨드 설치..."
  mkdir -p "$COMMANDS_DIR"
  for file in "$REPO_DIR/commands/"*.md; do
    [ -e "$file" ] || continue
    filename=$(basename "$file")
    sed \
      -e "s|{NODE_PATH}|$NODE_PATH|g" \
      -e "s|{PROJECT_ROOT}|$REPO_DIR|g" \
      -e "s|{WORK_ROOT}|$REPO_DIR|g" \
      -e "s|{CLAUDE_HOME}|$CLAUDE_DIR|g" \
      -e "s|{CLAUDE_SKILLS_DIR}|$SKILLS_DIR|g" \
      "$file" > "$COMMANDS_DIR/$filename"
    echo "  -> $filename"
  done
  echo "[OK] 커맨드 설치 완료"
fi

# 4. 스킬 파일 복사 + 플레이스홀더 치환
#    ⚠ 구버전은 cp -r 만 해서 skills/ 안의 {PROJECT_ROOT} 등이 리터럴로 남았다(2026-07-29 수정).
#      규칙 md 는 파이프라인이 런타임에 읽으므로 치환 없이는 경로 참조가 전부 깨진다.
#    모드: human = tc-team-ai 를 뺀 전부(예전과 같음) · ai = tc-team-ai + tc-team 규칙 서랍(rules/)만 · both = 전부.
#    ai 에 tc-team/SKILL.md 를 안 까는 이유: 시트가 있어야 도는 사람용 드라이버라 /tc-team 이 떠도 쓸 수 없다.
#    체인(S1~S5)은 실행 중에 rules/ 만 읽는다.
echo ""
echo "[STEP 2] 스킬 파일 설치..."
if [ "$MODE" = "ai" ]; then
  cp -r "$REPO_DIR/skills/tc-team-ai" "$SKILLS_DIR/"
  mkdir -p "$SKILLS_DIR/tc-team"
  cp -r "$REPO_DIR/skills/tc-team/rules" "$SKILLS_DIR/tc-team/"
else
  for d in "$REPO_DIR/skills/"*/; do
    [ "$WITH_AI" = 0 ] && [ "$(basename "$d")" = "tc-team-ai" ] && continue
    cp -r "${d%/}" "$SKILLS_DIR/"
  done
fi
find "$SKILLS_DIR" -type f \( -name '*.md' -o -name '*.json' \) -print0 | while IFS= read -r -d '' f; do
  sed -i \
    -e "s|{NODE_PATH}|$NODE_PATH|g" \
    -e "s|{PROJECT_ROOT}|$REPO_DIR|g" \
    -e "s|{WORK_ROOT}|$REPO_DIR|g" \
    -e "s|{CLAUDE_HOME}|$CLAUDE_DIR|g" \
    -e "s|{CLAUDE_AGENTS_DIR}|$AGENTS_DIR|g" \
    -e "s|{CLAUDE_SKILLS_DIR}|$SKILLS_DIR|g" \
    "$f"
done
echo "[OK] 스킬 설치 완료 (플레이스홀더 치환 포함)"

# 4-1. 레포 내 문서·스크립트 플레이스홀더 치환 (tc-team 엔진 · 공용 스크립트)
#      실행 스크립트는 자기 위치에서 루트를 유도하므로 치환이 필수는 아니지만,
#      문서(docs/*.md)의 경로 안내가 리터럴로 남으면 사용자가 따라할 수 없다.
echo ""
echo "[STEP 2-1] 레포 내 플레이스홀더 치환..."
find "$REPO_DIR/tc-team" "$REPO_DIR/scripts" "$REPO_DIR/docs" -type f \( -name '*.md' -o -name '*.sh' -o -name '*.js' \) -print0 2>/dev/null | while IFS= read -r -d '' f; do
  grep -q '{PROJECT_ROOT}\|{WORK_ROOT}\|{NODE_PATH}\|{CLAUDE_HOME}\|{CLAUDE_SKILLS_DIR}' "$f" || continue
  sed -i \
    -e "s|{NODE_PATH}|$NODE_PATH|g" \
    -e "s|{PROJECT_ROOT}|$REPO_DIR|g" \
    -e "s|{WORK_ROOT}|$REPO_DIR|g" \
    -e "s|{CLAUDE_HOME}|$CLAUDE_DIR|g" \
    -e "s|{CLAUDE_SKILLS_DIR}|$SKILLS_DIR|g" \
    "$f"
done
echo "[OK] 치환 완료"

# 5. npm 의존성 설치
echo ""
echo "[STEP 3] npm 패키지 설치..."
cd "$REPO_DIR"
npm install
echo "[OK] 패키지 설치 완료"

# 6~7. pipeline_config.json · .env — 사람용만(구글 시트·드라이브 설정). AI용은 기획서 계정만 있으면 된다.
if [ "$WITH_HUMAN" = 1 ]; then
# 6. pipeline_config.json 생성
echo ""
echo "[STEP 4] pipeline_config.json 생성..."
if [ ! -f "$REPO_DIR/pipeline_config.json" ]; then
  sed \
    -e "s|C:/YOUR_PATH/node.exe|$NODE_PATH|g" \
    -e "s|C:/YOUR_PATH/AI_AntiGravity|$REPO_DIR|g" \
    "$REPO_DIR/pipeline_config.json.template" > "$REPO_DIR/pipeline_config.json"
  echo "[OK] pipeline_config.json 생성됨 — 나머지 항목(Drive ID, Confluence site)을 직접 수정해주세요."
else
  echo "[SKIP] pipeline_config.json 이미 존재합니다."
fi

# 7. .env 생성
echo ""
echo "[STEP 5] .env 파일 생성..."
if [ ! -f "$REPO_DIR/.env" ]; then
  sed "s|C:/Users/YourName/Documents/Game_QA_Testcase|$REPO_DIR|g" \
    "$REPO_DIR/.env.example" > "$REPO_DIR/.env"
  echo "[OK] .env 생성됨 — Google OAuth 정보와 Spreadsheet ID를 직접 입력해주세요."
else
  echo "[SKIP] .env 이미 존재합니다."
fi
fi

echo ""
echo "========================================"
echo "  설치 완료! ($MODE)"
echo "========================================"
if [ "$WITH_HUMAN" = 1 ]; then
  echo ""
  echo "[사람용 tc-team] 다음 단계:"
  echo "  1. .env 파일에 Google OAuth 정보 입력"
  echo "  2. pipeline_config.json에 Drive 폴더 ID / Confluence 사이트 입력"
  echo "  3. ~/.claude/.mcp.json 파일에 MCP 설정 추가 (.mcp.json.example 참고)"
  echo "  4. npm run auth  ← Google 인증 최초 실행"
  echo "  사용: Claude Code에서 '/tc-team <스프레드시트 링크> <기획서 링크>'"
fi
if [ "$WITH_AI" = 1 ]; then
  echo ""
  echo "[AI용 tc-team-ai] 다음 단계:"
  echo "  1. Confluence 계정 — 환경변수 CONFLUENCE_URL · CONFLUENCE_USERNAME · CONFLUENCE_API_TOKEN"
  echo "     (기획서를 파일로 줄 거면 생략 가능)"
  echo "  사용: Claude Code에서 '/tc-team-ai <기획서 링크>' — 결과는 team/specs/_ai_<기능>/ai_bundle/"
fi
echo ""
