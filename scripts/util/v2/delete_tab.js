// v2/delete_tab.js — 스프레드시트 탭 삭제 스크립트
// H-4: tc-팀-v2.md의 인라인 Node.js 코드를 독립 스크립트로 분리
//
// 사용법: node delete_tab.js <SHEET_ID> <탭명>
// 성공: exit 0, 실패: exit 1
'use strict';

const path = require('path');
const { google } = require('googleapis');
const { getAuthClient } = require('../google_auth');

const [, , sheetId, tabName] = process.argv;

if (!sheetId || !tabName) {
  console.error('사용법: node delete_tab.js <SHEET_ID> <탭명>');
  process.exit(1);
}

getAuthClient()
  .then(async (auth) => {
    const sheets = google.sheets({ version: 'v4', auth });

    // 탭 목록 조회
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    const tab = meta.data.sheets.find(
      (s) => s.properties.title === tabName
    );

    if (tab) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        resource: {
          requests: [{ deleteSheet: { sheetId: tab.properties.sheetId } }],
        },
      });
      console.log(`탭 삭제 완료: "${tabName}"`);
    } else {
      console.log(`탭 없음 (건너뜀): "${tabName}"`);
    }
  })
  .catch((e) => {
    console.error(`탭 삭제 실패: ${e.message}`);
    process.exit(1);
  });
