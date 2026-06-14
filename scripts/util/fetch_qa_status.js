/**
 * QA 현황 데이터 페처
 * - TC 스프레드시트에서 각 탭별 PASS/FAIL/BLOCK/미진행/N/A 집계
 * - JSON 파일로 출력 (위젯에서 읽기용)
 */
const { getAuthClient } = require('./google_auth');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const https = require('https');

const JIRA_CONFIG_FILE = path.join(__dirname, 'jira_config.json');

// ── CLI 파라미터 파싱 (--config qa_config_6차.json) ──
function parseArgs() {
  const args = process.argv.slice(2);
  const idx = args.indexOf('--config');
  if (idx !== -1 && args[idx + 1]) {
    const configPath = path.resolve(__dirname, args[idx + 1]);
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  }
  return null;
}

const milestoneConfig = parseArgs();

// Jira 스프린트 기반 이슈 조회
async function fetchSprintIssues(sprintName) {
  if (!fs.existsSync(JIRA_CONFIG_FILE)) return null;
  const cfg = JSON.parse(fs.readFileSync(JIRA_CONFIG_FILE, 'utf-8'));
  if (!cfg.email || !cfg.token || cfg.token === 'your-atlassian-api-token') return null;

  const jql = `project = 버그ID AND sprint = "${sprintName}" ORDER BY created DESC`;
  const body = JSON.stringify({ jql, fields: ['status', 'summary', 'priority'], maxResults: 500 });
  const auth = Buffer.from(`${cfg.email}:${cfg.token}`).toString('base64');
  const baseUrl = new URL(cfg.baseUrl);

  return new Promise((resolve) => {
    const req = https.request({
      hostname: baseUrl.hostname,
      path: '/rest/api/3/search/jql',
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const r = JSON.parse(data);
          const issues = r.issues || [];
          const total = issues.length;
          const resolved = issues.filter(i => i.fields?.status?.statusCategory?.key === 'done').length;
          const open = total - resolved;
          const openIssues = issues.filter(i => i.fields?.status?.statusCategory?.key !== 'done');
          const priorityMap = { '매우 높음': 0, 'Highest': 0, '높음': 0, 'High': 0, '보통': 0, 'Medium': 0, '낮음': 0, 'Low': 0, '매우 낮음': 0, 'Lowest': 0 };
          const priorityKo = { 'Highest': '매우 높음', 'High': '높음', 'Medium': '보통', 'Low': '낮음', 'Lowest': '매우 낮음' };
          for (const i of openIssues) {
            const p = i.fields?.priority?.name || 'Medium';
            const key = priorityKo[p] || p;
            if (key in priorityMap) priorityMap[key]++;
          }
          resolve({
            total, resolved, open,
            priority: {
              critical: priorityMap['매우 높음'],
              high: priorityMap['높음'],
              medium: priorityMap['보통'],
              low: priorityMap['낮음'],
              lowest: priorityMap['매우 낮음'],
            }
          });
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.write(body);
    req.end();
  });
}

const SPREADSHEET_ID = milestoneConfig?.spreadsheetId || 'YOUR_SPREADSHEET_ID';
const STATUS_FILENAME = milestoneConfig?.statusFile || 'qa_status.json';
const OUTPUT_PATH = path.join(__dirname, STATUS_FILENAME);

// 제외할 시트명: config의 excludeTabs 우선, 없으면 기본값 (하위 호환)
const EXCLUDE = milestoneConfig?.excludeTabs || [
  '대시보드', '템플릿', 'Template', 'Sheet1',
  '범위_발사체', '보스 TC run+-',
  '필드_보스_시스템_개선', '즉시_이동_예외_처리', '공격_스킬_시전_이동_속도',
  '사망_및_부활_시스템', '수영_시스템', '빌드_안정성',
];

async function fetchStatus() {
  const auth = await getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });

  // 1. 시트 목록
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const tabNames = meta.data.sheets
    .filter(s => !s.properties.hidden)
    .map(s => s.properties.title)
    .filter(n => !EXCLUDE.includes(n));

  const result = { updated: new Date().toISOString(), sheets: [] };
  let totalPass = 0, totalFail = 0, totalBlock = 0, totalPending = 0, totalNA = 0, totalTC = 0;

  // 2. 모든 탭 데이터를 batchGet 1회 호출로 수집 (Quota 절약)
  // 429(Quota) 시 지수 백오프 재시도
  const ranges = tabNames.map(t => `'${t}'!A:J`);
  async function batchGetWithRetry(maxAttempts = 5) {
    let waitMs = 5000;
    for (let i = 1; i <= maxAttempts; i++) {
      try {
        return await sheets.spreadsheets.values.batchGet({
          spreadsheetId: SPREADSHEET_ID,
          ranges,
        });
      } catch (e) {
        const isQuota = (e.message || '').includes('Quota exceeded') || e.code === 429;
        if (!isQuota || i === maxAttempts) throw e;
        console.error(`[Quota] ${i}/${maxAttempts} 재시도 대기 ${waitMs / 1000}s...`);
        await new Promise(r => setTimeout(r, waitMs));
        waitMs = Math.min(waitMs * 2, 60000);
      }
    }
  }
  const batchRes = await batchGetWithRetry();
  const valueRanges = batchRes.data.valueRanges || [];

  for (let t = 0; t < tabNames.length; t++) {
    const tab = tabNames[t];
    try {
      const rows = valueRanges[t]?.values || [];
      if (rows.length < 2) continue;

      // H열(PC결과), I열(모바일결과) 집계
      const pc = { PASS: 0, FAIL: 0, BLOCK: 0, pending: 0, NA: 0 };
      const mob = { PASS: 0, FAIL: 0, BLOCK: 0, pending: 0, NA: 0 };
      let count = 0;

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row[0]) continue; // TC ID 없으면 skip
        count++;

        const pcVal = (row[7] || '').trim();
        const mobVal = (row[8] || '').trim();

        // PC
        if (pcVal === 'PASS') pc.PASS++;
        else if (pcVal === 'FAIL') pc.FAIL++;
        else if (pcVal === 'BLOCK') pc.BLOCK++;
        else if (pcVal === 'N/A') pc.NA++;
        else pc.pending++;

        // Mobile
        if (mobVal === 'PASS') mob.PASS++;
        else if (mobVal === 'FAIL') mob.FAIL++;
        else if (mobVal === 'BLOCK') mob.BLOCK++;
        else if (mobVal === 'N/A') mob.NA++;
        else mob.pending++;
      }

      // 분류 상속 (빈칸은 이전 행 값 사용)
      let lastB = '', lastC = '', lastD = '';
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row[0]) continue;
        if (row[1]) lastB = row[1]; else row[1] = lastB;
        if (row[2]) lastC = row[2]; else row[2] = lastC;
        if (row[3]) lastD = row[3]; else row[3] = lastD;
      }

      // FAIL 상세 (Jira 이슈 포함)
      const fails = [];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row[0]) continue;
        const pcVal = (row[7] || '').trim();
        if (pcVal === 'FAIL') {
          fails.push({
            id: row[0],
            repro: (row[5] || '').trim(),
            step: (row[4] || '').trim(),
            bug: ((row[9] || '').match(/버그ID-\d+/g) || []).join(', ') || '-',
          });
        }
      }

      result.sheets.push({ name: tab, total: count, pc, mob, fails });
      totalPass += pc.PASS;
      totalFail += pc.FAIL;
      totalBlock += pc.BLOCK;
      totalPending += pc.pending;
      totalNA += pc.NA;
      totalTC += count;
    } catch (e) {
      console.error(`[${tab}] 읽기 실패:`, e.message);
    }
  }

  // 대시보드 탭에서 공식 집계값 직접 읽기 (C5:D9 = PASS/FAIL/BLOCK/미진행/N/A × PC/모바일)
  const dashRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: '대시보드!C5:D9',
  });
  const dashRows = dashRes.data.values || [];
  const toNum = v => parseInt((v || '0').toString().replace(/,/g, ''), 10) || 0;
  const dashPC = {
    PASS:    toNum(dashRows[0]?.[0]),
    FAIL:    toNum(dashRows[1]?.[0]),
    BLOCK:   toNum(dashRows[2]?.[0]),
    pending: toNum(dashRows[3]?.[0]),
    NA:      toNum(dashRows[4]?.[0]),
  };
  const dashMob = {
    PASS:    toNum(dashRows[0]?.[1]),
    FAIL:    toNum(dashRows[1]?.[1]),
    BLOCK:   toNum(dashRows[2]?.[1]),
    pending: toNum(dashRows[3]?.[1]),
    NA:      toNum(dashRows[4]?.[1]),
  };
  const dashPcTotal  = dashPC.PASS + dashPC.FAIL + dashPC.BLOCK + dashPC.pending + dashPC.NA;
  const dashPcTarget = dashPcTotal - dashPC.NA;
  const dashPcDone   = dashPC.PASS + dashPC.FAIL + dashPC.BLOCK;
  const dashPcRate   = dashPcTarget > 0 ? Math.round(dashPcDone / dashPcTarget * 1000) / 10 : 0;

  result.summary = {
    totalTC: dashPcTotal,
    pc: dashPC,
    mob: dashMob,
    pcTarget: dashPcTarget,
    pcDone: dashPcDone,
    pcRate: dashPcRate,
    naText: `N/A(플랫폼 미해당) ${dashPC.NA}건 제외`,
  };

  // Jira 스프린트 기반 버그 집계
  const jiraSprintName = milestoneConfig?.jiraSprintName || '(DX Bug) 5차 스프린트';
  const sprintResult = await fetchSprintIssues(jiraSprintName);
  if (sprintResult) {
    result.jira = sprintResult;
    console.log(`Jira: 총 ${sprintResult.total}종 / resolved ${sprintResult.resolved}종 / open ${sprintResult.open}종`);
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2), 'utf-8');
  console.log(JSON.stringify(result.summary));
}

fetchStatus().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
