# =============================================================================
# Game QA Testcase - Setup Script (Windows PowerShell)
# =============================================================================
# 사용법: PowerShell에서 이 스크립트가 있는 폴더로 이동 후
#          .\setup.ps1
# =============================================================================

$ErrorActionPreference = "Stop"

$RepoDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$ClaudeDir = "$env:USERPROFILE\.claude"
$AgentsDir = "$ClaudeDir\agents"
$SkillsDir = "$ClaudeDir\skills"

Write-Host ""
Write-Host "========================================"
Write-Host "  Game QA Testcase - Setup"
Write-Host "========================================"
Write-Host ""

# 1. Claude 디렉토리 생성
New-Item -ItemType Directory -Force -Path $AgentsDir | Out-Null
New-Item -ItemType Directory -Force -Path $SkillsDir | Out-Null

# 2. Node.js 경로 감지
$NodePath = (Get-Command node -ErrorAction SilentlyContinue)?.Source
if (-not $NodePath) {
    Write-Host "[ERROR] Node.js를 찾을 수 없습니다. https://nodejs.org 에서 설치 후 다시 실행해주세요." -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Node.js: $NodePath"

# 3. Claude Code cli.js 경로 감지 (npm global root 기반)
$NpmRoot = (npm root -g 2>$null)?.Trim()
$CliPath = if ($NpmRoot) { "$NpmRoot/@anthropic-ai/claude-code/cli.js" } else { "" }
if (-not $CliPath -or -not (Test-Path $CliPath)) {
    Write-Host "[WARN] Claude Code cli.js를 찾을 수 없습니다. 설치 후 {CLI_JS}를 직접 수정해주세요." -ForegroundColor Yellow
    Write-Host "       설치: npm install -g @anthropic-ai/claude-code" -ForegroundColor Yellow
    $CliPath = "CLI_JS_NOT_FOUND"
}
Write-Host "[OK] Claude CLI: $CliPath"

# --- 플레이스홀더 토큰 치환기 (모든 경로 forward-slash 통일: bash/node 호환) ---
$RepoFwd   = $RepoDir   -replace '\\','/'
$ClaudeFwd = $ClaudeDir -replace '\\','/'
$NodeFwd   = $NodePath  -replace '\\','/'
$CliFwd    = $CliPath   -replace '\\','/'
$AgentsFwd = $AgentsDir -replace '\\','/'
$SkillsFwd = $SkillsDir -replace '\\','/'
function Resolve-Tokens([string]$c) {
    return $c `
        -replace '\{NODE_PATH\}',          $NodeFwd `
        -replace '\{CLI_JS\}',             $CliFwd `
        -replace '\{PROJECT_ROOT\}',       $RepoFwd `
        -replace '\{WORK_ROOT\}',          $RepoFwd `
        -replace '\{CLAUDE_HOME\}',        $ClaudeFwd `
        -replace '\{CLAUDE_AGENTS_DIR\}',  $AgentsFwd `
        -replace '\{CLAUDE_SKILLS_DIR\}',  $SkillsFwd
}

# 4. 에이전트 설치 (토큰 치환 -> ~/.claude/agents)
Write-Host ""
Write-Host "[STEP 1] 에이전트 파일 설치..."
Get-ChildItem "$RepoDir\agents\*.md" | ForEach-Object {
    $content = Resolve-Tokens (Get-Content $_.FullName -Raw -Encoding UTF8)
    [System.IO.File]::WriteAllText("$AgentsDir\$($_.Name)", $content, [System.Text.Encoding]::UTF8)
    Write-Host "  -> $($_.Name)"
}
Write-Host "[OK] 에이전트 설치 완료"

# 4b. 슬래시 명령 설치 (토큰 치환 -> ~/.claude/commands)
Write-Host ""
Write-Host "[STEP 1b] 슬래시 명령 설치..."
$CommandsDir = "$ClaudeDir\commands"
New-Item -ItemType Directory -Force -Path $CommandsDir | Out-Null
if (Test-Path "$RepoDir\commands") {
    Get-ChildItem "$RepoDir\commands\*.md" | ForEach-Object {
        $content = Resolve-Tokens (Get-Content $_.FullName -Raw -Encoding UTF8)
        [System.IO.File]::WriteAllText("$CommandsDir\$($_.Name)", $content, [System.Text.Encoding]::UTF8)
        Write-Host "  -> $($_.Name)"
    }
}
Write-Host "[OK] 슬래시 명령 설치 완료"

# 5. 스킬 설치 (레포 내 토큰 치환 후 -> ~/.claude/skills 복사)
Write-Host ""
Write-Host "[STEP 2] 스킬 파일 설치..."
Get-ChildItem "$RepoDir\skills" -Recurse -File -Include *.md,*.js,*.py,*.sh | ForEach-Object {
    $content = Resolve-Tokens (Get-Content $_.FullName -Raw -Encoding UTF8)
    [System.IO.File]::WriteAllText($_.FullName, $content, [System.Text.Encoding]::UTF8)
}
Copy-Item "$RepoDir\skills\*" -Destination $SkillsDir -Recurse -Force
Write-Host "[OK] 스킬 설치 완료"

# 6. 레포 내 스크립트 토큰 치환 (in-place — 스크립트는 레포에서 실행됨)
Write-Host ""
Write-Host "[STEP 3] 스크립트 경로 토큰 치환..."
$scriptDirs = @("$RepoDir\scripts", "$RepoDir\commands", "$RepoDir\team") | Where-Object { Test-Path $_ }
if ($scriptDirs) {
    Get-ChildItem $scriptDirs -Recurse -File -Include *.js,*.sh,*.py,*.md | ForEach-Object {
        $content = Resolve-Tokens (Get-Content $_.FullName -Raw -Encoding UTF8)
        [System.IO.File]::WriteAllText($_.FullName, $content, [System.Text.Encoding]::UTF8)
    }
}
Write-Host "[OK] 스크립트 토큰 치환 완료"

# 7. npm 의존성 설치
Write-Host ""
Write-Host "[STEP 4] npm 패키지 설치..."
Push-Location $RepoDir
npm install
Pop-Location
Write-Host "[OK] 패키지 설치 완료"

# 8. .env 생성 (선택 — 기본값만으로도 동작)
Write-Host ""
Write-Host "[STEP 5] .env 파일 생성 (선택)..."
$EnvDest = "$RepoDir\.env"
if (-not (Test-Path $EnvDest)) {
    Copy-Item "$RepoDir\.env.example" -Destination $EnvDest
    Write-Host "[OK] .env 생성됨 (선택) - 기본 OAuth 경로/CLI 인자로 동작하므로 비워둬도 됩니다."
} else {
    Write-Host "[SKIP] .env 이미 존재합니다."
}

Write-Host ""
Write-Host "========================================"
Write-Host "  설치 완료!" -ForegroundColor Green
Write-Host "========================================"
Write-Host ""
Write-Host "다음 단계:"
Write-Host "  1. credentials\client_secret.json 배치 (Google OAuth 데스크톱 클라이언트 JSON)"
Write-Host "  2. ~/.claude/.mcp.json 에 MCP 설정 추가 (.mcp.json.example 참고)"
Write-Host "  3. npm run auth   <- Google 인증 최초 실행 (브라우저 1회 승인)"
Write-Host ""
Write-Host "사용법 (Claude Code에서):"
Write-Host "  'TC 팀 v2로 진행'"
Write-Host "  'Spreadsheet: https://docs.google.com/spreadsheets/d/...'"
Write-Host "  'Confluence: https://your-site.atlassian.net/wiki/...'"
Write-Host ""
