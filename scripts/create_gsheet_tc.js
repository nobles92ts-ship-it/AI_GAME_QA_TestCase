/**
 * create_gsheet_tc.js
 * 마스터 스프레드시트에 새 탭으로 TC를 생성하는 스크립트
 *
 * 사용법:
 *   node create_gsheet_tc.js "탭명"
 *
 * 동작:
 *   1. 마스터 스프레드시트에 [탭명] 탭 추가 (이미 있으면 중단)
 *   2. TC 데이터 업로드
 *   3. 서식 적용
 *   4. update_dashboard.js 자동 실행
 */
const { google } = require('googleapis');
const { getAuthClient } = require('./google_auth');
const { applyFormatToTab } = require('./apply_format_tab');

const MASTER_SPREADSHEET_ID = process.env.INTEGRATION_TC_ID;
const TAB_NAME = process.argv[2];

if (!TAB_NAME) {
    console.error('사용법: node create_gsheet_tc.js "탭명"');
    process.exit(1);
}

async function createTcTab() {
    const auth = await getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });

    // ─── STEP 1: 마스터 스프레드시트에 새 탭 추가 ───
    console.log(`[1/3] 마스터 스프레드시트에 "${TAB_NAME}" 탭 추가 중...`);

    // 기존 탭 존재 여부 확인
    const meta = await sheets.spreadsheets.get({ spreadsheetId: MASTER_SPREADSHEET_ID });
    const existingTab = meta.data.sheets.find(s => s.properties.title === TAB_NAME);
    if (existingTab) {
        console.error(`❌ "${TAB_NAME}" 탭이 이미 존재합니다. 중복 생성 방지를 위해 중단합니다.`);
        console.log(`   기존 탭 sheetId: ${existingTab.properties.sheetId}`);
        process.exit(1);
    }

    // 새 탭 추가
    const addRes = await sheets.spreadsheets.batchUpdate({
        spreadsheetId: MASTER_SPREADSHEET_ID,
        resource: {
            requests: [{
                addSheet: {
                    properties: { title: TAB_NAME }
                }
            }]
        }
    });
    const sheetId = addRes.data.replies[0].addSheet.properties.sheetId;
    console.log(`  → 탭 추가 완료! sheetId: ${sheetId}`);

    // ─── STEP 2: TC 데이터 업로드 ───
    // 이 스크립트는 템플릿입니다. 실제 TC 데이터는 tc-writer 에이전트가
    // 이 스크립트를 복사하여 tc() 함수 호출을 커스텀합니다.
    console.log('[2/3] TC 데이터 업로드 중...');

    const header = ['TC ID', '대분류', '중분류', '소분류', '검증단계', '재현 스탭', '플랫폼', 'PC 결과', '모바일 결과', '비고'];
    const rowsData = [header];
    let idNum = 1;
    let prevMajor = '', prevMinor = '', prevSub = '';

    function tc(major, minor, sub, verif, platform, step) {
        const id = String(idNum++).padStart(3, '0');
        const dMajor = major === prevMajor ? '' : major;
        const dMinor = minor === prevMinor ? '' : minor;
        const dSub = sub === prevSub ? '' : sub;
        prevMajor = major; prevMinor = minor; prevSub = sub;

        // 플랫폼별 결과 열 처리 (tc-생성.md 기준: PC결과/모바일결과만)
        let pcResult = 'N/A', mobileResult = 'N/A';
        if (platform === 'PC' || platform === 'PC/모바일') pcResult = '미진행';
        if (platform === '모바일' || platform === 'PC/모바일') mobileResult = '미진행';

        rowsData.push([id, dMajor, dMinor, dSub, verif, step, platform, pcResult, mobileResult, '']);
    }

    // ── TC 데이터 (tc-writer 에이전트가 여기에 tc() 호출을 삽입) ──
    // 예시:
    // tc('대분류', '중분류', '소분류', '정상', 'PC', '재현 스텝 내용');

    if (rowsData.length <= 1) {
        console.log('  ⚠ TC 데이터가 비어 있습니다. 템플릿 모드로 헤더만 생성합니다.');
    }

    await sheets.spreadsheets.values.update({
        spreadsheetId: MASTER_SPREADSHEET_ID,
        range: `'${TAB_NAME}'!A1`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: rowsData }
    });
    console.log(`  → ${rowsData.length - 1}개 TC 업로드 완료`);

    // ─── STEP 3: 서식 적용 (apply_format_tab.js 단일 소스) ───
    console.log('[3/3] 서식 적용 중...');
    await applyFormatToTab(TAB_NAME, false, MASTER_SPREADSHEET_ID);

    console.log(`\n✔ 마스터 스프레드시트에 "${TAB_NAME}" 탭 생성 완료!`);
    console.log(`👉 https://docs.google.com/spreadsheets/d/${MASTER_SPREADSHEET_ID}/edit`);
    console.log(`\n📊 대시보드 업데이트는 별도로 실행: node update_dashboard.js`);
}

createTcTab().catch(err => {
    console.error('에러:', err.message || err);
    if (err.errors) console.error('상세:', JSON.stringify(err.errors, null, 2));
    process.exit(1);
});
