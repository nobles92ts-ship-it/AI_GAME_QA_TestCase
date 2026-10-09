# =============================================================================
# Game QA Testcase — Setup Script (Windows PowerShell)
# =============================================================================
# 사용법: PowerShell에서 이 스크립트가 있는 폴더로 이동 후
#          .\setup.ps1              (사람용 — 시트에 TC 를 쓰는 tc-team. 예전과 같다)
#          .\setup.ps1 -Mode ai     (AI용 — 기획서만으로 AI 실행용 md 묶음을 만드는 tc-team-ai. 구글 설정 불필요)
#          .\setup.ps1 -Mode both   (둘 다)
#        -Mode 를 안 주면 환경변수 TC_MODE, 그것도 없으면 human.
# =============================================================================
param([string]$Mode = '')

$ErrorActionPreference = "Stop"

if (-not $Mode) { $Mode = if ($env:TC_MODE) { $env:TC_MODE } else { 'human' } }
$Mode = $Mode.ToLower()
if ($Mode -notin @('human', 'ai', 'both')) {
    Write-Host "[ERROR] -Mode 는 human | ai | both 중 하나입니다 (받은 값: $Mode)" -ForegroundColor Red
    exit 1
}
$WithHuman = $Mode -ne 'ai'
$WithAi    = $Mode -ne 'human'

$RepoDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$ClaudeDir = "$env:USERPROFILE\.claude"
$AgentsDir = "$ClaudeDir\agents"
$SkillsDir = "$ClaudeDir\skills"

# 이 스크립트가 만드는 모든 파일은 BOM 없는 UTF-8 로 쓴다.
# BOM 이 붙으면 셔뱅(#!/bin/bash)이 인식되지 않고 JSON.parse 가 실패한다.
# ⚠ 기존 두 방식은 안전하지 않다:
#     [System.Text.Encoding]::UTF8      → 두 셸 모두 BOM 을 쓴다
#     Set-Content -Encoding UTF8        → 5.1 은 BOM, pwsh 7 은 무BOM (같은 인스톨러가 셸에 따라 다른 바이트를 남김)
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

Write-Host ""
Write-Host "========================================"
Write-Host "  Game QA Testcase - Setup ($Mode)"
Write-Host "========================================"
Write-Host ""

# 1. Claude 디렉토리 생성
New-Item -ItemType Directory -Force -Path $AgentsDir | Out-Null
New-Item -ItemType Directory -Force -Path $SkillsDir | Out-Null

# 2. Node.js 경로 감지
$NodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $NodePath) {
    Write-Host "[ERROR] Node.js를 찾을 수 없습니다. https://nodejs.org 에서 설치 후 다시 실행해주세요." -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Node.js: $NodePath"

# 3. 에이전트 파일 복사 + 플레이스홀더 치환 — 모드 무관(AI용도 S1 설계에서 이 에이전트들을 부른다)
Write-Host ""
Write-Host "[STEP 1] 에이전트 파일 설치..."
Get-ChildItem "$RepoDir\agents\*.md" | ForEach-Object {
    $content = Get-Content $_.FullName -Raw -Encoding UTF8
    $content = $content `
        -replace '\{NODE_PATH\}',          $NodePath `
        -replace '\{PROJECT_ROOT\}',       $RepoDir `
        -replace '\{CLAUDE_AGENTS_DIR\}',  $AgentsDir `
        -replace '\{CLAUDE_SKILLS_DIR\}',  $SkillsDir
    $dest = "$AgentsDir\$($_.Name)"
    [System.IO.File]::WriteAllText($dest, $content, $Utf8NoBom)
    Write-Host "  -> $($_.Name)"
}
Write-Host "[OK] 에이전트 설치 완료"

# 3-1. 슬래시 커맨드 설치 (구버전은 이 단계가 없어 /tc-이미지매칭 이 설치되지 않았다 — 2026-07-29 추가)
#      사람용만 — 지금 커맨드(/tc-이미지매칭)는 시트 TC 용이다
$CommandsDir = "$ClaudeDir\commands"
if ($WithHuman -and (Test-Path "$RepoDir\commands")) {
    Write-Host ""
    Write-Host "[STEP 1-1] 슬래시 커맨드 설치..."
    New-Item -ItemType Directory -Force -Path $CommandsDir | Out-Null
    Get-ChildItem "$RepoDir\commands\*.md" -ErrorAction SilentlyContinue | ForEach-Object {
        $content = Get-Content $_.FullName -Raw -Encoding UTF8
        $content = $content `
            -replace '\{NODE_PATH\}',          ($NodePath -replace '\\', '/') `
            -replace '\{PROJECT_ROOT\}',       ($RepoDir -replace '\\', '/') `
            -replace '\{WORK_ROOT\}',          ($RepoDir -replace '\\', '/') `
            -replace '\{CLAUDE_HOME\}',        ($ClaudeDir -replace '\\', '/') `
            -replace '\{CLAUDE_SKILLS_DIR\}',  ($SkillsDir -replace '\\', '/')
        [System.IO.File]::WriteAllText("$CommandsDir\$($_.Name)", $content, $Utf8NoBom)
        Write-Host "  -> $($_.Name)"
    }
    Write-Host "[OK] 커맨드 설치 완료"
}

# 4. 스킬 파일 복사 + 플레이스홀더 치환
#    구버전은 복사만 해서 skills/ 안의 {PROJECT_ROOT} 등이 리터럴로 남았다 (2026-07-29 수정).
#    모드: human = tc-team-ai 를 뺀 전부(예전과 같음) · ai = tc-team-ai + tc-team 규칙 서랍(rules/)만 · both = 전부.
#    ai 에 tc-team/SKILL.md 를 안 까는 이유: 시트가 있어야 도는 사람용 드라이버라 /tc-team 이 떠도 쓸 수 없다.
#    체인(S1~S5)은 실행 중에 rules/ 만 읽는다.
Write-Host ""
Write-Host "[STEP 2] 스킬 파일 설치..."
if ($Mode -eq 'ai') {
    Copy-Item "$RepoDir\skills\tc-team-ai" -Destination $SkillsDir -Recurse -Force
    New-Item -ItemType Directory -Force -Path "$SkillsDir\tc-team" | Out-Null
    Copy-Item "$RepoDir\skills\tc-team\rules" -Destination "$SkillsDir\tc-team" -Recurse -Force
} else {
    Get-ChildItem "$RepoDir\skills" -Directory |
        Where-Object { $WithAi -or $_.Name -ne 'tc-team-ai' } |
        ForEach-Object { Copy-Item $_.FullName -Destination $SkillsDir -Recurse -Force }
}

$repoFwd = $RepoDir -replace '\\', '/'
$claudeFwd = $ClaudeDir -replace '\\', '/'
$agentsFwd = $AgentsDir -replace '\\', '/'
$skillsFwd = $SkillsDir -replace '\\', '/'
$nodeFwd = $NodePath -replace '\\', '/'

$targets = @()
$targets += Get-ChildItem -Path $SkillsDir -Recurse -File -Include *.md, *.json -ErrorAction SilentlyContinue
foreach ($sub in @('tc-team', 'scripts', 'docs')) {
    $p = Join-Path $RepoDir $sub
    if (Test-Path $p) {
        $targets += Get-ChildItem -Path $p -Recurse -File -Include *.md, *.sh, *.js -ErrorAction SilentlyContinue
    }
}
foreach ($f in $targets) {
    $c = Get-Content $f.FullName -Raw -Encoding UTF8
    if ($c -notmatch '\{(PROJECT_ROOT|WORK_ROOT|NODE_PATH|CLAUDE_HOME|CLAUDE_AGENTS_DIR|CLAUDE_SKILLS_DIR)\}') { continue }
    $c = $c -replace '\{NODE_PATH\}', $nodeFwd `
            -replace '\{PROJECT_ROOT\}', $repoFwd `
            -replace '\{WORK_ROOT\}', $repoFwd `
            -replace '\{CLAUDE_HOME\}', $claudeFwd `
            -replace '\{CLAUDE_AGENTS_DIR\}', $agentsFwd `
            -replace '\{CLAUDE_SKILLS_DIR\}', $skillsFwd
    [System.IO.File]::WriteAllText($f.FullName, $c, $Utf8NoBom)
}
Write-Host "[OK] 스킬 설치 완료 (플레이스홀더 치환 포함)"

# 5. npm 의존성 설치
Write-Host ""
Write-Host "[STEP 3] npm 패키지 설치..."
Push-Location $RepoDir
npm install
Pop-Location
Write-Host "[OK] 패키지 설치 완료"

# 6~7. pipeline_config.json · .env — 사람용만(구글 시트·드라이브 설정). AI용은 기획서 계정만 있으면 된다.
if ($WithHuman) {
# 6. pipeline_config.json 생성
Write-Host ""
Write-Host "[STEP 4] pipeline_config.json 생성..."
$ConfigDest = "$RepoDir\pipeline_config.json"
if (-not (Test-Path $ConfigDest)) {
    $config = Get-Content "$RepoDir\pipeline_config.json.template" -Raw -Encoding UTF8
    $config = $config `
        -replace 'C:/YOUR_PATH/node\.exe',      ($NodePath -replace '\\', '/') `
        -replace 'C:/YOUR_PATH/AI_AntiGravity',  ($RepoDir -replace '\\', '/')
    [System.IO.File]::WriteAllText($ConfigDest, $config, $Utf8NoBom)
    Write-Host "[OK] pipeline_config.json 생성됨 — Drive ID / Confluence site를 직접 수정해주세요."
} else {
    Write-Host "[SKIP] pipeline_config.json 이미 존재합니다."
}

# 7. .env 생성
Write-Host ""
Write-Host "[STEP 5] .env 파일 생성..."
$EnvDest = "$RepoDir\.env"
if (-not (Test-Path $EnvDest)) {
    $env_content = Get-Content "$RepoDir\.env.example" -Raw -Encoding UTF8
    $env_content = $env_content -replace 'C:/Users/YourName/Documents/Game_QA_Testcase', ($RepoDir -replace '\\', '/')
    [System.IO.File]::WriteAllText($EnvDest, $env_content, $Utf8NoBom)
    Write-Host "[OK] .env 생성됨 — Google OAuth 정보와 Spreadsheet ID를 입력해주세요."
} else {
    Write-Host "[SKIP] .env 이미 존재합니다."
}
}

Write-Host ""
Write-Host "========================================"
Write-Host "  설치 완료! ($Mode)" -ForegroundColor Green
Write-Host "========================================"
if ($WithHuman) {
    Write-Host ""
    Write-Host "[사람용 tc-team] 다음 단계:"
    Write-Host "  1. .env 파일에 Google OAuth 정보 입력"
    Write-Host "  2. pipeline_config.json에 Drive 폴더 ID / Confluence 사이트 입력"
    Write-Host "  3. ~/.claude/.mcp.json 에 MCP 설정 추가 (.mcp.json.example 참고)"
    Write-Host "  4. npm run auth  <- Google 인증 최초 실행"
    Write-Host "  사용: Claude Code에서 '/tc-team <스프레드시트 링크> <기획서 링크>'"
}
if ($WithAi) {
    Write-Host ""
    Write-Host "[AI용 tc-team-ai] 다음 단계:"
    Write-Host "  1. Confluence 계정 — 환경변수 CONFLUENCE_URL · CONFLUENCE_USERNAME · CONFLUENCE_API_TOKEN"
    Write-Host "     (기획서를 파일로 줄 거면 생략 가능)"
    Write-Host "  사용: Claude Code에서 '/tc-team-ai <기획서 링크>' — 결과는 team/specs/_ai_<기능>/ai_bundle/"
}
Write-Host ""
