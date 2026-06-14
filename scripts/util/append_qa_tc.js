const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { getAuthClient } = require('./google_auth');

const [TAB, SPREADSHEET_ID, JSON_PATH, START_ROW_STR, START_ID_STR] = process.argv.slice(2);
if (!TAB || !SPREADSHEET_ID || !JSON_PATH || !START_ROW_STR || !START_ID_STR) {
  console.error('사용법: node append_qa_tc.js "탭" "시트ID" "json경로" <시작행> <시작ID>');
  process.exit(1);
}

const startRow = parseInt(START_ROW_STR, 10);
const startId = parseInt(START_ID_STR, 10);

async function main() {
  const raw = JSON.parse(fs.readFileSync(path.resolve(JSON_PATH), 'utf8'));
  console.log(`QA 행 로드: ${raw.length}개 (시작 행 ${startRow}, 시작 ID ${String(startId).padStart(3, '0')})`);

  let prevMajor = '', prevMinor = '', prevSub = '';
  const rows = raw.map((r, i) => {
    const [major, minor, sub, verif, platform, step, note = ''] = r;
    const id = String(startId + i).padStart(3, '0');
    const dMajor = major === prevMajor ? '' : major;
    const dMinor = minor === prevMinor && major === prevMajor ? '' : minor;
    const dSub = sub === prevSub && minor === prevMinor && major === prevMajor ? '' : sub;
    prevMajor = major; prevMinor = minor; prevSub = sub;
    let pc = 'N/A', mb = 'N/A';
    if (platform === 'PC' || platform === 'PC/모바일') pc = '미진행';
    if (platform === '모바일' || platform === 'PC/모바일') mb = '미진행';
    return [id, dMajor, dMinor, dSub, verif, step, platform, pc, mb, note, ''];
  });

  const auth = await getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });
  const endRow = startRow + rows.length - 1;
  const range = `'${TAB}'!A${startRow}:K${endRow}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range,
    valueInputOption: 'USER_ENTERED',
    resource: { values: rows }
  });
  console.log(`업로드 완료: ${range} (${rows.length}행)`);
}

main().catch(e => { console.error(e); process.exit(1); });
