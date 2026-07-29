/**
 * 구글 스프레드시트 데이터 읽기
 *
 * 사용법:
 *   node read_gsheet_data.js <spreadsheetId> <sheetName>
 *   node read_gsheet_data.js <spreadsheetId> <sheetName> --range A1:J10
 *   node read_gsheet_data.js <spreadsheetId> <sheetName> --columns A,C,F,G,H   ← 컬럼 화이트리스트
 *   node read_gsheet_data.js <spreadsheetId> <sheetName> --minify              ← 공백 제거 JSON
 *   node read_gsheet_data.js <spreadsheetId> --list                            ← 시트 목록만 출력
 *
 * 출력: JSON (stdout)
 *   { sheetName, totalRows, headers, rows: [[...], ...] }
 *
 * 토큰 절감 가이드:
 *   - 리뷰/검증 단계: --columns A,B,C,D,E,F,G,H,I (K~L 패널 컬럼 제외) → ~15-25% 절감
 *   - 자체 검증(G열): --range G[start]:G[end] → ~95% 절감
 *   - --minify: JSON.stringify 공백 제거 → ~10-15% 추가 절감
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

// 컬럼 문자(A=0, B=1, ..., AA=26)를 인덱스로 변환
function colLetterToIndex(letter) {
    const upper = String(letter).trim().toUpperCase();
    if (!/^[A-Z]+$/.test(upper)) {
        throw new Error(`잘못된 컬럼 문자: ${letter}`);
    }
    let idx = 0;
    for (const ch of upper) {
        idx = idx * 26 + (ch.charCodeAt(0) - 64);
    }
    return idx - 1;
}

async function readSheet(spreadsheetId, sheetName, range, columns, minify) {
    const auth = await getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });

    const rangeParam = range ? `'${sheetName}'!${range}` : `'${sheetName}'`;

    const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: rangeParam,
        valueRenderOption: 'FORMATTED_VALUE',
    });

    const values = res.data.values || [];
    let headers = values[0] || [];
    let rows = values.slice(1);

    // --columns 필터: 명시된 컬럼만 추출 (immutable)
    let columnsApplied = null;
    if (columns && columns.length > 0) {
        const indices = columns.map(colLetterToIndex);
        columnsApplied = columns.map(c => String(c).toUpperCase());
        headers = indices.map(i => headers[i] ?? '');
        rows = rows.map(row => indices.map(i => row[i] ?? ''));
    }

    const result = {
        sheetName,
        range: res.data.range,
        totalRows: rows.length,
        ...(columnsApplied ? { columnsApplied } : {}),
        headers,
        rows,
    };

    process.stdout.write(JSON.stringify(result, null, minify ? 0 : 2));
}

// CLI 파싱
if (require.main !== module) return;

const args = process.argv.slice(2);
const spreadsheetId = args[0];

if (!spreadsheetId) {
    process.stderr.write('사용법:\n');
    process.stderr.write('  node read_gsheet_data.js <spreadsheetId> <sheetName>\n');
    process.stderr.write('  node read_gsheet_data.js <spreadsheetId> <sheetName> --range A1:J10\n');
    process.stderr.write('  node read_gsheet_data.js <spreadsheetId> <sheetName> --columns A,C,F,G,H\n');
    process.stderr.write('  node read_gsheet_data.js <spreadsheetId> <sheetName> --minify\n');
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

    const colsIdx = args.indexOf('--columns');
    const columns = colsIdx !== -1
        ? String(args[colsIdx + 1] || '').split(',').map(s => s.trim()).filter(Boolean)
        : null;

    const minify = args.includes('--minify');

    readSheet(spreadsheetId, sheetName, range, columns, minify).catch(err => {
        process.stderr.write('에러: ' + (err.message || err) + '\n');
        process.exit(1);
    });
}

module.exports = { listSheets, readSheet };
