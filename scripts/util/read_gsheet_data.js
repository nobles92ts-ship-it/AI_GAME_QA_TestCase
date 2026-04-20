/**
 * 구글 스프레드시트 데이터 읽기
 *
 * 사용법:
 *   node read_gsheet_data.js <spreadsheetId> <sheetName>
 *   node read_gsheet_data.js <spreadsheetId> <sheetName> --range A1:J10
 *   node read_gsheet_data.js <spreadsheetId> --list           ← 시트 목록만 출력
 *
 * 출력: JSON (stdout)
 *   { sheetName, totalRows, headers, rows: [[...], ...] }
 */
const { google } = require('googleapis');
const { getAuthClient } = require('./google_auth');

async function listSheets(spreadsheetId) {
    const auth = await getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });

    const res = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties(title,sheetId,gridProperties)',
    });

    const result = (res.data.sheets || []).map(s => ({
        title: s.properties.title,
        sheetId: s.properties.sheetId,
        rowCount: s.properties.gridProperties?.rowCount,
        columnCount: s.properties.gridProperties?.columnCount,
    }));

    process.stdout.write(JSON.stringify(result, null, 2));
}

async function readSheet(spreadsheetId, sheetName, range) {
    const auth = await getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });

    const rangeParam = range ? `'${sheetName}'!${range}` : `'${sheetName}'`;

    const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: rangeParam,
        valueRenderOption: 'FORMATTED_VALUE',
    });

    const values = res.data.values || [];
    const headers = values[0] || [];
    const rows = values.slice(1);

    const result = {
        sheetName,
        range: res.data.range,
        totalRows: rows.length,
        headers,
        rows,
    };

    process.stdout.write(JSON.stringify(result, null, 2));
}

// CLI 파싱
if (require.main !== module) return;

const args = process.argv.slice(2);
const spreadsheetId = args[0];

if (!spreadsheetId) {
    process.stderr.write('사용법:\n');
    process.stderr.write('  node read_gsheet_data.js <spreadsheetId> <sheetName>\n');
    process.stderr.write('  node read_gsheet_data.js <spreadsheetId> <sheetName> --range A1:J10\n');
    process.stderr.write('  node read_gsheet_data.js <spreadsheetId> --list\n');
    process.exit(1);
}

if (args[1] === '--list') {
    listSheets(spreadsheetId).catch(err => {
        process.stderr.write('에러: ' + (err.message || err) + '\n');
        process.exit(1);
    });
} else {
    const sheetName = args[1];
    if (!sheetName) {
        process.stderr.write('시트명을 입력하세요.\n');
        process.exit(1);
    }
    const rangeIdx = args.indexOf('--range');
    const range = rangeIdx !== -1 ? args[rangeIdx + 1] : null;

    readSheet(spreadsheetId, sheetName, range).catch(err => {
        process.stderr.write('에러: ' + (err.message || err) + '\n');
        process.exit(1);
    });
}

module.exports = { listSheets, readSheet };
