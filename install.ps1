#requires -Version 5
# install.ps1 — 한 줄 "딸깍" 설치 부트스트랩
#
#   PowerShell에 아래 한 줄만 붙여넣으면 됩니다:
#   irm https://raw.githubusercontent.com/nobles92ts-ship-it/AI_GAME_QA_TestCase/main/install.ps1 | iex
#
# 하는 일: (없으면) Node.js·Claude Code 자동 설치 → 이 레포 받기 → setup.ps1 실행.
# 실제 AI 실행은 "당신의" Claude Code(당신 구독)로 일어난다 — 추가 요금 0원, 토큰은 이 PC에만.

$ErrorActionPreference = 'Stop'
try { chcp 65001 > $null; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

# Windows 전용 — 맥/리눅스의 PowerShell Core 등에서 잘못 실행되면 명확히 안내하고 중단
# ($env:OS 는 Windows에서만 'Windows_NT'; $IsWindows 는 PS5.1에 없으므로 $env:OS 로 판별)
if ($env:OS -ne 'Windows_NT') {
  Write-Host "이 설치 도구는 Windows 전용입니다 (winget/msiexec 사용). Windows PC에서 실행해 주세요." -ForegroundColor Red
  exit 1
}

$Owner  = 'nobles92ts-ship-it'
$Repo   = 'AI_GAME_QA_TestCase'
$Branch = 'main'
$Url    = "https://github.com/$Owner/$Repo"
$Dest   = Join-Path $env:USERPROFILE $Repo

function Refresh-Path {
  $m = [System.Environment]::GetEnvironmentVariable('Path','Machine')
  $u = [System.Environment]::GetEnvironmentVariable('Path','User')
  $env:Path = (@($m,$u) | Where-Object { $_ } ) -join ';'
}
function Have($cmd){ [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

function Ensure-Node {
  if (Have node) { Write-Host "  [OK] Node.js: $((node -v))" -ForegroundColor Green; return $true }
  Write-Host "  [*] Node.js가 없어 자동 설치합니다 (UAC '예'가 뜨면 허용)..." -ForegroundColor Cyan

  # 1) winget (있으면)
  if (Have winget) {
    try { winget install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements | Out-Null } catch {}
    Refresh-Path
    if (Have node) { Write-Host "  [OK] Node.js 설치됨 (winget): $((node -v))" -ForegroundColor Green; return $true }
  }

  # 2) winget 부재/실패 → 현재 LTS MSI 직접 다운로드·무인 설치
  try {
    Write-Host "    현재 LTS 버전 조회 중..."
    $lts = (Invoke-RestMethod 'https://nodejs.org/dist/index.json' | Where-Object { $_.lts } | Select-Object -First 1).version
    if (-not $lts) { throw "LTS 버전 조회 실패" }
    $arch = if ([Environment]::Is64BitOperatingSystem) { 'x64' } else { 'x86' }
    $msiUrl = "https://nodejs.org/dist/$lts/node-$lts-$arch.msi"
    $msi = Join-Path $env:TEMP "node-$lts-$arch.msi"
    Write-Host "    다운로드: $msiUrl"
    Invoke-WebRequest $msiUrl -OutFile $msi
    Write-Host "    설치 중 (msiexec)..."
    Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /qn /norestart" -Wait
    Remove-Item $msi -Force -ErrorAction SilentlyContinue
    Refresh-Path
  } catch { Write-Host "  [!] 자동 설치 실패: $($_.Exception.Message)" -ForegroundColor Yellow }

  if (Have node) { Write-Host "  [OK] Node.js 설치됨: $((node -v))" -ForegroundColor Green; return $true }
  Write-Host "  [X] Node.js 자동 설치에 실패했습니다. https://nodejs.org 에서 LTS 설치 후 다시 실행하세요." -ForegroundColor Red
  return $false
}

function Ensure-Claude {
  if (Have claude) { Write-Host "  [OK] Claude Code 준비됨" -ForegroundColor Green; return $true }
  Write-Host "  [*] Claude Code가 없어 설치합니다 (npm)..." -ForegroundColor Cyan
  try { npm install -g "@anthropic-ai/claude-code" | Out-Null } catch { Write-Host "  [!] npm 설치 실패: $($_.Exception.Message)" -ForegroundColor Yellow }
  Refresh-Path
  # npm 전역 bin 경로 보강 (세션 PATH에 없을 수 있음)
  $npmBin = Join-Path $env:APPDATA 'npm'
  if ((Test-Path $npmBin) -and ($env:Path -notlike "*$npmBin*")) { $env:Path = "$npmBin;$env:Path" }
  if (Have claude) { Write-Host "  [OK] Claude Code 설치됨" -ForegroundColor Green; return $true }
  Write-Host "  [X] Claude Code 설치에 실패했습니다. 'npm install -g @anthropic-ai/claude-code' 수동 실행 후 다시 시도하세요." -ForegroundColor Red
  return $false
}

Write-Host "============================================================"
Write-Host " Game QA TestCase — 설치"
Write-Host " 당신의 Claude 구독으로 당신 PC에서 실행 · 추가 요금 0원"
Write-Host " * 권장 플랜: Max(5x/20x). 긴 실행은 사용량이 많아 Pro는 한도에 빨리 닿을 수 있습니다."
Write-Host " * 당신의 로그인 토큰은 이 PC를 절대 벗어나지 않습니다."
Write-Host " 설치 위치: $Dest"
Write-Host "============================================================"

Write-Host ""; Write-Host "[0] 필수 도구 확인 / 자동 설치"
if (-not (Ensure-Node))   { exit 1 }
if (-not (Ensure-Claude)) { exit 1 }

Write-Host ""; Write-Host "[1] 도구 내려받기"
if (Have git) {
  if (Test-Path (Join-Path $Dest '.git')) {
    # setup.ps1이 추적 파일을 in-place 치환하므로 pull은 항상 충돌 — fetch+reset으로 강제 동기화.
    # (치환은 아래 setup.ps1 재실행이 다시 수행. credentials/.env/slack_config.json 등 미추적 파일은 보존됨)
    Write-Host "    업데이트 (git fetch + reset)..."
    git -C $Dest fetch origin $Branch
    git -C $Dest reset --hard "origin/$Branch"
    if ($LASTEXITCODE -ne 0) { Write-Host "  [X] 업데이트 실패 — 폴더($Dest)를 삭제 후 이 명령을 다시 실행하면 새로 받습니다." -ForegroundColor Red; exit 1 }
  } else {
    Write-Host "    git clone..."; if (Test-Path $Dest) { Remove-Item $Dest -Recurse -Force }
    git clone --depth 1 "$Url.git" $Dest
  }
} else {
  Write-Host "    zip 다운로드..."
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

$setup = Join-Path $Dest 'setup.ps1'
if (-not (Test-Path $setup)) { Write-Host "  [X] setup.ps1 없음 — 배포본 손상" -ForegroundColor Red; exit 1 }
Write-Host ""; Write-Host "[2] setup.ps1 실행 (에이전트·스킬 → ~/.claude)"
Push-Location $Dest
# .ps1 파일 직접 호출(& $setup)은 기본 실행정책(Restricted)에서 차단됨 — 자식 프로세스로 Bypass 실행
try {
  & powershell -NoProfile -ExecutionPolicy Bypass -File $setup
  if ($LASTEXITCODE -ne 0) { Write-Host "  [X] setup.ps1 실패 (rc=$LASTEXITCODE)" -ForegroundColor Red; exit 1 }
} finally { Pop-Location }

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host " 설치 완료! 다음 순서로 사용하세요:" -ForegroundColor Green
Write-Host "   1) 터미널에서  claude  실행 → /login (본인 Pro/Max 계정)" -ForegroundColor Green
Write-Host "   2) 가장 쉬운 사용법 (구글 설정 불필요):" -ForegroundColor Green
Write-Host "        claude 에  /tc-로컬 <기능명> <기획서파일>  → 엑셀(.xlsx) 자동 생성" -ForegroundColor Green
Write-Host "   3) (선택) 구글 시트로 받으려면 docs/PREREQUISITES.md 의 구글 연결 설정 후" -ForegroundColor Green
Write-Host "        '스프레드시트 링크 + 기획서 링크'를 주면 TC 팀 v2가 시트에 생성합니다." -ForegroundColor Green
Write-Host " 비용: 0원 (본인 Claude 구독 사용량만 · 토큰은 이 PC에만)" -ForegroundColor Green
Write-Host " 폴더: $Dest" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
