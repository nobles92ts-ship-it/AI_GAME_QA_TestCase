/**
 * QA 리포트 최신화 스크립트
 * 1. 스프레드시트에서 최신 데이터 읽기
 * 2. HTML 리포트 생성
 * 3. Vercel 배포 (토큰 필요)
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const STATUS_FILE = path.join(__dirname, '..', 'qa_status.json');
const HTML_TEMPLATE = path.join(__dirname, '..', '..', '..', 'QA_테스트_결과서_20260317.html');
const DEPLOY_DIR = '{USER_DOWNLOADS}/qa-report-deploy';
const VERCEL_SCOPE = 'process.env.VERCEL_SCOPE || 'your-vercel-scope'';

// ── 1. 최신 데이터 가져오기 ──
console.log('[1/3] 스프레드시트에서 데이터 수집 중...');
try {
  execSync('node fetch_qa_status.js', { cwd: __dirname, stdio: 'inherit' });
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
  const bugs = (bug.match(/DXBUG-\d+/g) || []);
  if (bugs.length === 0) return '<span style="color:var(--text3)">-</span>';
  return bugs.map(b =>
    `<a class="jira-link" href="https://your-site.atlassian.net/browse/${b}" target="_blank">${b}</a>`
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
  step: f.step,
  bug: f.bug || '-',
})));

// Hero 메타 업데이트
html = html.replace(/20\d\d\.\d\d\.\d\d/g, today);
html = html.replace(/20\d\d-\d\d-\d\d/g, today.replace(/\./g, '-'));
html = html.replace(/\d+개 기능/g, `${sheets.length}개 기능`);
html = html.replace(/(<div class="hero-meta-value">)\d+건(<\/div>)/, `$1${summary.pcTarget}건$2`);
html = html.replace(/(<div class="hero-meta-value"[^>]*>)[\d.]+%(<\/div>)/, `$1${summary.pcRate}%$2`);

// KPI 카드 업데이트
html = html.replace(/<div class="kpi-card pass[^]*?<div class="kpi-number">(\d+)<\/div>/,
  `<div class="kpi-card pass animate-in delay-1">\n      <div class="kpi-number">${summary.pc.PASS}</div>`);
html = html.replace(/<div class="kpi-card fail[^]*?<div class="kpi-number">(\d+)<\/div>/,
  `<div class="kpi-card fail animate-in delay-2">\n      <div class="kpi-number">${summary.pc.FAIL}</div>`);
html = html.replace(/<div class="kpi-card block[^]*?<div class="kpi-number">(\d+)<\/div>/,
  `<div class="kpi-card block animate-in delay-3">\n      <div class="kpi-number">${summary.pc.BLOCK}</div>`);
html = html.replace(/<div class="kpi-card pending[^]*?<div class="kpi-number">(\d+)<\/div>/,
  `<div class="kpi-card pending animate-in delay-4">\n      <div class="kpi-number">${summary.pc.pending}</div>`);

// 진행률
html = html.replace(/style="width:[\d.]+%"/g, `style="width:${summary.pcRate}%"`);
html = html.replace(/<div class="progress-pct">[\d.]+%<\/div>/,
  `<div class="progress-pct">${summary.pcRate}%</div>`);
html = html.replace(/실행 대상 \d+건 중 \d+건 완료[^<]*/,
  `실행 대상 ${summary.pcTarget}건 중 ${summary.pcDone}건 완료 (PASS ${summary.pc.PASS} + FAIL ${summary.pc.FAIL})`);

// JS data 블록 교체
html = html.replace(/const sheets = \[[\s\S]*?\];/, `const sheets = ${sheetsJS};`);
html = html.replace(/const fails = \[[\s\S]*?\];/, `const fails = ${failsJS};`);


// FAIL 요약 카드
html = html.replace(/<div class="fail-summary">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/,
  `<div class="fail-summary">${failSummaryCards}</div>`);

// 도넛 차트 + 범례 데이터 (PC 기준)
const totalMobPending = sheets.reduce((a, s) => a + s.mob.pending, 0);
const totalMobNA = sheets.reduce((a, s) => a + s.mob.NA, 0);
html = html.replace(/<td>194<\/td><td>0<\/td><td>194<\/td>/g,
  `<td>${summary.pc.PASS}</td><td>0</td><td>${summary.pc.PASS}</td>`);
html = html.replace(/<td>23<\/td><td>0<\/td><td>23<\/td>/g,
  `<td>${summary.pc.FAIL}</td><td>0</td><td>${summary.pc.FAIL}</td>`);

// 종합 소견 업데이트
const findings = [
  { bar: 'c-accent', label: 'PC 테스트', desc: completedFeats.length > 0 ? `${completedFeats.length}개 기능 완료 (${completedFeats.join(', ')}) | 진행률 ${summary.pcRate}%` : `진행률 ${summary.pcRate}%` },
  { bar: 'c-pending', label: '모바일 테스트', desc: '전 기능 미진행 (0%) — PC 테스트 완료 후 순차 진행 예정' },
  { bar: 'c-fail', label: 'FAIL 현황', desc: allFails.length > 0 ? `총 ${allFails.length}건 발견` : '발견된 FAIL 없음' },
];

const findingsHtml = findings.map(f =>
  `<div class="finding-card"><div class="finding-bar ${f.bar}"></div><div class="finding-label">${f.label}</div><div class="finding-desc">${f.desc}</div></div>`
).join('\n    ');

// findings 섹션 전체 교체 (중첩 div 깊이 추적)
{
  const openTag = '<div class="findings">';
  const start = html.indexOf(openTag);
  if (start !== -1) {
    let depth = 1;
    let pos = start + openTag.length;
    while (pos < html.length && depth > 0) {
      const nextOpen = html.indexOf('<div', pos);
      const nextClose = html.indexOf('</div>', pos);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        pos = nextOpen + 4;
      } else {
        depth--;
        pos = nextClose + 6;
      }
    }
    // findings div 교체 후, 뒤에 남은 고아 finding-card 제거
    let after = html.slice(pos);
    after = after.replace(/^(\s*<div class="finding-card">[\s\S]*?<\/div>\s*)+/, '');
    html = html.slice(0, start) + `<div class="findings">\n    ${findingsHtml}\n  </div>` + after;
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
html = html.replace(/DEXAR QA Team[^<]*/, `DEXAR QA Team &nbsp;|&nbsp; ${today}`);

// 저장
const outputName = `QA_테스트_결과서_${today.replace(/\./g, '')}.html`;
const outputPath = path.join('{USER_DOWNLOADS}', outputName);
fs.writeFileSync(outputPath, html, 'utf-8');

// deploy 폴더에도 복사
if (!fs.existsSync(DEPLOY_DIR)) fs.mkdirSync(DEPLOY_DIR, { recursive: true });
fs.copyFileSync(outputPath, path.join(DEPLOY_DIR, 'index.html'));

console.log(`HTML 생성 완료: ${outputPath}`);

// ── 3. Vercel 배포 ──
const tokenArg = process.argv[2]; // 토큰을 인자로 받음
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
