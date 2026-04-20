/**
 * pipeline_monitor.js
 * TC 파이프라인 칸반 모니터 — state.json 기반으로 각 기획서의 현재 위치를 표시
 * 8단계를 세로(행)로, 기획서명을 오른쪽에 나열
 *
 * 사용법:
 *   node pipeline_monitor.js          (1회 출력)
 *   node pipeline_monitor.js --watch  (5초마다 자동 갱신)
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const STATE_FILE = 'YOUR_WORK_ROOT/team/state.json';
const HISTORY_FILE = 'YOUR_WORK_ROOT/team/history.json';
const STATUS_DIR = 'YOUR_WORK_ROOT/team/status/';

// ── 행 정의 (순서 고정) ────────────────────────────────────────────────────
const ROWS = [
  { key: 'pending',   label: '대기 ' },
  { key: 'designing', label: '설계 ' },
  { key: 'writing',   label: '작성 ' },
  { key: 'coverage',  label: '검증 ' },
  { key: 'review1',   label: '리뷰1' },
  { key: 'fix1',      label: '수정1' },
  { key: 'review2',   label: '리뷰2' },
  { key: 'fix2',      label: '수정2' },
  { key: 'review3',   label: '리뷰3' },
];

// ── state + review_round → 행 키 매핑 ─────────────────────────────────────
function getRow(spec) {
  const { state, review_round } = spec;
  const r = review_round || 0;
  switch (state) {
    case 'pending':   return 'pending';
    case 'designing': return 'designing';
    case 'designed':  return 'writing';
    case 'writing':   return 'writing';
    case 'written':
      if (r === 0) return 'coverage';
      if (r === 1) return 'review1';
      if (r === 2) return 'review2';
      if (r === 3) return 'review3';
      return 'done';
    case 'reviewing':
      if (r === 1) return 'review1';
      if (r === 2) return 'review2';
      return 'review3';
    case 'fixing':
      if (r === 1) return 'fix1';
      return 'fix2';
    case 'done': return 'done';
    default:     return 'pending';
  }
}

// ── 시간 포맷팅 (ms → "2h 30m") ────────────────────────────────────────────
function formatDuration(ms) {
  const totalMinutes = Math.floor(ms / 1000 / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ── 특정 단계의 소요시간 계산 ─────────────────────────────────────────────
function getStateDuration(feature, history, state) {
  if (!history[feature]) return null;
  const timeline = history[feature];
  let current = null;
  for (const entry of timeline) {
    if (entry.state === state) {
      current = entry;
      break;
    }
  }
  if (!current) return null;

  const currentIdx = timeline.indexOf(current);
  const nextIdx = currentIdx + 1;
  if (nextIdx >= timeline.length) {
    // 아직 완료되지 않음 → 현재 시간까지의 경과시간
    const elapsed = Date.now() - new Date(current.entered_at).getTime();
    return {
      duration: elapsed,
      ongoing: true,
      startTime: current.entered_at,
      endTime: null
    };
  }

  const startTime = new Date(current.entered_at);
  const endTime = new Date(timeline[nextIdx].entered_at);
  const duration = endTime.getTime() - startTime.getTime();
  return {
    duration,
    ongoing: false,
    startTime: current.entered_at,
    endTime: timeline[nextIdx].entered_at
  };
}

// ── 시간 포맷팅 (ISO → "14:30") ────────────────────────────────────────────
function formatTime(isoString) {
  const date = new Date(isoString);
  return date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// ── 에이전트 상태 파일 읽기 ────────────────────────────────────────────────
function readAgentStatus() {
  const agents = [
    { file: 'tc-designer.txt',  label: '설계A' },
    { file: 'tc-designer2.txt', label: '설계B' },
    { file: 'tc-writer.txt',    label: '작성A' },
    { file: 'tc-writer2.txt',   label: '작성B' },
    { file: 'qa-reviewer.txt',  label: '리뷰  ' },
    { file: 'tc-fixer.txt',     label: '수정A' },
    { file: 'tc-fixer2.txt',    label: '수정B' },
  ];
  const result = [];
  for (const a of agents) {
    const fp = path.join(STATUS_DIR, a.file);
    if (fs.existsSync(fp)) {
      const raw = fs.readFileSync(fp, 'utf8').trim();
      const [action, feature] = raw.split('|');
      if (action && action !== 'idle') {
        result.push(`${a.label}: ${action}${feature ? ' [' + feature.replace(/_/g, '') + ']' : ''}`);
      }
    }
  }
  return result;
}

// ── 이전 출력 줄 지우기 (readline 기반, Windows PowerShell 호환) ─────────
let prevLineCount = 0;

function clearPrevOutput() {
  if (prevLineCount > 0) {
    readline.moveCursor(process.stdout, 0, -prevLineCount);
    readline.clearScreenDown(process.stdout);
  }
}

// ── ANSI 색상 (터미널 렌더링 글리치 방지) ──────────────────────────────────
const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  cyan:   '\x1b[36m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  white:  '\x1b[37m',
  gray:   '\x1b[90m',
};

// ── 메인 렌더링 ────────────────────────────────────────────────────────────
function render() {
  if (!fs.existsSync(STATE_FILE)) {
    clearPrevOutput();
    process.stdout.write('\n  [파이프라인 없음]  state.json 파일을 찾을 수 없습니다.\n\n');
    return;
  }

  const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  const specs = raw.specs || [];
  let history = fs.existsSync(HISTORY_FILE)
    ? JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'))
    : {};

  // history.json에 없는 기능 자동 생성
  let historyUpdated = false;
  for (const spec of specs) {
    if (!history[spec.feature]) {
      const now = new Date();
      history[spec.feature] = [
        { "state": "pending",   "entered_at": now.toISOString().slice(0, 19) },
        { "state": "done",      "entered_at": now.toISOString().slice(0, 19) }
      ];
      historyUpdated = true;
    }
  }

  // history.json 자동 저장
  if (historyUpdated) {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
  }

  // 각 행에 기능명 배치
  const rows = {};
  const done  = [];
  const stats = [];  // 각 기능의 시간 통계

  for (const r of ROWS) rows[r.key] = [];

  for (const spec of specs) {
    if (!spec.feature) continue;
    const rowKey = getRow(spec);
    const name = spec.feature.replace(/_/g, ' ');

    // 통계 수집: done 상태는 첫 단계(pending)부터 마지막까지의 총 시간
    let statInfo = null;
    if (spec.state === 'done' && history[spec.feature]) {
      const timeline = history[spec.feature];
      if (timeline.length > 1) {
        const startTime = new Date(timeline[0].entered_at);
        const endTime = new Date(timeline[timeline.length - 1].entered_at);
        const duration = endTime.getTime() - startTime.getTime();
        statInfo = {
          duration,
          ongoing: false,
          startTime: timeline[0].entered_at,
          endTime: timeline[timeline.length - 1].entered_at
        };
      }
    } else {
      statInfo = getStateDuration(spec.feature, history, spec.state);
    }

    if (statInfo) {
      const dur = formatDuration(statInfo.duration);
      const startTime = formatTime(statInfo.startTime);
      let timeRange;

      if (statInfo.endTime) {
        const endTime = formatTime(statInfo.endTime);
        timeRange = `${startTime}-${endTime}`;
      } else {
        timeRange = `${startTime}-현재`;
      }

      const marker = spec.state === 'done' ? '✅' : (statInfo.ongoing ? '▶' : ' ');
      const featureName = (spec.feature || '').replace(/_/g, ' ');
      stats.push(`${marker} ${featureName}: ${timeRange} (${dur})`);
    }

    if (rowKey === 'done') { done.push(name); continue; }
    rows[rowKey].push(name);
  }

  // ── 출력 ─────────────────────────────────────────────────────────────────
  const now = new Date().toLocaleTimeString('ko-KR', { hour12: false });
  const W = 52;  // 기능명 영역 너비
  const lines = [];

  lines.push('');
  lines.push(`${C.bold}${C.cyan} TC 파이프라인 현황  (${now})${C.reset}`);

  for (const r of ROWS) {
    const items = rows[r.key];
    if (items.length === 0) {
      lines.push(`${C.white} ${r.label} ${C.gray}│${C.reset}`);
    } else {
      items.forEach((name, i) => {
        const truncated = name.length > W ? name.slice(0, W - 1) + '…' : name;
        if (i === 0) {
          lines.push(`${C.white} ${r.label} ${C.gray}│${C.yellow} ${truncated}${C.reset}`);
        } else {
          lines.push(`${C.gray}       │${C.yellow} ${truncated}${C.reset}`);
        }
      });
    }
  }

  if (done.length) {
    lines.push(`${C.white} 완료  ${C.gray}│${C.green} ${done.join(', ')}${C.reset}`);
  }

  // 통계 섹션
  if (stats.length) {
    lines.push(`${C.white} 시간  ${C.gray}│${C.reset}`);
    stats.forEach(stat => {
      lines.push(`${C.gray}       │${C.white} ${stat}${C.reset}`);
    });
  }

  const agentStatus = readAgentStatus();
  if (agentStatus.length) {
    lines.push(`${C.white} 팀원  ${C.gray}│${C.cyan} ${agentStatus.join(`  ${C.gray}│${C.cyan}  `)}${C.reset}`);
  }

  lines.push('');

  clearPrevOutput();
  const output = lines.join('\n') + '\n';
  process.stdout.write(output);
  prevLineCount = lines.length;
}

// ── 실행 ──────────────────────────────────────────────────────────────────
const watchMode = process.argv.includes('--watch');
render();
if (watchMode) {
  setInterval(render, 5000);
}
