/**
 * 전체 TC 탭에 K~O 프로젝트 정보 패널 일괄 적용
 * - BVT, 대시보드 제외
 * - L열 기존 입력값(담당자명 등) 보존
 */
const { google } = require('googleapis');
const { getAuthClient } = require('./google_auth');
const { addProjectInfo } = require('./add_project_info');

const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID';

// 탭명 → Confluence URL 매핑
const URL_MAP = {
    '예제 기능 1':              'https://YOUR_SITE.atlassian.net/wiki/spaces/YOUR_SPACE/pages/710000001',
    '예제 기능 2':                  'https://YOUR_SITE.atlassian.net/wiki/spaces/YOUR_SPACE/pages/710000002',
    '예제 기능 3':          'https://YOUR_SITE.atlassian.net/wiki/spaces/YOUR_SPACE/pages/710000003',
    '예제 기능 4':             'https://YOUR_SITE.atlassian.net/wiki/spaces/YOUR_SPACE/pages/710000004',
    '예제 기능 5':             'https://YOUR_SITE.atlassian.net/wiki/spaces/YOUR_SPACE/pages/710000005',
    '예제 기능 6':                  'https://YOUR_SITE.atlassian.net/wiki/spaces/YOUR_SPACE/pages/710000006',
    '예제 기능 7':                 'https://YOUR_SITE.atlassian.net/wiki/spaces/YOUR_SPACE/pages/710000007',
    '예제 기능 8':               'https://YOUR_SITE.atlassian.net/wiki/spaces/YOUR_SPACE/pages/710000008',
    '예제 기능 9':           'https://YOUR_SITE.atlassian.net/wiki/spaces/YOUR_SPACE/pages/710000009',
    '예제 기능 10':           'https://YOUR_SITE.atlassian.net/wiki/spaces/YOUR_SPACE/pages/710000010',
    '예제 기능 11':           'https://YOUR_SITE.atlassian.net/wiki/spaces/YOUR_SPACE/pages/710000011',
    '예제 기능 12':             'https://YOUR_SITE.atlassian.net/wiki/spaces/YOUR_SPACE/pages/710000012',
    '예제 기능 13':             'https://YOUR_SITE.atlassian.net/wiki/spaces/YOUR_SPACE/pages/710000016',
    '예제 기능 14':          'https://YOUR_SITE.atlassian.net/wiki/spaces/YOUR_SPACE/pages/710000016',
    '예제 기능 15':  'https://YOUR_SITE.atlassian.net/wiki/spaces/YOUR_SPACE/pages/710000016',
    '예제 기능 16':          'https://YOUR_SITE.atlassian.net/wiki/spaces/YOUR_SPACE/pages/710000016',
};

const EXCLUDE = ['대시보드', 'BVT(Trunk)'];

async function run() {
    const auth = await getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });

    // 전체 탭 목록
    const sp = await sheets.spreadsheets.get({
        spreadsheetId: SPREADSHEET_ID,
        fields: 'sheets.properties(title,hidden)',
    });
    const allTabs = sp.data.sheets
        .filter(s => !s.properties.hidden)
        .map(s => s.properties.title)
        .filter(t => !EXCLUDE.includes(t));

    console.log(`대상 탭 ${allTabs.length}개: ${allTabs.join(', ')}\n`);

    const results = [];

    for (const tabName of allTabs) {
        const confluenceUrl = URL_MAP[tabName] || '';

        // L1:L10 기존 값 읽기 (보존용)
        let existingL = Array(10).fill('');
        try {
            const res = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `'${tabName}'!L1:L10`,
            });
            const rows = res.data.values || [];
            rows.forEach((r, i) => { existingL[i] = r[0] || ''; });
        } catch (e) {
            // 값 없으면 빈칸으로
        }

        // addProjectInfo 적용 (L6는 항상 URL로 덮어쓰기, 나머지 L열은 기존값 복원)
        try {
            await addProjectInfo(SPREADSHEET_ID, tabName, confluenceUrl);

            // L열 기존 값 복원 (L1, L6 제외: L1 헤더/L6 URL은 스크립트가 관리)
            const restoreValues = [];
            for (let i = 0; i < 10; i++) {
                const rowIdx = i + 1;
                if (rowIdx === 1 || rowIdx === 6) continue; // 헤더·URL은 유지
                if (existingL[i]) {
                    restoreValues.push({
                        range: `'${tabName}'!L${rowIdx}`,
                        values: [[existingL[i]]],
                    });
                }
            }
            if (restoreValues.length > 0) {
                await sheets.spreadsheets.values.batchUpdate({
                    spreadsheetId: SPREADSHEET_ID,
                    requestBody: { valueInputOption: 'RAW', data: restoreValues },
                });
                console.log(`  → L열 기존값 복원: ${restoreValues.map(r => r.range.split('!')[1]).join(', ')}`);
            }

            results.push({ tab: tabName, status: '✓' });
        } catch (e) {
            console.error(`  ✗ ${tabName}: ${e.message}`);
            results.push({ tab: tabName, status: `✗ ${e.message}` });
        }
    }

    console.log('\n=== 완료 ===');
    results.forEach(r => console.log(`  ${r.status} ${r.tab}`));
}

run().catch(e => { console.error('에러:', e.message); process.exit(1); });
