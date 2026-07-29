#!/bin/bash
# =============================================================================
# Game QA Testcase — Setup Script (Mac / Linux)
# =============================================================================

set -e

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUDE_DIR="$HOME/.claude"
AGENTS_DIR="$CLAUDE_DIR/agents"
SKILLS_DIR="$CLAUDE_DIR/skills"

echo ""
echo "========================================"
echo "  Game QA Testcase — Setup"
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

# 3. Claude Code cli.js 경로 감지 (npm global root 기반)
NPM_ROOT=$(npm root -g 2>/dev/null || echo "")
CLI_JS=""
if [ -n "$NPM_ROOT" ]; then
  CLI_JS="$NPM_ROOT/@anthropic-ai/claude-code/cli.js"
fi
if [ -z "$CLI_JS" ] || [ ! -f "$CLI_JS" ]; then
  echo "[WARN] Claude Code cli.js를 찾을 수 없습니다. 설치 후 agent 파일의 {CLI_JS}를 직접 수정해주세요."
  echo "       설치: npm install -g @anthropic-ai/claude-code"
  CLI_JS="CLI_JS_NOT_FOUND"
fi
echo "[OK] Claude CLI: $CLI_JS"

# 4. 에이전트 파일 복사 + 플레이스홀더 치환
echo ""
echo "[STEP 1] 에이전트 파일 설치..."
for file in "$REPO_DIR/agents/"*.md; do
  filename=$(basename "$file")
  sed \
    -e "s|{NODE_PATH}|$NODE_PATH|g" \
    -e "s|{PROJECT_ROOT}|$REPO_DIR|g" \
    -e "s|{CLI_JS}|$CLI_JS|g" \
    -e "s|{CLAUDE_AGENTS_DIR}|$AGENTS_DIR|g" \
    -e "s|{CLAUDE_SKILLS_DIR}|$SKILLS_DIR|g" \
    "$file" > "$AGENTS_DIR/$filename"
  echo "  -> $filename"
done
echo "[OK] 에이전트 설치 완료"

# 5. 스킬 파일 복사 + 플레이스홀더 치환
#    ⚠ 구버전은 cp -r 만 해서 skills/ 안의 {PROJECT_ROOT} 등이 리터럴로 남았다(2026-07-29 수정).
#      규칙 md 는 파이프라인이 런타임에 읽으므로 치환 없이는 경로 참조가 전부 깨진다.
echo ""
echo "[STEP 2] 스킬 파일 설치..."
cp -r "$REPO_DIR/skills/"* "$SKILLS_DIR/"
find "$SKILLS_DIR" -type f \( -name '*.md' -o -name '*.json' \) -print0 | while IFS= read -r -d '' f; do
  sed -i \
    -e "s|{NODE_PATH}|$NODE_PATH|g" \
    -e "s|{PROJECT_ROOT}|$REPO_DIR|g" \
    -e "s|{WORK_ROOT}|$REPO_DIR|g" \
    -e "s|{CLI_JS}|$CLI_JS|g" \
    -e "s|{CLAUDE_HOME}|$CLAUDE_DIR|g" \
    -e "s|{CLAUDE_AGENTS_DIR}|$AGENTS_DIR|g" \
    -e "s|{CLAUDE_SKILLS_DIR}|$SKILLS_DIR|g" \
    "$f"
done
echo "[OK] 스킬 설치 완료 (플레이스홀더 치환 포함)"

# 5-1. 레포 내 문서·스크립트 플레이스홀더 치환 (tc-team 엔진 · 공용 스크립트)
#      실행 스크립트는 자기 위치에서 루트를 유도하므로 치환이 필수는 아니지만,
#      문서(docs/*.md)의 경로 안내가 리터럴로 남으면 사용자가 따라할 수 없다.
echo ""
echo "[STEP 2-1] 레포 내 플레이스홀더 치환..."
find "$REPO_DIR/tc-team" "$REPO_DIR/scripts" -type f \( -name '*.md' -o -name '*.sh' -o -name '*.js' \) -print0 2>/dev/null | while IFS= read -r -d '' f; do
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

# 6. npm 의존성 설치
echo ""
echo "[STEP 3] npm 패키지 설치..."
cd "$REPO_DIR"
npm install
echo "[OK] 패키지 설치 완료"

# 7. pipeline_config.json 생성
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

# 8. .env 생성
echo ""
echo "[STEP 5] .env 파일 생성..."
if [ ! -f "$REPO_DIR/.env" ]; then
  sed "s|C:/Users/YourName/Documents/Game_QA_Testcase|$REPO_DIR|g" \
    "$REPO_DIR/.env.example" > "$REPO_DIR/.env"
  echo "[OK] .env 생성됨 — Google OAuth 정보와 Spreadsheet ID를 직접 입력해주세요."
else
  echo "[SKIP] .env 이미 존재합니다."
fi

echo ""
echo "========================================"
echo "  설치 완료!"
echo "========================================"
echo ""
echo "다음 단계:"
echo "  1. .env 파일에 Google OAuth 정보 입력"
echo "  2. pipeline_config.json에 Drive 폴더 ID / Confluence 사이트 입력"
echo "  3. ~/.claude/.mcp.json 파일에 MCP 설정 추가 (.mcp.json.example 참고)"
echo "  4. npm run auth  ← Google 인증 최초 실행"
echo ""
echo "사용법:"
echo "  Claude Code에서:"
echo "  'TC 팀 v2로 진행'"
echo "  'Spreadsheet: https://docs.google.com/spreadsheets/d/...'"
echo "  'Confluence: https://your-site.atlassian.net/wiki/...'"
echo ""
