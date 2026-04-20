/**
 * tc_notifier.js
 * TC 팀 v2 state.json 상태 변화를 감지하여 Windows 토스트 알림 전송
 *
 * 사용법:
 *   node tc_notifier.js           (5초마다 폴링, 변화 시 알림)
 *   node tc_notifier.js --once    (1회만 체크)
 *   node tc_notifier.js --test    (테스트 알림 전송)
 *
 * 알림 조건:
 *   - spec의 state가 변경될 때
 *   - review_round가 증가할 때
 *   - 새 spec이 추가될 때
 *   - done 상태로 완료될 때
 */

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── 파일 경로 ────────────────────────────────────────────────────────────────
const STATE_FILE    = '{PROJECT_ROOT}/team/state.json';
const STATUS_DIR    = '{PROJECT_ROOT}/team/status/';
const SNAPSHOT_FILE = path.join(__dirname, 'tc_notifier_snapshot.json');

// ── 폴링 간격 (ms) ───────────────────────────────────────────────────────────
const POLL_INTERVAL = 5000;

// ── 상태 라벨 (파이프라인 v2 기준) ───────────────────────────────────────────
const STATE_LABELS = {
  pending:          '🕐 대기',
  designing:        '✏️  설계 중',
  design_reviewing: '🔍 설계 검수',
  design_fixing:    '🔧 설계 수정',
  designed:         '✅ 설계 완료',
  writing:          '📝 TC 작성 중',
  written:          '📋 TC 작성 완료',
  reviewing:        '👀 리뷰 중',
  fixing:           '🔨 수정 중',
  verifying:        '🧪 검증 중',
  done:             '🎉 완료',
};

function getStateLabel(state) {
  return STATE_LABELS[state] || `[${state}]`;
}

// ── Windows PowerShell 토스트 알림 ──────────────────────────────────────────
function sendToast(title, message, urgency = 'normal') {
  // urgency: 'normal' | 'done' | 'error'
  const icon = urgency === 'done' ? '✅' : urgency === 'error' ? '❌' : 'ℹ️';

  // BurntToast 없이도 동작하는 순수 PowerShell 알림
  const ps = `
Add-Type -AssemblyName System.Windows.Forms
$notification = New-Object System.Windows.Forms.NotifyIcon
$notification.Icon = [System.Drawing.SystemIcons]::Information
$notification.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
$notification.BalloonTipTitle = ${JSON.stringify(title)}
$notification.BalloonTipText  = ${JSON.stringify(message)}
$notification.Visible = $true
$notification.ShowBalloonTip(8000)
Start-Sleep -Milliseconds 9000
$notification.Dispose()
`.trim();

  try {
    execSync(
      `powershell -NoProfile -NonInteractive -Command "${ps.replace(/"/g, '\\"').replace(/\n/g, '; ')}"`,
      { timeout: 12000, stdio: 'pipe' }
    );
  } catch (e) {
    // 알림 실패 시 콘솔에만 출력
    console.error('[알림 오류]', e.message?.slice(0, 120));
  }
}

// ── 더 나은 방법: msg2toast (wscript) 방식 ───────────────────────────────────
function sendToastViaPS(title, body, urgency = 'normal') {
  const iconType = urgency === 'done' ? 'Info' : urgency === 'error' ? 'Error' : 'Info';
  // PowerShell 5 호환 (Windows 10/11 기본)
  const script = [
    `[void][System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms')`,
    `$n = New-Object System.Windows.Forms.NotifyIcon`,
    `$n.Icon = [System.Drawing.SystemIcons]::Application`,
    `$n.BalloonTipIcon = '${iconType}'`,
    `$n.BalloonTipTitle = '${title.replace(/'/g, "''")}'`,
    `$n.BalloonTipText = '${body.replace(/'/g, "''")}'`,
    `$n.Visible = $true`,
    `$n.ShowBalloonTip(7000)`,
    `Start-Sleep -s 8`,
    `$n.Dispose()`,
  ].join('; ');

  try {
    execSync(`powershell -NoProfile -WindowStyle Hidden -Command "${script}"`, {
      timeout: 12000,
      stdio: 'pipe',
      windowsHide: true,
    });
  } catch (e) {
    console.error('[알림 오류]', e.message?.slice(0, 120));
  }
}

// ── 알림 전송 (비동기, 블로킹 안 함) ────────────────────────────────────────
function notify(title, body, urgency = 'normal') {
  const ts = new Date().toLocaleTimeString('ko-KR', { hour12: false });
  const icon = urgency === 'done' ? '🎉' : urgency === 'error' ? '❌' : '🔔';
  console.log(`[${ts}] ${icon} ${title} — ${body}`);

  // 별도 child process로 비동기 실행 (메인 루프 블로킹 방지)
  const { spawn } = require('child_process');
  const iconType = urgency === 'done' ? 'Info' : 'Info';
  const safeTitle = title.replace(/'/g, "''");
  const safeBody  = body.replace(/'/g, "''");
  const script = [
    `[void][System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms')`,
    `$n = New-Object System.Windows.Forms.NotifyIcon`,
    `$n.Icon = [System.Drawing.SystemIcons]::Application`,
    `$n.BalloonTipIcon = 'Info'`,
    `$n.BalloonTipTitle = '${safeTitle}'`,
    `$n.BalloonTipText = '${safeBody}'`,
    `$n.Visible = $true`,
    `$n.ShowBalloonTip(7000)`,
    `Start-Sleep -s 8`,
    `$n.Dispose()`,
  ].join('; ');

  const proc = spawn('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', script], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  proc.unref();
}

// ── 스냅샷 로드/저장 ──────────────────────────────────────────────────────────
function loadSnapshot() {
  if (!fs.existsSync(SNAPSHOT_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveSnapshot(snap) {
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snap, null, 2), 'utf8');
}

// ── state.json 읽기 ───────────────────────────────────────────────────────────
function readState() {
  if (!fs.existsSync(STATE_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

// ── 에이전트 상태 파일 읽기 ───────────────────────────────────────────────────
function readAgentStatus() {
  const agents = [
    { file: 'tc-designer-v2.txt',    label: '설계' },
    { file: 'tc-설계검수-v2.txt',    label: '설계검수' },
    { file: 'tc-writer-v2.txt',      label: '작성' },
    { file: 'qa-reviewer-v2.txt',    label: '리뷰/검증' },
    { file: 'tc-fixer-v2.txt',       label: '수정' },
  ];
  const active = [];
  for (const a of agents) {
    const fp = path.join(STATUS_DIR, a.file);
    if (fs.existsSync(fp)) {
      const raw = fs.readFileSync(fp, 'utf8').trim();
      const [action, feature] = raw.split('|');
      if (action && action !== 'idle') {
        active.push(`${a.label}(${action})`);
      }
    }
  }
  return active.join(', ') || null;
}

// ── 변경 감지 및 알림 ────────────────────────────────────────────────────────
function checkAndNotify(snapshot) {
  const raw = readState();
  if (!raw) {
    console.log('[경고] state.json 파일을 찾을 수 없습니다.');
    return snapshot;
  }

  const specs = raw.specs || [];
  const newSnap = {};
  const now = new Date().toLocaleTimeString('ko-KR', { hour12: false });

  for (const spec of specs) {
    const key = spec.feature;
    if (!key) continue;

    const curState  = spec.state || 'pending';
    const curRound  = spec.review_round || 0;
    newSnap[key] = { state: curState, review_round: curRound };

    const prev = snapshot[key];

    // ── 신규 기능 추가 ──────────────────────────────────────────────────────
    if (!prev) {
      const label = getStateLabel(curState);
      notify(
        `[TC] 새 기능 추가됨`,
        `${key.replace(/_/g, ' ')} → ${label}`,
        'normal'
      );
      continue;
    }

    // ── 상태 변경 ──────────────────────────────────────────────────────────
    if (prev.state !== curState) {
      const fromLabel = getStateLabel(prev.state);
      const toLabel   = getStateLabel(curState);
      const urgency   = curState === 'done' ? 'done' : 'normal';
      const featureName = key.replace(/_/g, ' ');

      let msg = `${featureName}\n${fromLabel} → ${toLabel}`;
      if (curRound > 0) msg += ` (리뷰 ${curRound}회차)`;

      notify(`[TC 상태 변경]`, msg, urgency);
    }
    // ── review_round 증가 (state 변경 없이 round만 바뀔 때) ────────────────
    else if (prev.review_round !== curRound) {
      const featureName = key.replace(/_/g, ' ');
      notify(
        `[TC] 리뷰 라운드 변경`,
        `${featureName} — ${curRound}회차 진입\n현재 상태: ${getStateLabel(curState)}`,
        'normal'
      );
    }
  }

  // ── 제거된 기능 감지 ──────────────────────────────────────────────────────
  for (const key of Object.keys(snapshot)) {
    if (!newSnap[key]) {
      notify(
        `[TC] 기능 제거됨`,
        `${key.replace(/_/g, ' ')} 가 목록에서 제거되었습니다.`,
        'error'
      );
    }
  }

  return newSnap;
}

// ── 상태 요약 출력 ────────────────────────────────────────────────────────────
function printSummary() {
  const raw = readState();
  if (!raw) { console.log('state.json 없음'); return; }

  const specs = raw.specs || [];
  const now = new Date().toLocaleTimeString('ko-KR', { hour12: false });
  console.log(`\n TC 팀 v2 상태 모니터  [${now}]`);
  console.log('─'.repeat(50));
  for (const s of specs) {
    const label = getStateLabel(s.state);
    const round = s.review_round ? ` (리뷰 ${s.review_round}회)` : '';
    console.log(` ${label}${round}  ${(s.feature || '').replace(/_/g, ' ')}`);
  }
  const agentInfo = readAgentStatus();
  if (agentInfo) {
    console.log('─'.repeat(50));
    console.log(` 작업 중: ${agentInfo}`);
  }
  console.log('─'.repeat(50));
  console.log(` 감시 중... (Ctrl+C로 종료)\n`);
}

// ── 메인 ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

if (args.includes('--test')) {
  // 테스트 알림 전송
  console.log('[테스트] 알림 전송 중...');
  notify('[TC] 테스트 알림', 'tc_notifier.js 정상 작동 중입니다! 🎉', 'done');
  console.log('[테스트] 완료');
  process.exit(0);
}

if (args.includes('--once')) {
  // 1회 체크
  const snap = loadSnapshot();
  const newSnap = checkAndNotify(snap);
  saveSnapshot(newSnap);
  printSummary();
  process.exit(0);
}

// ── 연속 폴링 모드 (기본) ─────────────────────────────────────────────────────
console.log('[TC 알리미] 시작됨 — state.json 변화 감시 중 (5초 간격)');
console.log(`[TC 알리미] state.json: ${STATE_FILE}`);

let snapshot = loadSnapshot();

// 최초 실행: 현재 상태를 기준으로 스냅샷 초기화 (첫 실행 시 알림 폭탄 방지)
const raw = readState();
if (raw && Object.keys(snapshot).length === 0) {
  console.log('[TC 알리미] 초기 스냅샷 생성 중...');
  for (const spec of (raw.specs || [])) {
    if (spec.feature) {
      snapshot[spec.feature] = {
        state: spec.state || 'pending',
        review_round: spec.review_round || 0,
      };
    }
  }
  saveSnapshot(snapshot);
  console.log('[TC 알리미] 초기 스냅샷 저장 완료. 이제부터 변화 감지 시작.\n');
}

printSummary();

setInterval(() => {
  snapshot = loadSnapshot();
  const newSnap = checkAndNotify(snapshot);
  saveSnapshot(newSnap);

  // 터미널 요약 갱신 (5번에 1번, 25초마다)
}, POLL_INTERVAL);

// 25초마다 터미널 요약 출력
setInterval(() => {
  printSummary();
}, 25000);
