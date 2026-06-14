/**
 * K~O열 프로젝트 정보 패널 + 미니 결과 대시보드 추가
 *
 * 사용법:
 *   node add_project_info.js <spreadsheetId> <sheetName> <confluenceUrl>
 *
 * K/L열 구조 (1~10행):
 *   K1:L1   "담당자" (헤더, 병합)
 *   K2~K5   "기획"/"서버"/"클라"/"UI"       | L2~L5 (빈칸)
 *   K6      "기획서"                         | L6    Confluence URL
 *   K7      "테스트 환경" (헤더, 병합 없음)  | L7    (빈칸)
 *   K8~K10  "날짜/시간"/"클라이언트"/"서버"  | L8~L10 (빈칸)
 *
 * M~O열 구조 (1~7행) — TC 시트 자체 결과 미니 대시보드:
 *   M1/N1/O1  "구분"/"PC"/"모바일" (헤더)
 *   M2~M6     PASS/FAIL/BLOCK/미진행/N/A   | N/O COUNTIF(H or I, metric)
 *   M7        합계                          | N/O SUMPRODUCT(COUNTIF(...))
 */
const { google } = require('googleapis');
const { getAuthClient } = require('./google_auth');

const LABELS_K = ['담당자', '기획', '서버', '클라', 'UI', '기획서', '테스트 환경', '날짜/시간', '클라이언트', '서버'];
const METRICS = ['PASS', 'FAIL', 'BLOCK', '미진행', 'N/A'];
const PANEL_LABELS_M = ['구분', ...METRICS, '합계'];

const COLOR_HEADER_BG = { red: 0.176, green: 0.251, blue: 0.349 };
const COLOR_WHITE = { red: 1, green: 1, blue: 1 };
const COLOR_BLACK = { red: 0, green: 0, blue: 0 };
const COLOR_LINK = { red: 0.067, green: 0.333, blue: 0.8 };
const COLOR_BORDER_OUTER = { red: 0.7, green: 0.7, blue: 0.7 };
const COLOR_BORDER_INNER = { red: 0.85, green: 0.85, blue: 0.85 };

function headerFmt() {
    return {
        backgroundColor: COLOR_HEADER_BG,
        textFormat: { foregroundColor: COLOR_WHITE, bold: true, fontSize: 10 },
        horizontalAlignment: 'CENTER',
        verticalAlignment: 'MIDDLE',
    };
}
function labelFmt() {
    return {
        backgroundColor: COLOR_WHITE,
        textFormat: { foregroundColor: COLOR_BLACK, bold: true, fontSize: 10 },
        horizontalAlignment: 'CENTER',
        verticalAlignment: 'MIDDLE',
    };
}
function valueFmt() {
    return {
        backgroundColor: COLOR_WHITE,
        horizontalAlignment: 'CENTER',
        verticalAlignment: 'MIDDLE',
    };
}
function linkFmt() {
    return {
        backgroundColor: COLOR_WHITE,
        textFormat: { foregroundColor: COLOR_LINK, fontSize: 10 },
        horizontalAlignment: 'LEFT',
        verticalAlignment: 'MIDDLE',
    };
}
function repeatCell(sheetId, r1, r2, c1, c2, format, fields) {
    return {
        repeatCell: {
            range: { sheetId, startRowIndex: r1, endRowIndex: r2, startColumnIndex: c1, endColumnIndex: c2 },
            cell: { userEnteredFormat: format },
            fields,
        },
    };
}
function borderAll(sheetId, r1, r2, c1, c2) {
    return {
        updateBorders: {
            range: { sheetId, startRowIndex: r1, endRowIndex: r2, startColumnIndex: c1, endColumnIndex: c2 },
            top: { style: 'SOLID', color: COLOR_BORDER_OUTER },
            bottom: { style: 'SOLID', color: COLOR_BORDER_OUTER },
            left: { style: 'SOLID', color: COLOR_BORDER_OUTER },
            right: { style: 'SOLID', color: COLOR_BORDER_OUTER },
            innerHorizontal: { style: 'SOLID', color: COLOR_BORDER_INNER },
            innerVertical: { style: 'SOLID', color: COLOR_BORDER_INNER },
        },
    };
}

async function addProjectInfo(spreadsheetId, sheetName, confluenceUrl) {
    const auth = await getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });

    const sp = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(title,sheetId)' });
    const sheet = sp.data.sheets.find(s => s.properties.title === sheetName);
    if (!sheet) throw new Error(`탭 '${sheetName}'을 찾을 수 없습니다`);
    const sheetId = sheet.properties.sheetId;

    // ─── K/L열 값 (10행) ─────────────────────────────────────────────
    const klValues = [
        ['담당자', ''],
        ['기획', ''],
        ['서버', ''],
        ['클라', ''],
        ['UI', ''],
        ['기획서', confluenceUrl],
        ['테스트 환경', ''],
        ['날짜/시간', ''],
        ['클라이언트', ''],
        ['서버', ''],
    ];
    await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${sheetName}'!K1:L10`,
        valueInputOption: 'RAW',
        requestBody: { values: klValues },
    });

    // ─── M~O열 값 (7행) ──────────────────────────────────────────────
    // 헤더: M1=구분, N1=PC, O1=모바일
    // 데이터: PC=H열 COUNTIF / 모바일=I열 COUNTIF / 합계=SUMPRODUCT
    const countif = (col, metric) => `=COUNTIF(H:H,"${metric}")`.replace('H:H', `${col}:${col}`);
    const sumAll = col =>
        `=SUMPRODUCT(COUNTIF(${col}:${col},{"PASS","FAIL","BLOCK","미진행","N/A"}))`;

    const moValues = [
        ['구분', 'PC', '모바일'],
        ['PASS',    countif('H', 'PASS'),    countif('I', 'PASS')],
        ['FAIL',    countif('H', 'FAIL'),    countif('I', 'FAIL')],
        ['BLOCK',   countif('H', 'BLOCK'),   countif('I', 'BLOCK')],
        ['미진행',  countif('H', '미진행'),  countif('I', '미진행')],
        ['N/A',     countif('H', 'N/A'),     countif('I', 'N/A')],
        ['합계',    sumAll('H'),             sumAll('I')],
    ];
    await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${sheetName}'!M1:O7`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: moValues },
    });

    // ─── 서식 요청 ──────────────────────────────────────────────────
    const fmtFields = 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)';
    const bgOnlyFields = 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment)';

    const requests = [
        // K1:L1 담당자 헤더 (병합 + 남색)
        { mergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 10, endColumnIndex: 12 }, mergeType: 'MERGE_ALL' } },
        repeatCell(sheetId, 0, 1, 10, 12, headerFmt(), fmtFields),

        // K2~K5 라벨
        repeatCell(sheetId, 1, 5, 10, 11, labelFmt(), fmtFields),
        // L2~L5 빈칸
        repeatCell(sheetId, 1, 5, 11, 12, valueFmt(), bgOnlyFields),

        // K6 기획서 헤더
        repeatCell(sheetId, 5, 6, 10, 11, headerFmt(), fmtFields),
        // L6 URL
        repeatCell(sheetId, 5, 6, 11, 12, linkFmt(), fmtFields),

        // K7 "테스트 환경" 헤더 (병합 없음, 남색) | L7 빈칸
        { unmergeCells: { range: { sheetId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 10, endColumnIndex: 12 } } },
        repeatCell(sheetId, 6, 7, 10, 11, headerFmt(), fmtFields),
        repeatCell(sheetId, 6, 7, 11, 12, valueFmt(), bgOnlyFields),

        // K8~K10 라벨
        repeatCell(sheetId, 7, 10, 10, 11, labelFmt(), fmtFields),
        // L8~L10 빈칸
        repeatCell(sheetId, 7, 10, 11, 12, valueFmt(), bgOnlyFields),

        // K/L열 테두리 (1~10행)
        borderAll(sheetId, 0, 10, 10, 12),

        // ─── M~O열 미니 대시보드 ─────────────────────────────────────
        // M1 "구분" 헤더
        repeatCell(sheetId, 0, 1, 12, 13, headerFmt(), fmtFields),
        // N1/O1 PC/모바일 헤더
        repeatCell(sheetId, 0, 1, 13, 15, {
            backgroundColor: { red: 0.384, green: 0.467, blue: 0.824 },
            textFormat: { foregroundColor: COLOR_WHITE, bold: true, fontSize: 10 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
        }, fmtFields),

        // M2~M6 메트릭 라벨 (좌정렬 + 각 색상)
        // PASS (연녹)
        repeatCell(sheetId, 1, 2, 12, 13, {
            backgroundColor: { red: 0.678, green: 0.878, blue: 0.698 },
            textFormat: { foregroundColor: COLOR_BLACK, bold: true, fontSize: 10 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
        }, fmtFields),
        // FAIL (연빨강)
        repeatCell(sheetId, 2, 3, 12, 13, {
            backgroundColor: { red: 0.980, green: 0.737, blue: 0.737 },
            textFormat: { foregroundColor: COLOR_BLACK, bold: true, fontSize: 10 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
        }, fmtFields),
        // BLOCK (연주황)
        repeatCell(sheetId, 3, 4, 12, 13, {
            backgroundColor: { red: 1.000, green: 0.867, blue: 0.647 },
            textFormat: { foregroundColor: COLOR_BLACK, bold: true, fontSize: 10 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
        }, fmtFields),
        // 미진행 (연회색)
        repeatCell(sheetId, 4, 5, 12, 13, {
            backgroundColor: { red: 0.800, green: 0.800, blue: 0.800 },
            textFormat: { foregroundColor: COLOR_BLACK, bold: true, fontSize: 10 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
        }, fmtFields),
        // N/A (회색)
        repeatCell(sheetId, 5, 6, 12, 13, {
            backgroundColor: { red: 0.700, green: 0.700, blue: 0.700 },
            textFormat: { foregroundColor: COLOR_BLACK, bold: true, fontSize: 10 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
        }, fmtFields),
        // 합계 (연파랑)
        repeatCell(sheetId, 6, 7, 12, 13, {
            backgroundColor: { red: 0.635, green: 0.831, blue: 0.953 },
            textFormat: { foregroundColor: COLOR_BLACK, bold: true, fontSize: 10 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
        }, fmtFields),

        // N~O 숫자 영역 (배경 + 중앙 정렬 + 숫자 포맷)
        repeatCell(sheetId, 1, 2, 13, 15, {
            backgroundColor: { red: 0.878, green: 0.969, blue: 0.886 },
            horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE',
            numberFormat: { type: 'NUMBER', pattern: '#,##0' },
        }, 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,numberFormat)'),
        repeatCell(sheetId, 2, 3, 13, 15, {
            backgroundColor: { red: 1.000, green: 0.894, blue: 0.894 },
            horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE',
            numberFormat: { type: 'NUMBER', pattern: '#,##0' },
        }, 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,numberFormat)'),
        repeatCell(sheetId, 3, 4, 13, 15, {
            backgroundColor: { red: 1.000, green: 0.957, blue: 0.867 },
            horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE',
            numberFormat: { type: 'NUMBER', pattern: '#,##0' },
        }, 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,numberFormat)'),
        repeatCell(sheetId, 4, 5, 13, 15, {
            backgroundColor: { red: 0.933, green: 0.933, blue: 0.933 },
            horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE',
            numberFormat: { type: 'NUMBER', pattern: '#,##0' },
        }, 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,numberFormat)'),
        repeatCell(sheetId, 5, 6, 13, 15, {
            backgroundColor: { red: 0.878, green: 0.878, blue: 0.878 },
            horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE',
            numberFormat: { type: 'NUMBER', pattern: '#,##0' },
        }, 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,numberFormat)'),
        repeatCell(sheetId, 6, 7, 13, 15, {
            backgroundColor: { red: 0.867, green: 0.937, blue: 0.984 },
            textFormat: { foregroundColor: COLOR_BLACK, bold: true, fontSize: 10 },
            horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE',
            numberFormat: { type: 'NUMBER', pattern: '#,##0' },
        }, 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,numberFormat)'),

        // M~O열 테두리 (1~7행)
        borderAll(sheetId, 0, 7, 12, 15),

        // 열 너비
        { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 10, endIndex: 11 }, properties: { pixelSize: 90 }, fields: 'pixelSize' } },
        { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 11, endIndex: 12 }, properties: { pixelSize: 200 }, fields: 'pixelSize' } },
        { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 12, endIndex: 13 }, properties: { pixelSize: 90 }, fields: 'pixelSize' } },
        { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 13, endIndex: 15 }, properties: { pixelSize: 70 }, fields: 'pixelSize' } },
    ];

    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });

    console.log(`K~O열 프로젝트 정보 + 미니 대시보드 추가 완료: ${sheetName}`);
}

// CLI
if (require.main === module) {
    const [spreadsheetId, sheetName, confluenceUrl] = process.argv.slice(2);
    if (!spreadsheetId || !sheetName || !confluenceUrl) {
        console.error('사용법: node add_project_info.js <spreadsheetId> <sheetName> <confluenceUrl>');
        process.exit(1);
    }
    addProjectInfo(spreadsheetId, sheetName, confluenceUrl).catch(err => {
        console.error('에러:', err.message || err);
        process.exit(1);
    });
}

module.exports = { addProjectInfo };
