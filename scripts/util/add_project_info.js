/**
 * K/L열 프로젝트 정보 패널 추가
 *
 * 사용법:
 *   node add_project_info.js <spreadsheetId> <sheetName> <confluenceUrl>
 *
 * K/L열 구조:
 *   K1: "담당자" (헤더)  |  L1: (빈칸)
 *   K2: "기획"           |  L2: (빈칸)
 *   K3: "서버"           |  L3: (빈칸)
 *   K4: "클라"           |  L4: (빈칸)
 *   K5: "UI"             |  L5: (빈칸)
 *   K6: "기획서"         |  L6: Confluence URL (하이퍼링크)
 */
const { google } = require('googleapis');
const { getAuthClient } = require('./google_auth');

async function addProjectInfo(spreadsheetId, sheetName, confluenceUrl) {
    const auth = await getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });

    // 시트 ID 조회
    const sp = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(title,sheetId)' });
    const sheet = sp.data.sheets.find(s => s.properties.title === sheetName);
    if (!sheet) throw new Error(`탭 '${sheetName}'을 찾을 수 없습니다`);
    const sheetId = sheet.properties.sheetId;

    // K/L열 데이터 입력
    await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${sheetName}'!K1:L6`,
        valueInputOption: 'RAW',
        requestBody: {
            values: [
                ['담당자', ''],
                ['기획', ''],
                ['서버', ''],
                ['클라', ''],
                ['UI', ''],
                ['기획서', confluenceUrl],
            ],
        },
    });

    // 서식 적용
    const requests = [
        // K1 헤더: 진한 남색 배경 + 흰색 글씨 + 볼드 + 가운데 정렬
        {
            repeatCell: {
                range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 10, endColumnIndex: 12 },
                cell: {
                    userEnteredFormat: {
                        backgroundColor: { red: 0.176, green: 0.251, blue: 0.349 },
                        textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true, fontSize: 10 },
                        horizontalAlignment: 'CENTER',
                        verticalAlignment: 'MIDDLE',
                    },
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
            },
        },
        // K2~K5 라벨: 흰색 배경 + 검정 글씨 + 볼드 + 가운데 정렬
        {
            repeatCell: {
                range: { sheetId, startRowIndex: 1, endRowIndex: 5, startColumnIndex: 10, endColumnIndex: 11 },
                cell: {
                    userEnteredFormat: {
                        backgroundColor: { red: 1, green: 1, blue: 1 },
                        textFormat: { foregroundColor: { red: 0, green: 0, blue: 0 }, bold: true, fontSize: 10 },
                        horizontalAlignment: 'CENTER',
                        verticalAlignment: 'MIDDLE',
                    },
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
            },
        },
        // L2~L5 빈칸: 흰색 배경
        {
            repeatCell: {
                range: { sheetId, startRowIndex: 1, endRowIndex: 5, startColumnIndex: 11, endColumnIndex: 12 },
                cell: {
                    userEnteredFormat: {
                        backgroundColor: { red: 1, green: 1, blue: 1 },
                    },
                },
                fields: 'userEnteredFormat(backgroundColor)',
            },
        },
        // K6 기획서 라벨: 진한 남색 배경 + 흰색 글씨 + 볼드
        {
            repeatCell: {
                range: { sheetId, startRowIndex: 5, endRowIndex: 6, startColumnIndex: 10, endColumnIndex: 11 },
                cell: {
                    userEnteredFormat: {
                        backgroundColor: { red: 0.176, green: 0.251, blue: 0.349 },
                        textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true, fontSize: 10 },
                        horizontalAlignment: 'CENTER',
                        verticalAlignment: 'MIDDLE',
                    },
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
            },
        },
        // L6 URL: 흰색 배경 + 파란 글씨 + 왼쪽 정렬
        {
            repeatCell: {
                range: { sheetId, startRowIndex: 5, endRowIndex: 6, startColumnIndex: 11, endColumnIndex: 12 },
                cell: {
                    userEnteredFormat: {
                        backgroundColor: { red: 1, green: 1, blue: 1 },
                        textFormat: { foregroundColor: { red: 0.067, green: 0.333, blue: 0.8 }, fontSize: 10 },
                        horizontalAlignment: 'LEFT',
                        verticalAlignment: 'MIDDLE',
                    },
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
            },
        },
        // K/L열 테두리
        {
            updateBorders: {
                range: { sheetId, startRowIndex: 0, endRowIndex: 6, startColumnIndex: 10, endColumnIndex: 12 },
                top: { style: 'SOLID', color: { red: 0.7, green: 0.7, blue: 0.7 } },
                bottom: { style: 'SOLID', color: { red: 0.7, green: 0.7, blue: 0.7 } },
                left: { style: 'SOLID', color: { red: 0.7, green: 0.7, blue: 0.7 } },
                right: { style: 'SOLID', color: { red: 0.7, green: 0.7, blue: 0.7 } },
                innerHorizontal: { style: 'SOLID', color: { red: 0.85, green: 0.85, blue: 0.85 } },
                innerVertical: { style: 'SOLID', color: { red: 0.85, green: 0.85, blue: 0.85 } },
            },
        },
        // K열 너비 80px, L열 너비 200px
        {
            updateDimensionProperties: {
                range: { sheetId, dimension: 'COLUMNS', startIndex: 10, endIndex: 11 },
                properties: { pixelSize: 80 },
                fields: 'pixelSize',
            },
        },
        {
            updateDimensionProperties: {
                range: { sheetId, dimension: 'COLUMNS', startIndex: 11, endIndex: 12 },
                properties: { pixelSize: 200 },
                fields: 'pixelSize',
            },
        },
    ];

    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });

    console.log(`K/L열 프로젝트 정보 패널 추가 완료: ${sheetName}`);
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
