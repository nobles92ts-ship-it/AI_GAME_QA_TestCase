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
    '캐릭터선택화면':              'https://YOUR_SITE.atlassian.net/wiki/spaces/DX/pages/36045047',
    '수영_시스템':                  'https://YOUR_SITE.atlassian.net/wiki/spaces/DX/pages/237797399',
    '사망_및_부활_시스템':          'https://YOUR_SITE.atlassian.net/wiki/spaces/DX/pages/100106326',
    '즉시이동예외처리':             'https://YOUR_SITE.atlassian.net/wiki/spaces/DX/pages/254836741',
    '필드_보스_시스템':             'https://YOUR_SITE.atlassian.net/wiki/spaces/DX/pages/115082403',
    '버려진_고성':                  'https://YOUR_SITE.atlassian.net/wiki/spaces/DX/pages/210272257',
    '퀘스트UI개선':                 'https://YOUR_SITE.atlassian.net/wiki/spaces/DX/pages/271450161',
    '아바타합성확정':               'https://YOUR_SITE.atlassian.net/wiki/spaces/DX/pages/243826783',
    '월드맵_시스템_개선':           'https://YOUR_SITE.atlassian.net/wiki/spaces/DX/pages/256507927',
    '버서커_스킬_사양서':           'https://YOUR_SITE.atlassian.net/wiki/spaces/DX/pages/309330005',
    '버프디버프_UI_개선':           'https://YOUR_SITE.atlassian.net/wiki/spaces/DX/pages/316440818',
    '장비 분해 시스템':             'https://YOUR_SITE.atlassian.net/wiki/spaces/DX/pages/75956534',
    '장비 강화 시스템':             'https://YOUR_SITE.atlassian.net/wiki/spaces/DX/pages/57344335',
    '장비 강화 시스템_v2':          'https://YOUR_SITE.atlassian.net/wiki/spaces/DX/pages/57344335',
    '장비 강화 시스템_haiku_test':  'https://YOUR_SITE.atlassian.net/wiki/spaces/DX/pages/57344335',
    '장비 강화 시스템_v3':          'https://YOUR_SITE.atlassian.net/wiki/spaces/DX/pages/57344335',
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
