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

// Jira 스프린트 기반 이슈 조회
async function fetchSprintIssues(sprintName) {
  if (!fs.existsSync(JIRA_CONFIG_FILE)) return null;
  const cfg = JSON.parse(fs.readFileSync(JIRA_CONFIG_FILE, 'utf-8'));
  if (!cfg.email || !cfg.token || cfg.token === 'your-atlassian-api-token') return null;

  const jql = `project = DXBUG AND sprint = "${sprintName}" ORDER BY created DESC`;
  const body = JSON.stringify({ jql, fields: ['status', 'summary'], maxResults: 500 });
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
          resolve({ total, resolved, open: total - resolved });
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.write(body);
    req.end();
  });
}

const SPREADSHEET_ID = process.env.MASTER_SPREADSHEET_ID || 'your_spreadsheet_id';
const OUTPUT_PATH = path.join(__dirname, '..', 'qa_status.json');

// 대시보드, 템플릿 등 제외할 시트명
const EXCLUDE = ['대시보드', '템플릿', 'Template', 'Sheet1',
  '범위_발사체', 'Boss_0011+-'];

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

  // 2. 각 탭 데이터 읽기
  for (const tab of tabNames) {
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${tab}'!A:J`,
      });
      const rows = res.data.values || [];
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
            bug: ((row[9] || '').match(/DXBUG-\d+/g) || []).join(', ') || '-',
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

  const pcTarget = totalTC - totalNA;
  const pcDone = totalPass + totalFail + totalBlock;
  const pcRate = pcTarget > 0 ? (pcDone / pcTarget * 100) : 0;

  result.summary = {
    totalTC,
    pc: { PASS: totalPass, FAIL: totalFail, BLOCK: totalBlock, pending: totalPending, NA: totalNA },
    pcTarget,
    pcDone,
    pcRate: Math.round(pcRate * 10) / 10,
    naText: `N/A(플랫폼 미해당) ${totalNA}건 제외`,
  };

  // Jira 스프린트 기반 버그 집계
  const sprintResult = await fetchSprintIssues('(DX Bug) 5차 스프린트');
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
