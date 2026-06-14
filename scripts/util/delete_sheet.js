const { getAuthClient } = require('./google_auth');
const { google } = require('googleapis');

const SPREADSHEET_ID = process.argv[2];
const SHEET_NAME = process.argv[3];
if (!SPREADSHEET_ID || !SHEET_NAME) {
  console.error('사용법: node delete_sheet.js <스프레드시트ID> <시트명>');
  process.exit(1);
}

(async () => {
  const auth = await getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const target = meta.data.sheets.find(s => s.properties.title === SHEET_NAME);
  if (!target) {
    console.log(`시트 없음: ${SHEET_NAME}`);
    return;
  }
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: [{ deleteSheet: { sheetId: target.properties.sheetId } }] }
  });
  console.log(`삭제 완료: ${SHEET_NAME} (gid=${target.properties.sheetId})`);
})().catch(e => { console.error(e); process.exit(1); });
