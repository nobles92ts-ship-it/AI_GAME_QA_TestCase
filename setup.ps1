# =============================================================================
# Game QA Testcase — Setup Script (Windows PowerShell)
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
    Write-Host "[WARN] Claude Code cli.js를 찾을 수 없습니다. 설치 후 agent 파일의 {CLI_JS}를 직접 수정해주세요." -ForegroundColor Yellow
    Write-Host "       설치: npm install -g @anthropic-ai/claude-code" -ForegroundColor Yellow
    $CliPath = "CLI_JS_NOT_FOUND"
}
Write-Host "[OK] Claude CLI: $CliPath"

# 4. 에이전트 파일 복사 + 플레이스홀더 치환
Write-Host ""
Write-Host "[STEP 1] 에이전트 파일 설치..."
Get-ChildItem "$RepoDir\agents\*.md" | ForEach-Object {
    $content = Get-Content $_.FullName -Raw -Encoding UTF8
    $content = $content `
        -replace '\{NODE_PATH\}',          $NodePath `
        -replace '\{PROJECT_ROOT\}',       $RepoDir `
        -replace '\{CLI_JS\}',             $CliPath `
        -replace '\{CLAUDE_AGENTS_DIR\}',  $AgentsDir `
        -replace '\{CLAUDE_SKILLS_DIR\}',  $SkillsDir
    $dest = "$AgentsDir\$($_.Name)"
    [System.IO.File]::WriteAllText($dest, $content, [System.Text.Encoding]::UTF8)
    Write-Host "  -> $($_.Name)"
}
Write-Host "[OK] 에이전트 설치 완료"

# 5. 스킬 파일 복사
Write-Host ""
Write-Host "[STEP 2] 스킬 파일 설치..."
Copy-Item "$RepoDir\skills\*" -Destination $SkillsDir -Recurse -Force
Write-Host "[OK] 스킬 설치 완료"

# 6. npm 의존성 설치
Write-Host ""
Write-Host "[STEP 3] npm 패키지 설치..."
Push-Location $RepoDir
npm install
Pop-Location
Write-Host "[OK] 패키지 설치 완료"

# 7. pipeline_config.json 생성
Write-Host ""
Write-Host "[STEP 4] pipeline_config.json 생성..."
$ConfigDest = "$RepoDir\pipeline_config.json"
if (-not (Test-Path $ConfigDest)) {
    $config = Get-Content "$RepoDir\pipeline_config.json.template" -Raw -Encoding UTF8
    $config = $config `
        -replace 'C:/YOUR_PATH/node\.exe',      ($NodePath -replace '\\', '/') `
        -replace 'C:/YOUR_PATH/AI_AntiGravity',  ($RepoDir -replace '\\', '/')
    [System.IO.File]::WriteAllText($ConfigDest, $config, [System.Text.Encoding]::UTF8)
    Write-Host "[OK] pipeline_config.json 생성됨 — Drive ID / Confluence site를 직접 수정해주세요."
} else {
    Write-Host "[SKIP] pipeline_config.json 이미 존재합니다."
}

# 8. .env 생성
Write-Host ""
Write-Host "[STEP 5] .env 파일 생성..."
$EnvDest = "$RepoDir\.env"
if (-not (Test-Path $EnvDest)) {
    $env_content = Get-Content "$RepoDir\.env.example" -Raw -Encoding UTF8
    $env_content = $env_content -replace 'C:/Users/YourName/Documents/Game_QA_Testcase', ($RepoDir -replace '\\', '/')
    [System.IO.File]::WriteAllText($EnvDest, $env_content, [System.Text.Encoding]::UTF8)
    Write-Host "[OK] .env 생성됨 — Google OAuth 정보와 Spreadsheet ID를 입력해주세요."
} else {
    Write-Host "[SKIP] .env 이미 존재합니다."
}

Write-Host ""
Write-Host "========================================"
Write-Host "  설치 완료!" -ForegroundColor Green
Write-Host "========================================"
Write-Host ""
Write-Host "다음 단계:"
Write-Host "  1. .env 파일에 Google OAuth 정보 입력"
Write-Host "  2. pipeline_config.json에 Drive 폴더 ID / Confluence 사이트 입력"
Write-Host "  3. ~/.claude/.mcp.json 에 MCP 설정 추가 (.mcp.json.example 참고)"
Write-Host "  4. npm run auth  <- Google 인증 최초 실행"
Write-Host ""
Write-Host "사용법:"
Write-Host "  Claude Code에서:"
Write-Host "  'TC 팀 v2로 진행'"
Write-Host "  'Spreadsheet: https://docs.google.com/spreadsheets/d/...'"
Write-Host "  'Confluence: https://your-site.atlassian.net/wiki/...'"
Write-Host ""
