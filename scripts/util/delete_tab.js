const { google } = require('googleapis');
const { getAuthClient } = require('./google_auth');

const SHEET_ID = process.argv[2];
const TAB_NAME = process.argv[3];

(async () => {
  const auth = await getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const sheet = meta.data.sheets.find(s => s.properties.title === TAB_NAME);
  if (!sheet) { console.log('탭 없음:', TAB_NAME); process.exit(0); }
  const sheetId = sheet.properties.sheetId;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { requests: [{ deleteSheet: { sheetId } }] }
  });
  console.log('삭제 완료:', TAB_NAME);
})().catch(e => { console.error(e.message); process.exit(1); });
