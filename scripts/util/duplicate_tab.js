/**
 * 구글 스프레드시트 탭 복제 (S2 백업 탭)
 *
 * 사용법:
 *   node duplicate_tab.js <spreadsheetId> <sourceTabName> <newTabName>
 *   node duplicate_tab.js <spreadsheetId> <tabName> --delete           ← 탭 삭제
 *
 * 종료 코드:
 *   0  성공
 *   1  일반 실패 (인자 부족, 기타)
 *   2  소스 탭 없음 (백업 대상 부재 — 파이프라인은 경고 후 계속 가능)
 *   3  대상 탭 이미 존재 (중복 이름 충돌)
 *   10 OAuth/인증 실패 (재시도 금지 — S4 패턴)
 *   11 쿼터/레이트 초과 (재시도 가능 — S1 패턴)
 */
const { google } = require('googleapis');
const { getAuthClient } = require('./google_auth');

function classifyError(err) {
    const msg = String(err?.message || err);
    if (/OAuth|invalid_grant|401|UNAUTHENTICATED|invalid_token/i.test(msg)) return 10;
    if (/429|RESOURCE_EXHAUSTED|Quota|rateLimit|503/i.test(msg)) return 11;
    return 1;
}

async function findSheet(sheets, spreadsheetId, tabName) {
    const res = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties(title,sheetId)',
    });
    const match = (res.data.sheets || []).find(s => s.properties.title === tabName);
    return match ? match.properties : null;
}

async function duplicate(spreadsheetId, sourceTab, newTab) {
    const auth = await getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });

    const source = await findSheet(sheets, spreadsheetId, sourceTab);
    if (!source) {
        process.stderr.write(`[duplicate_tab] 소스 탭 없음: ${sourceTab}\n`);
        process.exit(2);
    }

    const existing = await findSheet(sheets, spreadsheetId, newTab);
    if (existing) {
        process.stderr.write(`[duplicate_tab] 대상 탭 이미 존재: ${newTab}\n`);
        process.exit(3);
    }

    const res = await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
            requests: [{
                duplicateSheet: {
                    sourceSheetId: source.sheetId,
                    newSheetName: newTab,
                },
            }],
        },
    });

    const newSheetId = res.data.replies[0]?.duplicateSheet?.properties?.sheetId;
    process.stdout.write(JSON.stringify({
        status: 'success',
        action: 'duplicate',
        source: sourceTab,
        destination: newTab,
        newSheetId,
    }) + '\n');
}

async function deleteTab(spreadsheetId, tabName) {
    const auth = await getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });

    const target = await findSheet(sheets, spreadsheetId, tabName);
    if (!target) {
        process.stderr.write(`[duplicate_tab] 삭제 대상 탭 없음: ${tabName}\n`);
        process.exit(2);
    }

    await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
            requests: [{ deleteSheet: { sheetId: target.sheetId } }],
        },
    });

    process.stdout.write(JSON.stringify({
        status: 'success',
        action: 'delete',
        target: tabName,
    }) + '\n');
}

async function main() {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        process.stderr.write('사용법:\n');
        process.stderr.write('  node duplicate_tab.js <spreadsheetId> <sourceTab> <newTab>\n');
        process.stderr.write('  node duplicate_tab.js <spreadsheetId> <tabName> --delete\n');
        process.exit(1);
    }

    const [spreadsheetId, arg2, arg3] = args;
    try {
        if (arg3 === '--delete' || args.includes('--delete')) {
            await deleteTab(spreadsheetId, arg2);
        } else {
            if (!arg3) {
                process.stderr.write('[duplicate_tab] newTabName 인자 필요\n');
                process.exit(1);
            }
            await duplicate(spreadsheetId, arg2, arg3);
        }
    } catch (err) {
        process.stderr.write(`[duplicate_tab] 에러: ${err.message}\n`);
        process.exit(classifyError(err));
    }
}

main();
