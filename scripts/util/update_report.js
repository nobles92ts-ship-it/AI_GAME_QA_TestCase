/**
 * QA 리포트 최신화 스크립트
 * 1. 스프레드시트에서 최신 데이터 읽기
 * 2. HTML 리포트 생성
 * 3. Vercel 배포 (토큰 필요)
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── CLI 파라미터 파싱 (--config qa_config_6차.json) ──
function parseArgs() {
  const args = process.argv.slice(2);
  const idx = args.indexOf('--config');
  if (idx !== -1 && args[idx + 1]) {
    const configPath = path.resolve(__dirname, args[idx + 1]);
    if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  }
  return null;
}
const milestoneConfig = parseArgs();
const configArg = process.argv.includes('--config')
  ? `--config ${process.argv[process.argv.indexOf('--config') + 1]}`
  : '';

const STATUS_FILE = path.join(__dirname, milestoneConfig?.statusFile || 'qa_status.json');
const HTML_TEMPLATE = milestoneConfig?.htmlTemplate
  || path.join(__dirname, '..', '..', '..', 'QA_결과서', 'QA_테스트_결과서_20260317.html');
const DEPLOY_DIR = milestoneConfig?.deployDir || 'C:/work/qa-report-deploy';
const MILESTONE = milestoneConfig?.milestone || '';
const VERCEL_SCOPE = milestoneConfig?.vercelScope || 'nobles92ts-7686s-projects';

// ── 1. 최신 데이터 가져오기 ──
console.log('[1/3] 스프레드시트에서 데이터 수집 중...');
try {
  execSync(`node fetch_qa_status.js ${configArg}`.trim(), { cwd: __dirname, stdio: 'inherit' });
} catch (e) {
  console.error('데이터 수집 실패:', e.message);
  process.exit(1);
}

if (!fs.existsSync(STATUS_FILE)) {
  console.error('qa_status.json 파일이 없습니다');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8'));
const { summary, sheets, jira } = data;
const today = new Date().toISOString().slice(0, 10).replace(/-/g, '.');
const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
const dayName = dayNames[new Date().getDay()];

// FAIL 상세 수집
const allFails = [];
for (const s of sheets) {
  for (const f of (s.fails || [])) {
    allFails.push({ sheet: s.name, ...f });
  }
}

// FAIL 기능별 카운트
const failBySheet = {};
for (const f of allFails) {
  failBySheet[f.sheet] = (failBySheet[f.sheet] || 0) + 1;
}
const failSheetEntries = Object.entries(failBySheet).sort((a, b) => b[1] - a[1]);

// ── 2. HTML 생성 ──
console.log('[2/3] HTML 리포트 생성 중...');

// 기능별 테이블 행
const featRows = sheets.map(s => {
  const target = s.total - s.pc.NA;
  const done = s.pc.PASS + s.pc.FAIL + s.pc.BLOCK;
  const rate = target > 0 ? (done / target * 100) : 0;
  return { ...s, target, done, rate };
});

// Jira 링크 생성 헬퍼
function jiraLinks(bug) {
  if (!bug || bug === '-') return '<span style="color:var(--text3)">-</span>';
  const bugs = (bug.match(/버그ID-\d+/g) || []);
  if (bugs.length === 0) return '<span style="color:var(--text3)">-</span>';
  return bugs.map(b =>
    `<a class="jira-link" href="https://YOUR_SITE.atlassian.net/browse/${b}" target="_blank">${b}</a>`
  ).join(', ');
}

// FAIL 요약 카드 HTML (총 FAIL 건수 + 스프린트 기반 버그)
const bugCard = jira
  ? `<div class="fail-sum-card"><div class="fail-sum-num">${jira.total}</div><div class="fail-sum-label">등록된 버그</div><div class="fail-sum-sub">해결 ${jira.resolved} / 미해결 ${jira.open}</div></div>`
  : `<div class="fail-sum-card"><div class="fail-sum-num">-</div><div class="fail-sum-label">등록된 버그</div></div>`;
const failSummaryCards = `<div class="fail-sum-card"><div class="fail-sum-num">${allFails.length}</div><div class="fail-sum-label">총 FAIL 건수</div></div>${bugCard}`;

// 종합 소견 생성
const completedFeats = featRows.filter(f => f.rate === 100).map(f => f.name);
const pendingFeats = featRows.filter(f => f.rate === 0).map(f => f.name);

// HTML 템플릿 읽기 & 데이터 주입
let html = fs.readFileSync(HTML_TEMPLATE, 'utf-8');

// JS data 블록 교체 - sheets 배열
const sheetsJS = JSON.stringify(sheets.map(s => ({
  name: s.name,
  total: s.total,
  pc: { PASS: s.pc.PASS, FAIL: s.pc.FAIL, BLOCK: s.pc.BLOCK, pending: s.pc.pending, NA: s.pc.NA },
  mob: { PASS: s.mob.PASS, FAIL: s.mob.FAIL, BLOCK: s.mob.BLOCK, pending: s.mob.pending, NA: s.mob.NA },
})));

const failsJS = JSON.stringify(allFails.map(f => ({
  sheet: f.sheet,
  id: f.id,
  repro: f.repro || '',
  title: f.title || '',
  step: f.step,
  bug: f.bug || '-',
})));

// Hero 서브타이틀 업데이트 (마일스톤명 자동 반영)
if (MILESTONE) {
  html = html.replace(
    /개발 QA - TC \([^)]+마일스톤 통합 TC\)/,
    `개발 QA - TC (${MILESTONE} 마일스톤 통합 TC)`
  );
}

// Hero 메타 업데이트
html = html.replace(/20\d\d\.\d\d\.\d\d/g, today);
html = html.replace(/20\d\d-\d\d-\d\d/g, today.replace(/\./g, '-'));
html = html.replace(/\d+개 기능/g, `${sheets.length}개 기능`);
html = html.replace(/(<div class="hero-meta-value">)\d+건(<\/div>)/, `$1${summary.pcTarget}건$2`);

// KPI 카드 업데이트
html = html.replace(/<div class="kpi-card pass[^]*?<div class="kpi-number">(\d+)<\/div>/,
  `<div class="kpi-card pass animate-in delay-1">\n      <div class="kpi-number">${summary.pc.PASS}</div>`);
html = html.replace(/<div class="kpi-card fail[^]*?<div class="kpi-number">(\d+)<\/div>/,
  `<div class="kpi-card fail animate-in delay-2">\n      <div class="kpi-number">${summary.pc.FAIL}</div>`);
html = html.replace(/<div class="kpi-card block[^]*?<div class="kpi-number">(\d+)<\/div>/,
  `<div class="kpi-card block animate-in delay-3">\n      <div class="kpi-number">${summary.pc.BLOCK}</div>`);
html = html.replace(/<div class="kpi-card pending[^]*?<div class="kpi-number">(\d+)<\/div>/,
  `<div class="kpi-card pending animate-in delay-4">\n      <div class="kpi-number">${summary.pc.pending}</div>`);

// 등록된 버그 카드 업데이트 (5번째 KPI)
if (jira) {
  html = html.replace(
    /(<div class="kpi-label">등록된 버그<\/div>\s*<div style="[^"]*">해결 )\d+( \/ 미해결 )\d+(<\/div>)/,
    `$1${jira.resolved}$2${jira.open}$3`
  );
  html = html.replace(
    /(<div class="kpi-card[^"]*"[^>]*style="border-top:3px solid var\(--fail\)">\s*<div class="kpi-number"[^>]*>)\d+(<\/div>)/,
    `$1${jira.total}$2`
  );
}

// JS data 블록 교체
html = html.replace(/const sheets = \[[\s\S]*?\];/, `const sheets = ${sheetsJS};`);
html = html.replace(/const fails = \[[\s\S]*?\];/, `const fails = ${failsJS};`);


// fail-summary 섹션 제거됨 — 교체 불필요

// 도넛 차트 + 범례 테이블 전체 교체 (대시보드 summary 기준)
{
  const mob = summary.mob || { PASS: 0, FAIL: 0, BLOCK: 0, pending: 0, NA: 0 };
  const pcTotal = summary.pc.PASS + summary.pc.FAIL + summary.pc.BLOCK + summary.pc.pending + summary.pc.NA;
  const C = 2 * Math.PI * 70; // ≈ 439.82
  const arc = (n) => pcTotal > 0 ? (n / pcTotal) * C : 0;

  const naArc      = arc(summary.pc.NA);
  const pendingArc = arc(summary.pc.pending);
  const passArc    = arc(summary.pc.PASS);
  const failArc    = arc(summary.pc.FAIL);
  const blockArc   = arc(summary.pc.BLOCK);

  const seg = (stroke, a, offset) =>
    `<circle cx="90" cy="90" r="70" fill="none" stroke="${stroke}" stroke-width="24" ` +
    `stroke-dasharray="${a.toFixed(2)} ${(C - a).toFixed(2)}" stroke-dashoffset="-${offset.toFixed(2)}" ` +
    `transform="rotate(-90 90 90)"/>`;

  const fmt = (n) => Number(n).toLocaleString('ko-KR');
  const row = (label, color, pc, m) =>
    `<tr><td><span class="legend-dot" style="background:${color}"></span>${label}</td>` +
    `<td>${fmt(pc)}</td><td>${fmt(m)}</td><td>${fmt(pc + m)}</td></tr>`;

  const chartHtml = `<div class="chart-row">
    <div class="donut-wrap">
      <svg width="180" height="180" viewBox="0 0 180 180">
        <circle cx="90" cy="90" r="70" fill="none" stroke="#1F2937" stroke-width="24"/>
        ${seg('#4B5563', naArc, 0)}
        ${seg('#6B7280', pendingArc, naArc)}
        ${seg('#10B981', passArc, naArc + pendingArc)}
        ${seg('#EF4444', failArc, naArc + pendingArc + passArc)}
        ${seg('#F59E0B', blockArc, naArc + pendingArc + passArc + failArc)}
        <circle cx="90" cy="90" r="52" fill="#111827"/>
        <text x="90" y="86" text-anchor="middle" fill="white" font-size="22" font-weight="800" font-family="Inter">${summary.pcRate}%</text>
        <text x="90" y="104" text-anchor="middle" fill="#6B7280" font-size="11" font-family="Inter">진행률</text>
      </svg>
    </div>
    <table class="legend-table">
      <thead><tr><th>상태</th><th>PC</th><th>모바일</th><th>합계</th></tr></thead>
      <tbody>
        ${row('PASS',  'var(--pass)',    summary.pc.PASS,    mob.PASS)}
        ${row('FAIL',  'var(--fail)',    summary.pc.FAIL,    mob.FAIL)}
        ${row('BLOCK', 'var(--block)',   summary.pc.BLOCK,   mob.BLOCK)}
        ${row('미진행', 'var(--pending)', summary.pc.pending, mob.pending)}
        ${row('N/A',   'var(--na)',      summary.pc.NA,      mob.NA)}
      </tbody>
    </table>
  </div>`;

  const openTag = '<div class="chart-row">';
  const start = html.indexOf(openTag);
  if (start !== -1) {
    let depth = 1, pos = start + openTag.length;
    while (pos < html.length && depth > 0) {
      const no = html.indexOf('<div', pos);
      const nc = html.indexOf('</div>', pos);
      if (nc === -1) break;
      if (no !== -1 && no < nc) { depth++; pos = no + 4; }
      else { depth--; pos = nc + 6; }
    }
    html = html.slice(0, start) + chartHtml + html.slice(pos);
  }
}

// 종합 소견 섹션 제거됨 — 교체 불필요

// 우선순위 카드 업데이트
if (jira?.priority) {
  const p = jira.priority;
  const cards = [
    { cls: 'p-critical', val: p.critical },
    { cls: 'p-high',     val: p.high },
    { cls: 'p-medium',   val: p.medium },
    { cls: 'p-low',      val: p.low },
    { cls: 'p-lowest',   val: p.lowest },
  ];
  for (const { cls, val } of cards) {
    const hasRemain = val > 0 ? ' has-remain' : '';
    html = html.replace(
      new RegExp(`(<div class="priority-card ${cls}">[\\s\\S]*?<div class="priority-num)[^"]*(">[\\s\\S]*?<\\/div>)`),
      (m, pre, post) => `${pre}${hasRemain}">${val}</div>`
    );
  }
}

// QA 의견 섹션 삽입 (전체 현황 요약 ↔ 기능별 상세 현황 사이)
const opinionPath = path.join(__dirname, 'qa_opinion.txt');
if (fs.existsSync(opinionPath)) {
  const rawOpinion = fs.readFileSync(opinionPath, 'utf-8').trim();
  if (rawOpinion) {
    const escaped = rawOpinion
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const opinionHtml = `<div class="section animate-in">
  <div class="section-header">
    <div class="section-bar" style="background:#3b82f6"></div>
    <h2 class="section-title">QA 의견</h2>
  </div>
  <div style="padding:16px 20px;background:#0f172a;border-radius:6px;color:#cbd5e1;font-size:13px;line-height:1.8;white-space:pre-wrap;">${escaped}</div>
</div>\n`;
    html = html.replace(
      /(<div class="section animate-in">\s*<div class="section-header">\s*<div class="section-bar"><\/div>\s*<h2 class="section-title">기능별 상세 현황<\/h2>)/,
      (m) => opinionHtml + m
    );
  }
}

// 푸터 날짜
html = html.replace(/QA Team[^<]*/, `QA Team &nbsp;|&nbsp; ${today}`);

// 저장: config.htmlTemplate 위치(dirname) 기준, 없으면 fallback
const outputName = `QA_테스트_결과서_${today.replace(/\./g, '')}.html`;
const outputDir = milestoneConfig?.htmlTemplate
  ? path.dirname(milestoneConfig.htmlTemplate)
  : 'C:/work/QA_결과서';
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
const outputPath = path.join(outputDir, outputName);
fs.writeFileSync(outputPath, html, 'utf-8');

// deploy 폴더에 마일스톤 서브디렉토리로 복사
const milestoneDir = MILESTONE ? path.join(DEPLOY_DIR, MILESTONE) : DEPLOY_DIR;
if (!fs.existsSync(milestoneDir)) fs.mkdirSync(milestoneDir, { recursive: true });
fs.copyFileSync(outputPath, path.join(milestoneDir, 'index.html'));

console.log(`HTML 생성 완료: ${outputPath}`);

// ── 3. Vercel 배포 ──
// --config 플래그 이후 값을 제외한 나머지 인자 중 첫 번째를 토큰으로 사용
const _configIdx = process.argv.indexOf('--config');
const _skipIdx = _configIdx !== -1 ? _configIdx + 1 : -1;
const tokenArg = process.argv.slice(2).find((a, i) => {
  const absIdx = i + 2;
  return !a.startsWith('--') && absIdx !== _skipIdx && !a.endsWith('.json');
});
if (tokenArg) {
  console.log('[3/3] Vercel 배포 중...');
  try {
    const result = execSync(
      `vercel deploy --prod --yes --token ${tokenArg} --scope ${VERCEL_SCOPE}`,
      { cwd: DEPLOY_DIR, encoding: 'utf-8' }
    );
    console.log('배포 완료!');
    console.log(result);
  } catch (e) {
    console.error('배포 실패:', e.message);
  }
} else {
  console.log('[3/3] 토큰 없음 — HTML만 생성 (배포 생략)');
  console.log('배포하려면: node update_report.js <VERCEL_TOKEN>');
}

console.log('DONE');
