#requires -Version 5
# install.ps1 — 한 줄 "딸깍" 설치 부트스트랩
#
#   PowerShell에 아래 한 줄만 붙여넣으면 됩니다:
#   irm https://raw.githubusercontent.com/nobles92ts-ship-it/AI_GAME_QA_TestCase/main/install.ps1 | iex
#
# 하는 일: 이 레포를 내려받아 setup.ps1(agents/skills를 ~/.claude 에 설치)을 실행한다.
# 실제 AI 실행은 "당신의" Claude Code(당신 구독)로 일어난다 — 추가 요금 0원, 토큰은 이 PC에만.

$ErrorActionPreference = 'Stop'
try { chcp 65001 > $null; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$Owner  = 'nobles92ts-ship-it'
$Repo   = 'AI_GAME_QA_TestCase'
$Branch = 'main'
$Url    = "https://github.com/$Owner/$Repo"
$Dest   = Join-Path $env:USERPROFILE $Repo

Write-Host "============================================================"
Write-Host " Game QA TestCase — 설치"
Write-Host " 당신의 Claude 구독으로 당신 PC에서 실행 · 추가 요금 0원"
Write-Host " * 권장 플랜: Max(5x/20x). 긴 실행은 사용량이 많아 Pro는 한도에 빨리 닿을 수 있습니다."
Write-Host " * 당신의 로그인 토큰은 이 PC를 절대 벗어나지 않습니다."
Write-Host " 설치 위치: $Dest"
Write-Host "============================================================"

# 0) Node.js 확인 (setup.ps1 / Claude Code 전제)
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "[!] Node.js가 없습니다. 설치 후 다시 실행하세요:" -ForegroundColor Yellow
  Write-Host "      winget install -e --id OpenJS.NodeJS.LTS" -ForegroundColor White
  return
}

# 0-1) Claude Code 확인 (없으면 설치)
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  Write-Host "[*] Claude Code 설치 중 (npm)..." -ForegroundColor Cyan
  npm install -g "@anthropic-ai/claude-code"
}

# 1) 소스 받기 (git 우선, 없으면 zip)
if (Get-Command git -ErrorAction SilentlyContinue) {
  if (Test-Path (Join-Path $Dest '.git')) {
    Write-Host "[1] 업데이트 (git pull)..."
    git -C $Dest pull --ff-only
  } else {
    Write-Host "[1] 내려받기 (git clone)..."
    if (Test-Path $Dest) { Remove-Item $Dest -Recurse -Force }
    git clone --depth 1 "$Url.git" $Dest
  }
} else {
  Write-Host "[1] 내려받기 (zip)..."
  $zip = Join-Path $env:TEMP "$Repo.zip"
  Invoke-WebRequest "$Url/archive/refs/heads/$Branch.zip" -OutFile $zip
  $tmp = Join-Path $env:TEMP "$Repo-extract"
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  Expand-Archive $zip -DestinationPath $tmp -Force
  $inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
  if (Test-Path $Dest) { Remove-Item $Dest -Recurse -Force }
  Move-Item $inner.FullName $Dest
  Remove-Item $zip -Force
}

# 2) setup.ps1 실행 (agents/skills → ~/.claude, 경로 치환)
$setup = Join-Path $Dest 'setup.ps1'
if (-not (Test-Path $setup)) { Write-Host "[X] setup.ps1 없음 — 배포본 손상" -ForegroundColor Red; return }
Write-Host "[2] setup.ps1 실행..."
Push-Location $Dest
try { & $setup } finally { Pop-Location }

# 3) 다음 단계 안내
Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host " 설치 완료! 다음 순서로 사용하세요:" -ForegroundColor Green
Write-Host "   1) 터미널에서  claude  실행 → /login (본인 Pro/Max 계정)" -ForegroundColor Green
Write-Host "   2) (최초 1회) docs/PREREQUISITES.md 의 구글 시트 연결 설정" -ForegroundColor Green
Write-Host "   3) Claude Code에 '스프레드시트 링크 + 기획서 링크'를 함께 주면" -ForegroundColor Green
Write-Host "      TC 팀 v2가 자동으로 테스트케이스를 생성합니다." -ForegroundColor Green
Write-Host " 비용: 0원 (본인 Claude 구독 사용량만 · 토큰은 이 PC에만)" -ForegroundColor Green
Write-Host " 폴더: $Dest" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
