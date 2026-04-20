/**
 * trim_empty_rows.js
 * 시트 하단의 빈 행을 정리하고 데이터 마지막 행 이후 10개만 남깁니다.
 *
 * 사용법:
 *   node trim_empty_rows.js <spreadsheetId> <sheetId>
 *
 * 예시:
 *   node trim_empty_rows.js 1-ICt7w5haohb4S1r3cwX7Z8ZY1tnYCQ6Xawysaocl3E 324241698
 */
const { google } = require('googleapis');
const { getAuthClient } = require('./google_auth');

const SPREADSHEET_ID = process.argv[2];
const SHEET_ID = parseInt(process.argv[3], 10);
const SPARE_ROWS = 10;

if (!SPREADSHEET_ID || isNaN(SHEET_ID)) {
    console.error('사용법: node trim_empty_rows.js <spreadsheetId> <sheetId>');
    process.exit(1);
}

async function trimEmptyRows() {
    const auth = await getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });

    // 현재 시트 정보 조회
    const meta = await sheets.spreadsheets.get({
        spreadsheetId: SPREADSHEET_ID,
        fields: 'sheets(properties(sheetId,title,gridProperties))',
    });

    const sheetMeta = meta.data.sheets.find(s => s.properties.sheetId === SHEET_ID);
    if (!sheetMeta) {
        console.error(`sheetId ${SHEET_ID} 를 찾을 수 없습니다.`);
        process.exit(1);
    }

    const title = sheetMeta.properties.title;
    const totalRows = sheetMeta.properties.gridProperties.rowCount;
    console.log(`탭: "${title}" | 전체 행 수: ${totalRows}`);

    // 데이터 읽기 (A열 기준으로 마지막 데이터 행 찾기)
    const dataRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${title}'!A:A`,
    });

    const values = dataRes.data.values || [];
    const lastDataRow = values.length; // 1-indexed
    console.log(`마지막 데이터 행: ${lastDataRow}`);

    const keepUntil = lastDataRow + SPARE_ROWS; // 데이터 + 여유 10행
    const deleteFrom = keepUntil; // 0-indexed startIndex

    if (deleteFrom >= totalRows) {
        console.log(`삭제할 행이 없습니다. (현재 총 행: ${totalRows}, 유지할 행: ${keepUntil})`);
        return;
    }

    const deleteCount = totalRows - deleteFrom;
    console.log(`${deleteFrom + 1}행 ~ ${totalRows}행 삭제 (${deleteCount}행)`);

    await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
            requests: [{
                deleteDimension: {
                    range: {
                        sheetId: SHEET_ID,
                        dimension: 'ROWS',
                        startIndex: deleteFrom,
                        endIndex: totalRows,
                    },
                },
            }],
        },
    });

    console.log(`완료! 총 ${deleteCount}개 빈 행 삭제됨. 최종 행 수: ${keepUntil}`);
}

trimEmptyRows().catch(err => {
    console.error('오류:', err.message);
    process.exit(1);
});
