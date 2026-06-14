/**
 * QA 현황을 Slack 채널에 전송
 *
 * 사용법: node send_slack_qa.js --config qa_config_6차.json
 * 토큰: slack_config.json 또는 환경변수 SLACK_BOT_TOKEN
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');
const { getColorKey, SLACK_EMOJI } = require('./color_rules');

// ── CLI 파라미터 파싱 ──
function parseArgs() {
  const args = process.argv.slice(2);
  const idx = args.indexOf('--config');
  if (idx !== -1 && args[idx + 1]) {
    const configPath = path.resolve(__dirname, args[idx + 1]);
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
    console.error(`config 파일을 찾을 수 없습니다: ${configPath}`);
    process.exit(1);
  }
  // config 미지정 시 기본값 (하위 호환)
  return {
    milestone: '5차',
    tcSheetUrl: 'https://docs.google.com/spreadsheets/d/YOUR_SPREADSHEET_ID/edit',
    reportUrl: 'https://qa-report-deploy-phi.vercel.app/5차/',
    statusFile: 'qa_status_5차.json',
    slackChannel: 'YOUR_SLACK_CHANNEL_ID',
  };
}

const CONFIG = parseArgs();
const STATUS_FILE = path.join(__dirname, CONFIG.statusFile || 'qa_status.json');
const CONFIG_FILE = path.join(__dirname, 'slack_config.json');

// ── Slack 토큰 로드 ──
function getToken() {
  if (process.env.SLACK_BOT_TOKEN) return process.env.SLACK_BOT_TOKEN;
  if (fs.existsSync(CONFIG_FILE)) {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')).token;
  }
  return null;
}

// ── Slack API 전송 ──
function postSlack(token, channel, blocks, text) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ channel, blocks, text });
    const opts = {
      hostname: 'slack.com',
      path: '/api/chat.postMessage',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': `Bearer ${token}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        const r = JSON.parse(data);
        if (r.ok) resolve(r);
        else reject(new Error(`Slack API 오류: ${r.error}`));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── 메시지 빌드 ──
function buildMessage(data) {
  const { summary, sheets, jira } = data;
  const milestone = CONFIG.milestone || '';
  const tcSheetUrl = CONFIG.tcSheetUrl || '';
  const reportUrl = CONFIG.reportUrl || '';

  const today = new Date().toISOString().slice(0, 10);
  const dayName = ['일', '월', '화', '수', '목', '금', '토'][new Date().getDay()];
  const divLine = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━';

  // 기능별 진행률 (색상 규칙은 color_rules.js SSoT)
  const featLines = (sheets || []).map(s => {
    const target = s.total - s.pc.NA;
    const completed = s.pc.PASS + s.pc.BLOCK;
    const failed = s.pc.FAIL;
    const pending = s.pc.pending;
    const done = completed + failed;
    const rate = target > 0 ? Math.round(done / target * 100) : 0;
    // tab_manager.gs의 getTabColor와 동일 로직 (N/A 제외 카운트 기준)
    const colorKey = getColorKey({ pending, failed, completed });
    const bar = SLACK_EMOJI[colorKey];
    const failMark = failed > 0 ? ` (FAIL ${failed})` : '';
    return `${bar} ${s.name}: ${rate}%${failMark}`;
  }).join('\n');

  // FAIL 상세
  const allFails = [];
  for (const s of (sheets || [])) {
    for (const f of (s.fails || [])) allFails.push({ sheet: s.name, ...f });
  }
  const failBySheet = {};
  for (const f of allFails) failBySheet[f.sheet] = (failBySheet[f.sheet] || 0) + 1;

  const blocks = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*📊 QA 현황 리포트 — ${milestone} 마일스톤 | ${today} (${dayName})*` },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `✅ PASS  *${summary.pc.PASS}*　　❌ FAIL  *${summary.pc.FAIL}*　　🚧 BLOCK  *${summary.pc.BLOCK}*　　⏳ 미진행  *${summary.pc.pending}*　　🚫 N/A  *${summary.pc.NA}*`,
      },
    },
    (() => {
      const doneIncNA = summary.pcDone + summary.pc.NA;
      const totalAll = summary.totalTC;
      const rateIncNA = totalAll > 0 ? Math.round(doneIncNA / totalAll * 1000) / 10 : 0;
      return {
        type: 'section',
        text: { type: 'mrkdwn', text: `*PC 진행률:* ${rateIncNA}% (${doneIncNA}/${totalAll}건, N/A 포함)` },
      };
    })(),
    { type: 'section', text: { type: 'mrkdwn', text: divLine } },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*기능별 현황*\n${featLines || '-'}` },
    },
    { type: 'section', text: { type: 'mrkdwn', text: divLine } },
  ];

  // FAIL / 버그 현황
  const failLine = allFails.length > 0 ? `*🐛 FAIL 현황 (${allFails.length}건)*` : `*🐛 FAIL 현황 (0건)*`;
  const bugLine = jira
    ? `등록된 버그 *${jira.total}건* — 해결 ${jira.resolved} / 미해결 ${jira.open}`
    : `등록된 버그 *-*`;
  const failSummary = allFails.length > 0
    ? '\n' + Object.entries(failBySheet).map(([name, cnt]) => `• ${name}: ${cnt}건`).join('\n')
    : '';

  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: `${failLine}　　${bugLine}${failSummary}` },
  });

  // 링크 (config 기반)
  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: divLine } });
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `📋 <${reportUrl}|${milestone} 웹 리포트 보기>　　📊 <${tcSheetUrl}|TC 시트 열기>`,
    },
  });

  blocks.push({
    type: 'context',
    elements: [
      { type: 'mrkdwn', text: `_Generated by QA Dashboard Widget • ${new Date().toLocaleTimeString('ko-KR')}_` },
    ],
  });

  return {
    blocks,
    text: `QA 현황 (${milestone} | ${today}): PASS ${summary.pc.PASS} / FAIL ${summary.pc.FAIL} / 진행률 ${summary.pcRate}%`,
  };
}

// ── 실행 ──
async function main() {
  const token = getToken();
  if (!token) {
    console.error('Slack 토큰이 없습니다.');
    console.error('  1. slack_config.json 생성: { "token": "xoxb-..." }');
    console.error('  2. 또는 환경변수: set SLACK_BOT_TOKEN=xoxb-...');
    process.exit(1);
  }

  // 최신 데이터 수집
  console.log(`[${CONFIG.milestone}] 데이터 수집 중...`);
  const configArg = process.argv.includes('--config')
    ? `--config ${process.argv[process.argv.indexOf('--config') + 1]}`
    : '';
  try {
    execSync(`node fetch_qa_status.js ${configArg}`.trim(), { cwd: __dirname, stdio: 'inherit' });
  } catch (e) {
    console.error('데이터 수집 실패:', e.message);
    process.exit(1);
  }

  if (!fs.existsSync(STATUS_FILE)) {
    console.error(`${STATUS_FILE}이 없습니다`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8'));
  const { blocks, text } = buildMessage(data);

  console.log('Slack 전송 중...');
  await postSlack(token, CONFIG.slackChannel || 'YOUR_SLACK_CHANNEL_ID', blocks, text);
  console.log('전송 완료!');
}

main().catch(e => {
  console.error('오류:', e.message);
  process.exit(1);
});
