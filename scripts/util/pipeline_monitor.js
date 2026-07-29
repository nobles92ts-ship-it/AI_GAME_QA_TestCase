/**
 * pipeline_monitor.js
 * TC 파이프라인 칸반 모니터 — state.json 기반으로 각 기획서의 현재 위치를 표시
 * 10단계를 세로(행)로, 기획서명을 오른쪽에 나열
 *
 * v2 업그레이드:
 *   - 상단 헤더: 배치 진행률 바
 *   - 진행중 기능에 ▶ 마커 + 경과시간 인라인
 *   - 완료 섹션: ✓/✗/⟲ + 소요 + TC 수
 *   - 실패 기능 재실행 템플릿 자동 표시
 *   - 비용 표기 제거(2026-06-10): cost.log 미배선(쓰기 코드 없음) — 거짓 $0 표시 방지 (팀장-1ⓑ 연장)
 *
 * 사용법:
 *   node pipeline_monitor.js          (1회 출력)
 *   node pipeline_monitor.js --watch  (5초마다 자동 갱신)
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// 경로는 이 스크립트 위치(scripts/util/)에서 레포 루트를 유도한다. env 로 덮어쓸 수 있다.
const PROJECT_ROOT = process.env.TCTEAM_PROJECT_ROOT || path.resolve(__dirname, '..', '..');
const TEAM_DIR = path.join(PROJECT_ROOT, 'team');
const STATE_FILE = path.join(TEAM_DIR, 'state.json');
const HISTORY_FILE = path.join(TEAM_DIR, 'history.json');
const TIMING_FILE = path.join(TEAM_DIR, 'timing.csv');
const STATUS_DIR = path.join(TEAM_DIR, 'status') + path.sep;
const SPECS_DIR = path.join(TEAM_DIR, 'specs') + path.sep;

// ── 행 정의 (순서 고정) — v2 파이프라인 기준 ──────────────────────────────
const ROWS = [
  { key: 'pending',       label: '대기  ' },
  { key: 'designing',     label: '설계  ' },
  { key: 'design_review', label: '검수  ' },
  { key: 'design_fix',    label: '수정  ' },
  { key: 'writing',       label: '작성  ' },
  { key: 'review1',       label: '리뷰1 ' },
  { key: 'fix1',          label: '수정1 ' },
  { key: 'review2',       label: '리뷰2 ' },
  { key: 'fix2',          label: '수정2 ' },
  { key: 'verify',        label: '검증  ' },
];

// ── state + review_round → 행 키 매핑 (v2 파이프라인) ─────────────────────
function getRow(spec) {
  const { state, review_round } = spec;
  const r = review_round || 0;
  switch (state) {
    case 'pending':          return 'pending';
    case 'designing':        return 'designing';
    case 'design_reviewing': return 'design_review';
    case 'design_fixing':    return 'design_fix';
    case 'designed':         return 'writing';
    case 'writing':          return 'writing';
    case 'written':
      if (r <= 1) return 'review1';
      if (r === 2) return 'review2';
      return 'done';
    case 'reviewing':
      if (r <= 1) return 'review1';
      return 'review2';
    case 'fixing':
      if (r <= 1) return 'fix1';
      return 'fix2';
    case 'reviewing_fixing': return 'review2';
    case 'verifying':        return 'verify';
    case 'done':             return 'done';
    case 'failed':           return 'failed';
    default:                 return 'pending';
  }
}

// ── 시간 포맷팅 (ms → "2h 30m" / "12m 30s") ────────────────────────────────
function formatDuration(ms) {
  if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
  const totalMinutes = Math.floor(ms / 1000 / 60);
  if (totalMinutes < 60) {
    const sec = Math.floor((ms % 60000) / 1000);
    return sec > 0 ? `${totalMinutes}m ${sec}s` : `${totalMinutes}m`;
  }
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
    if (entry.state === state) { current = entry; break; }
  }
  if (!current) return null;
  const currentIdx = timeline.indexOf(current);
  const nextIdx = currentIdx + 1;
  if (nextIdx >= timeline.length) {
    const elapsed = Date.now() - new Date(current.entered_at).getTime();
    return { duration: elapsed, ongoing: true, startTime: current.entered_at, endTime: null };
  }
  const startTime = new Date(current.entered_at);
  const endTime = new Date(timeline[nextIdx].entered_at);
  return {
    duration: endTime.getTime() - startTime.getTime(),
    ongoing: false,
    startTime: current.entered_at,
    endTime: timeline[nextIdx].entered_at
  };
}

function formatTime(isoString) {
  const date = new Date(isoString);
  return date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// ── step_result.json에서 TC 수 읽기 (있으면) ───────────────────────────────
function readTcCount(feature) {
  const candidates = ['step4_result.json', 'step_result.json'];
  for (const c of candidates) {
    const fp = path.join(SPECS_DIR, feature, c);
    if (fs.existsSync(fp)) {
      try {
        const r = JSON.parse(fs.readFileSync(fp, 'utf8'));
        if (r.tc_count) return r.tc_count;
        if (r.total_tc) return r.total_tc;
      } catch {}
    }
  }
  return null;
}

// ── 안전 파일 읽기 (Windows 파일 락 회피) ─────────────────────────────────
function safeRead(fp) {
  if (!fs.existsSync(fp)) return null;
  for (let i = 0; i < 3; i++) {
    try { return fs.readFileSync(fp, 'utf8'); }
    catch (e) {
      if (e.code === 'EBUSY' || e.code === 'EPERM') {
        // 팀장이 쓰는 중 — 50ms 후 재시도
        const until = Date.now() + 50;
        while (Date.now() < until) {}
        continue;
      }
      return null;
    }
  }
  return null;
}

// ── timing.csv 읽기 ──────────────────────────────────────────────────────
function readTimingMap() {
  const raw = safeRead(TIMING_FILE);
  if (!raw) return {};
  const lines = raw.trim().split('\n');
  const map = {};
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < 6) continue;
    const feature = (cols[1] || '').trim();
    const startStr = (cols[4] || '').trim();
    const endStr   = (cols[5] || '').trim();
    if (!feature || !startStr || !endStr) continue;
    const start = new Date(startStr);
    const end   = new Date(endStr);
    if (isNaN(start) || isNaN(end)) continue;
    if (!map[feature]) {
      map[feature] = { startTime: start, endTime: end };
    } else {
      if (start < map[feature].startTime) map[feature].startTime = start;
      if (end   > map[feature].endTime)   map[feature].endTime   = end;
    }
  }
  for (const f of Object.keys(map)) {
    map[f].duration = map[f].endTime.getTime() - map[f].startTime.getTime();
  }
  return map;
}

// ── 에이전트 상태 파일 읽기 ────────────────────────────────────────────────
function readAgentStatus() {
  const agents = [
    { file: 'tc-designer-v2.txt',    label: '설계' },
    { file: 'tc-설계검수-v2.txt',    label: '설계검수' },
    { file: 'tc-writer-v2.txt',      label: '작성' },
    { file: 'qa-reviewer-v2.txt',    label: '리뷰/검증' },
    { file: 'tc-fixer-v2.txt',       label: '수정' },
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

// ── 진행률 바 렌더링 ──────────────────────────────────────────────────────
function progressBar(current, total, width = 10) {
  if (total <= 0) return '░'.repeat(width);
  const filled = Math.round((current / total) * width);
  return '▓'.repeat(filled) + '░'.repeat(width - filled);
}

// ── 이전 출력 줄 지우기 ───────────────────────────────────────────────────
let prevLineCount = 0;
function clearPrevOutput() {
  if (prevLineCount > 0) {
    readline.moveCursor(process.stdout, 0, -prevLineCount);
    readline.clearScreenDown(process.stdout);
  }
}

// ── ANSI 색상 ──────────────────────────────────────────────────────────────
const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  cyan:   '\x1b[96m',
  green:  '\x1b[92m',
  yellow: '\x1b[93m',
  white:  '\x1b[97m',
  gray:   '\x1b[37m',
  red:    '\x1b[91m',
  magenta:'\x1b[95m',
};

// ── 메인 렌더링 ────────────────────────────────────────────────────────────
function render() {
  const stateRaw = safeRead(STATE_FILE);
  if (!stateRaw) {
    clearPrevOutput();
    process.stdout.write('\n  [파이프라인 없음]  state.json 파일을 찾을 수 없습니다.\n\n');
    return;
  }

  let raw;
  try { raw = JSON.parse(stateRaw); }
  catch {
    // 팀장이 쓰는 중간 상태일 수 있음 — 이번 tick은 skip
    return;
  }
  const specs = (raw.specs || []).filter(s => s && typeof s.feature === 'string');
  const historyRaw = safeRead(HISTORY_FILE);
  let history = {};
  if (historyRaw) { try { history = JSON.parse(historyRaw); } catch {} }

  let historyUpdated = false;
  for (const spec of specs) {
    if (!history[spec.feature] && spec.state !== 'done' && spec.state !== 'failed') {
      const now = new Date();
      history[spec.feature] = [{ "state": "pending", "entered_at": now.toISOString().slice(0, 19) }];
      historyUpdated = true;
    }
  }
  if (historyUpdated) {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
  }

  const timingMap = readTimingMap();
  const currentBatch = raw.currentBatch || null;

  // ── 배치 진행률 & 비용 집계 ────────────────────────────────────────────
  const batchFeatures = (currentBatch && currentBatch.length > 0
    ? currentBatch
    : specs.map(s => s.feature)
  ).filter(f => f && typeof f === 'string');
  const batchTotal = batchFeatures.length;
  let batchDone = 0, batchFailed = 0;
  const failedFeatures = [];
  for (const f of batchFeatures) {
    const s = specs.find(x => x.feature === f);
    if (s) {
      if (s.state === 'done') batchDone++;
      if (s.state === 'failed') { batchFailed++; failedFeatures.push(f); }
    }
  }

  // ── 각 행에 기능 배치 (상태 마커 + 경과시간 포함) ───────────────────────
  const rows = {};
  const done  = [];
  const failed = [];
  const stats = [];

  for (const r of ROWS) rows[r.key] = [];

  for (const spec of specs) {
    if (!spec.feature) continue;
    const rowKey = getRow(spec);
    const name = spec.feature.replace(/_/g, ' ');

    let statInfo = null;
    const timing = timingMap[spec.feature];
    if (timing && timing.duration > 0) {
      statInfo = {
        duration: timing.duration,
        ongoing: spec.state !== 'done' && spec.state !== 'failed',
        startTime: timing.startTime.toISOString(),
        endTime: (spec.state === 'done' || spec.state === 'failed') ? timing.endTime.toISOString() : null
      };
    } else if ((spec.state === 'done' || spec.state === 'failed') && history[spec.feature]) {
      const timeline = history[spec.feature];
      if (timeline.length > 1) {
        const startTime = new Date(timeline[0].entered_at);
        const endTime = new Date(timeline[timeline.length - 1].entered_at);
        statInfo = {
          duration: endTime.getTime() - startTime.getTime(),
          ongoing: false,
          startTime: timeline[0].entered_at,
          endTime: timeline[timeline.length - 1].entered_at
        };
      }
    } else {
      statInfo = getStateDuration(spec.feature, history, spec.state);
    }

    const inBatch = !currentBatch || currentBatch.includes(spec.feature);
    if ((rowKey === 'done' || rowKey === 'failed') && !inBatch) continue;

    if (statInfo && (statInfo.duration > 0 || statInfo.ongoing)) {
      const dur = formatDuration(statInfo.duration);
      const startTime = formatTime(statInfo.startTime);
      let timeRange;
      if (statInfo.endTime) {
        const endTime = formatTime(statInfo.endTime);
        timeRange = `${startTime}-${endTime}`;
      } else {
        timeRange = `${startTime}-현재`;
      }

      let marker, color;
      if (spec.state === 'done') { marker = '✓'; color = C.green; }
      else if (spec.state === 'failed') { marker = '✗'; color = C.red; }
      else if (statInfo.ongoing) { marker = '▶'; color = C.yellow; }
      else { marker = ' '; color = C.white; }

      const featureName = (spec.feature || '').replace(/_/g, ' ');
      const tcCount = readTcCount(spec.feature);
      const tcStr = tcCount ? `, TC ${tcCount}개` : '';
      stats.push({
        marker, color,
        text: `${marker} ${featureName}: ${timeRange} (${dur}${tcStr})`,
        state: spec.state
      });
    }

    if (rowKey === 'done') { done.push(name); continue; }
    if (rowKey === 'failed') { failed.push(name); continue; }

    // 진행중 행에 경과시간 주석 추가
    let rowLabel = name;
    if (statInfo && statInfo.ongoing) {
      const dur = formatDuration(statInfo.duration);
      rowLabel = `▶ ${name} (${dur})`;
    }
    rows[rowKey].push(rowLabel);
  }

  // ── 출력 ─────────────────────────────────────────────────────────────────
  const now = new Date().toLocaleTimeString('ko-KR', { hour12: false });
  const W = 52;
  const lines = [];
  const SEP = '─────────────────────────────────────────────────';

  lines.push('');
  lines.push(`${C.bold}${C.cyan}━━━ TC 팀 v2 에이전트 모니터  (${now}) ━━━${C.reset}`);

  // 상단 헤더: 배치 진행률
  if (batchTotal > 0) {
    const bar = progressBar(batchDone, batchTotal);
    const barColor = batchDone === batchTotal ? C.green : C.cyan;
    lines.push(` ${barColor}배치 ${bar} ${batchDone}/${batchTotal}${C.reset}`);
    lines.push(`${C.gray}${SEP}${C.reset}`);
  }

  // 매트릭스 본체
  for (const r of ROWS) {
    const items = rows[r.key];
    if (items.length === 0) {
      lines.push(`${C.white} ${r.label} ${C.gray}│${C.reset}`);
    } else {
      items.forEach((name, i) => {
        const truncated = name.length > W ? name.slice(0, W - 1) + '…' : name;
        const color = name.startsWith('▶') ? C.yellow : C.white;
        if (i === 0) {
          lines.push(`${C.white} ${r.label} ${C.gray}│ ${color}${truncated}${C.reset}`);
        } else {
          lines.push(`${C.gray}       │ ${color}${truncated}${C.reset}`);
        }
      });
    }
  }

  // 완료/실패 섹션
  if (stats.length) {
    lines.push(`${C.gray}${SEP}${C.reset}`);
    lines.push(`${C.white} 완료   ${C.gray}│${C.reset}`);
    stats.forEach(s => {
      lines.push(`${C.gray}       │${s.color} ${s.text}${C.reset}`);
    });
  } else if (done.length || failed.length) {
    lines.push(`${C.gray}${SEP}${C.reset}`);
    lines.push(`${C.white} 완료   ${C.gray}│${C.reset}`);
    done.forEach(name => {
      lines.push(`${C.gray}       │${C.green} ✓ ${name}${C.reset}`);
    });
    failed.forEach(name => {
      lines.push(`${C.gray}       │${C.red} ✗ ${name}${C.reset}`);
    });
  }

  // 팀원 상태
  const agentStatus = readAgentStatus();
  if (agentStatus.length) {
    lines.push(`${C.gray}${SEP}${C.reset}`);
    lines.push(`${C.white} 팀원   ${C.gray}│${C.cyan} ${agentStatus.join(`  ${C.gray}│${C.cyan}  `)}${C.reset}`);
  }

  // 실패 재실행 템플릿
  if (failedFeatures.length > 0) {
    lines.push(`${C.gray}${SEP}${C.reset}`);
    lines.push(`${C.red} ⚠️  실패 기능 재실행 템플릿:${C.reset}`);
    lines.push(`${C.yellow}    /tc-team <시트 URL> ${failedFeatures.map(f => `<${f} URL>`).join(' ')}${C.reset}`);
  }

  lines.push('');

  clearPrevOutput();
  process.stdout.write(lines.join('\n') + '\n');
  prevLineCount = lines.length;
}

// ── 실행 ──────────────────────────────────────────────────────────────────
const watchMode = process.argv.includes('--watch');
render();
if (watchMode) setInterval(render, 5000);
