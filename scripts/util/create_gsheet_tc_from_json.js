/**
 * create_gsheet_tc_from_json.js
 * JSON 파일을 읽어 마스터 스프레드시트에 새 탭으로 TC를 생성하는 스크립트
 *
 * 사용법:
 *   node create_gsheet_tc_from_json.js "탭명" "스프레드시트ID" "JSON파일경로"
 *
 * JSON 형식 (tc-writer가 생성):
 *   [
 *     ["대분류", "중분류", "소분류", "검증단계", "플랫폼", "재현스탭", "비고(optional)"],
 *     ...
 *   ]
 *
 * 동작:
 *   1. 지정된 스프레드시트에 [탭명] 탭 추가 (이미 있으면 중단)
 *   2. JSON 데이터를 읽어 TC 행으로 변환 후 업로드
 *   3. 서식 적용
 */
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { getAuthClient } = require('./google_auth');
const { applyFormatToTab } = require('./apply_format_tab');

const TAB_NAME = process.argv[2];
const MASTER_SPREADSHEET_ID = process.argv[3];
const JSON_FILE = process.argv[4];

if (!TAB_NAME || !MASTER_SPREADSHEET_ID || !JSON_FILE) {
    console.error('사용법: node create_gsheet_tc_from_json.js "탭명" "스프레드시트ID" "JSON파일경로"');
    process.exit(1);
}

async function createTcTab() {
    // ─── JSON 파일 읽기 ───
    const jsonPath = path.resolve(JSON_FILE);
    if (!fs.existsSync(jsonPath)) {
        console.error(`❌ JSON 파일을 찾을 수 없습니다: ${jsonPath}`);
        process.exit(1);
    }
    const tcData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    console.log(`  → JSON 로드 완료: ${tcData.length}개 TC`);

    const auth = await getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });

    // ─── STEP 1: 마스터 스프레드시트에 새 탭 추가 ───
    console.log(`[1/3] 스프레드시트(${MASTER_SPREADSHEET_ID})에 "${TAB_NAME}" 탭 추가 중...`);

    const meta = await sheets.spreadsheets.get({ spreadsheetId: MASTER_SPREADSHEET_ID });
    const existingTab = meta.data.sheets.find(s => s.properties.title === TAB_NAME);
    if (existingTab) {
        console.error(`❌ "${TAB_NAME}" 탭이 이미 존재합니다. 중복 생성 방지를 위해 중단합니다.`);
        console.log(`   기존 탭 sheetId: ${existingTab.properties.sheetId}`);
        process.exit(1);
    }

    const addRes = await sheets.spreadsheets.batchUpdate({
        spreadsheetId: MASTER_SPREADSHEET_ID,
        resource: {
            requests: [{ addSheet: { properties: { title: TAB_NAME } } }]
        }
    });
    const sheetId = addRes.data.replies[0].addSheet.properties.sheetId;
    console.log(`  → 탭 추가 완료! sheetId: ${sheetId}`);

    // ─── STEP 2: TC 데이터 변환 + 업로드 ───
    console.log('[2/3] TC 데이터 업로드 중...');

    const header = ['TC ID', '대분류', '중분류', '소분류', '검증단계', '재현 스탭', '플랫폼', 'PC 결과', '모바일 결과', '비고', '담당자'];
    const rowsData = [header];
    let prevMajor = '', prevMinor = '', prevSub = '';

    for (const row of tcData) {
        const [major, minor, sub, verif, platform, step, note = ''] = row;
        const id = '=TEXT(ROW()-1,"000")';
        const dMajor = major === prevMajor ? '' : major;
        const dMinor = minor === prevMinor ? '' : minor;
        const dSub = sub === prevSub ? '' : sub;
        prevMajor = major; prevMinor = minor; prevSub = sub;

        let pcResult = 'N/A', mobileResult = 'N/A';
        if (platform === 'PC' || platform === 'PC/모바일') pcResult = '미진행';
        if (platform === '모바일' || platform === 'PC/모바일') mobileResult = '미진행';

        rowsData.push([id, dMajor, dMinor, dSub, verif, step, platform, pcResult, mobileResult, note, '']);
    }

    await sheets.spreadsheets.values.update({
        spreadsheetId: MASTER_SPREADSHEET_ID,
        range: `'${TAB_NAME}'!A1`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: rowsData }
    });
    console.log(`  → ${rowsData.length - 1}개 TC 업로드 완료`);

    // ─── STEP 3: 서식 적용 ───
    console.log('[3/3] 서식 적용 중...');
    await applyFormatToTab(TAB_NAME, false, MASTER_SPREADSHEET_ID);

    console.log(`\n✔ 스프레드시트에 "${TAB_NAME}" 탭 생성 완료!`);
    console.log(`👉 https://docs.google.com/spreadsheets/d/${MASTER_SPREADSHEET_ID}/edit`);
    console.log(`\n📊 대시보드 업데이트는 별도로 실행: node update_dashboard.js`);
}

createTcTab().catch(err => {
    console.error('에러:', err.message || err);
    if (err.errors) console.error('상세:', JSON.stringify(err.errors, null, 2));
    process.exit(1);
});
