#!/bin/bash
# =============================================================================
# Game QA Testcase - Setup Script (Mac / Linux)
# =============================================================================

set -e

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUDE_DIR="$HOME/.claude"
AGENTS_DIR="$CLAUDE_DIR/agents"
SKILLS_DIR="$CLAUDE_DIR/skills"

echo ""
echo "========================================"
echo "  Game QA Testcase - Setup"
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
  echo "[WARN] Claude Code cli.js를 찾을 수 없습니다. 설치 후 {CLI_JS}를 직접 수정해주세요."
  echo "       설치: npm install -g @anthropic-ai/claude-code"
  CLI_JS="CLI_JS_NOT_FOUND"
fi
echo "[OK] Claude CLI: $CLI_JS"

# --- 플레이스홀더 토큰 치환기 (파일 in-place; 7종 토큰 모두) ---
resolve_tokens() {
  sed -i.bak \
    -e "s|{NODE_PATH}|$NODE_PATH|g" \
    -e "s|{CLI_JS}|$CLI_JS|g" \
    -e "s|{PROJECT_ROOT}|$REPO_DIR|g" \
    -e "s|{WORK_ROOT}|$REPO_DIR|g" \
    -e "s|{CLAUDE_HOME}|$CLAUDE_DIR|g" \
    -e "s|{CLAUDE_AGENTS_DIR}|$AGENTS_DIR|g" \
    -e "s|{CLAUDE_SKILLS_DIR}|$SKILLS_DIR|g" \
    "$1" && rm -f "$1.bak"
}

# 4. 에이전트 설치 (토큰 치환 -> ~/.claude/agents)
echo ""
echo "[STEP 1] 에이전트 파일 설치..."
for file in "$REPO_DIR/agents/"*.md; do
  filename=$(basename "$file")
  sed \
    -e "s|{NODE_PATH}|$NODE_PATH|g" \
    -e "s|{CLI_JS}|$CLI_JS|g" \
    -e "s|{PROJECT_ROOT}|$REPO_DIR|g" \
    -e "s|{WORK_ROOT}|$REPO_DIR|g" \
    -e "s|{CLAUDE_HOME}|$CLAUDE_DIR|g" \
    -e "s|{CLAUDE_AGENTS_DIR}|$AGENTS_DIR|g" \
    -e "s|{CLAUDE_SKILLS_DIR}|$SKILLS_DIR|g" \
    "$file" > "$AGENTS_DIR/$filename"
  echo "  -> $filename"
done
echo "[OK] 에이전트 설치 완료"

# 4b. 슬래시 명령 설치 (토큰 치환 -> ~/.claude/commands)
echo ""
echo "[STEP 1b] 슬래시 명령 설치..."
COMMANDS_DIR="$CLAUDE_DIR/commands"
mkdir -p "$COMMANDS_DIR"
if [ -d "$REPO_DIR/commands" ]; then
  for file in "$REPO_DIR/commands/"*.md; do
    [ -e "$file" ] || continue
    filename=$(basename "$file")
    cp "$file" "$COMMANDS_DIR/$filename"
    resolve_tokens "$COMMANDS_DIR/$filename"
    echo "  -> $filename"
  done
fi
echo "[OK] 슬래시 명령 설치 완료"

# 5. 스킬 설치 (레포 내 토큰 치환 후 -> ~/.claude/skills 복사)
echo ""
echo "[STEP 2] 스킬 파일 설치..."
find "$REPO_DIR/skills" -type f \( -name '*.md' -o -name '*.js' -o -name '*.py' -o -name '*.sh' \) | while read -r f; do
  resolve_tokens "$f"
done
cp -r "$REPO_DIR/skills/"* "$SKILLS_DIR/"
echo "[OK] 스킬 설치 완료"

# 6. 레포 내 스크립트 토큰 치환 (in-place — 스크립트는 레포에서 실행됨)
echo ""
echo "[STEP 3] 스크립트 경로 토큰 치환..."
for d in scripts commands team; do
  [ -d "$REPO_DIR/$d" ] || continue
  find "$REPO_DIR/$d" -type f \( -name '*.js' -o -name '*.sh' -o -name '*.py' -o -name '*.md' \) | while read -r f; do
    resolve_tokens "$f"
  done
done
echo "[OK] 스크립트 토큰 치환 완료"

# 7. npm 의존성 설치
echo ""
echo "[STEP 4] npm 패키지 설치..."
cd "$REPO_DIR"
npm install
echo "[OK] 패키지 설치 완료"

# 8. .env 생성 (선택 — 기본값만으로도 동작)
echo ""
echo "[STEP 5] .env 파일 생성 (선택)..."
if [ ! -f "$REPO_DIR/.env" ]; then
  cp "$REPO_DIR/.env.example" "$REPO_DIR/.env"
  echo "[OK] .env 생성됨 (선택) - 기본 OAuth 경로/CLI 인자로 동작하므로 비워둬도 됩니다."
else
  echo "[SKIP] .env 이미 존재합니다."
fi

echo ""
echo "========================================"
echo "  설치 완료!"
echo "========================================"
echo ""
echo "다음 단계:"
echo "  1. credentials/client_secret.json 배치 (Google OAuth 데스크톱 클라이언트 JSON)"
echo "  2. ~/.claude/.mcp.json 에 MCP 설정 추가 (.mcp.json.example 참고)"
echo "  3. npm run auth   <- Google 인증 최초 실행 (브라우저 1회 승인)"
echo ""
echo "사용법 (Claude Code에서):"
echo "  'TC 팀 v2로 진행'"
echo "  'Spreadsheet: https://docs.google.com/spreadsheets/d/...'"
echo "  'Confluence: https://your-site.atlassian.net/wiki/...'"
echo ""
