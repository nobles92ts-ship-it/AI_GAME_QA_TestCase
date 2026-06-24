/**
 * create_gsheet_tc_from_json.js
 * JSON 파일을 읽어 마스터 스프레드시트에 새 탭으로 TC를 생성하는 스크립트
 *
 * 사용법:
 *   node create_gsheet_tc_from_json.js "탭명" "스프레드시트ID" "JSON파일경로"
 *
 * JSON 형식 (tc-writer가 생성):
 *   [
 *     ["대분류", "중분류", "소분류", "검증단계", "재현스탭", "플랫폼", "비고(optional)"],
 *     ...
 *   ]
 *   ※ 헤더 행 포함 금지 — 데이터 행만 작성
 *   ※ 재현스탭(index 4) → 플랫폼(index 5) 순서 — 시트 F열=재현스탭, G열=플랫폼과 동일
 *
 * 동작 (Phase1 — 검증 내장: 에이전트 의무가 아니라 스크립트가 직접 보장):
 *   1. validatePreWrite — 탭 생성 전 실행 (FAIL 시 빈 탭을 남기지 않음, L4-05)
 *   2. 지정된 스프레드시트에 [탭명] 탭 추가 (이미 있으면 중단)
 *   3. JSON 데이터를 TC 행으로 변환 후 업로드 — H/I는 expectedHI 단일함수로 결정 (L4-01)
 *   4. validatePostWrite — read-back 셀값 대조
 *   5. 서식 적용
 *   6. (옵션) --snapshot-dir <specs폴더> — 슬림/풀 스냅샷 저장 (read_gsheet_data CLI 호출)
 *
 * 종료코드 (L4-05 — writer/팀장 분기용으로 의미 분리):
 *   0=성공 / 1=사용법·입력파일·일반 에러 / 3=탭 이미 존재 / 4=preWrite 위반 / 5=postWrite 불일치
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { google } = require('googleapis');
const { getAuthClient } = require('./google_auth');
const { applyFormatToTab } = require('./apply_format_tab');
const { validatePreWrite, validatePostWrite, formatViolations, expectedHI } = require('./validate_tc_rows');

const TAB_NAME = process.argv[2];
const MASTER_SPREADSHEET_ID = process.argv[3];
const JSON_FILE = process.argv[4];
const snapDirIdx = process.argv.indexOf('--snapshot-dir');
const SNAPSHOT_DIR = snapDirIdx >= 0 ? process.argv[snapDirIdx + 1] : null;

if (!TAB_NAME || !MASTER_SPREADSHEET_ID || !JSON_FILE) {
    console.error('사용법: node create_gsheet_tc_from_json.js "탭명" "스프레드시트ID" "JSON파일경로" [--snapshot-dir <specs폴더>]');
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

    // ─── STEP 0: Pre-Write 검증 — 탭 생성 전 (FAIL 시 빈 탭 잔류 방지, L4-05) ───
    const pre = validatePreWrite(tcData);
    if (!pre.ok) {
        console.error(`❌ Pre-Write 검증 실패 (${pre.violations.length}건) — 탭을 만들지 않고 중단:`);
        console.error(formatViolations(pre.violations));
        process.exit(4);
    }
    if (pre.violations.length) {
        console.log(`  ⚠ Pre-Write 경고 ${pre.violations.length}건 (비차단):\n` + formatViolations(pre.violations));
    }

    // ─── 로컬 모드: Google Sheets 대신 .xlsx 파일로 출력 (OAuth/구글 설정 불필요) ───
    //   TC_LOCAL_XLSX 환경변수에 출력 경로가 있으면, 시트 업로드 대신 로컬 엑셀로 저장하고 종료한다.
    //   Pre-Write 검증(위)은 그대로 통과한 뒤이므로 행 품질은 동일하게 보장된다.
    if (process.env.TC_LOCAL_XLSX) {
        const { writeXlsx } = require('./create_xlsx_tc_from_json');
        const outPath = writeXlsx(TAB_NAME, process.env.TC_LOCAL_XLSX, tcData);
        console.log(`[로컬] Google Sheets 미사용 — 엑셀 파일 생성: ${outPath} (${tcData.length}개 TC)`);
        return;
    }

    const auth = await getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });

    // ─── STEP 1: 마스터 스프레드시트에 새 탭 추가 ───
    console.log(`[1/3] 스프레드시트(${MASTER_SPREADSHEET_ID})에 "${TAB_NAME}" 탭 추가 중...`);

    const meta = await sheets.spreadsheets.get({ spreadsheetId: MASTER_SPREADSHEET_ID });
    const existingTab = meta.data.sheets.find(s => s.properties.title === TAB_NAME);
    if (existingTab) {
        console.error(`❌ "${TAB_NAME}" 탭이 이미 존재합니다. 중복 생성 방지를 위해 중단합니다.`);
        console.log(`   기존 탭 sheetId: ${existingTab.properties.sheetId}`);
        process.exit(3);
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
    const basicFuncRowIndices = []; // 기본기능 행의 0-based 시트 행 인덱스

    for (let i = 0; i < tcData.length; i++) {
        const row = tcData[i];
        const [major, minor, sub, verif, step, platform, note = ''] = row;
        const id = '=TEXT(ROW()-1,"000")';
        const dMajor = major === prevMajor ? '' : major;
        const dMinor = minor === prevMinor ? '' : minor;
        const dSub = sub === prevSub ? '' : sub;
        prevMajor = major; prevMinor = minor; prevSub = sub;

        if (major === '기본기능') basicFuncRowIndices.push(i + 1); // +1: 헤더(0) 다음부터

        // H/I 초기값: 단일 기대함수 사용 — J='추후 구현'이면 둘 다 N/A (V-20 원천 보장, L4-01)
        // ⚠ 여기서 platform 단독 분기 금지: 검증(validateFull/precheck)과 기대값이 갈라지면
        //   생성-검증 모순 런이 발생한다 (v7 TC45/64/81 사고의 원천).
        const hi = expectedHI(note, platform, major === '기본기능');

        rowsData.push([id, dMajor, dMinor, dSub, verif, step, platform, hi.h, hi.i, note, '']);
    }

    await sheets.spreadsheets.values.update({
        spreadsheetId: MASTER_SPREADSHEET_ID,
        range: `'${TAB_NAME}'!A1`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: rowsData }
    });
    console.log(`  → ${rowsData.length - 1}개 TC 업로드 완료`);

    // ─── STEP 2.5: Post-Write 검증 — read-back 셀값 대조 (스크립트 내장이라 skip 불가) ───
    const post = await validatePostWrite(sheets, MASTER_SPREADSHEET_ID, TAB_NAME, 2, tcData);
    if (!post.ok) {
        console.error(`❌ Post-Write 검증 실패 (${post.violations.length}건):`);
        console.error(formatViolations(post.violations));
        process.exit(5);
    }
    console.log('  → Post-Write 검증 통과 (행수·B~F 셀값·G 꼬임)');

    // ─── STEP 3: 서식 적용 ───
    console.log('[3/3] 서식 적용 중...');
    await applyFormatToTab(TAB_NAME, false, MASTER_SPREADSHEET_ID);

    // 기본기능 행 B~F열 배경색: 연한 회색3 (#D9D9D9)
    if (basicFuncRowIndices.length > 0) {
        const colorRequests = basicFuncRowIndices.map(rowIdx => ({
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: rowIdx,
                    endRowIndex: rowIdx + 1,
                    startColumnIndex: 1, // B열
                    endColumnIndex: 6    // F열 (exclusive)
                },
                cell: {
                    userEnteredFormat: {
                        backgroundColor: { red: 0.851, green: 0.851, blue: 0.851 }
                    }
                },
                fields: 'userEnteredFormat.backgroundColor'
            }
        }));
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: MASTER_SPREADSHEET_ID,
            resource: { requests: colorRequests }
        });
        console.log(`  → 기본기능 행 색상 적용 완료 (${basicFuncRowIndices.length}개 행)`);
    }

    // ─── STEP 4 (옵션): 슬림/풀 스냅샷 저장 — read_gsheet_data CLI 호출 (L4-10: require 불가라 자식 프로세스) ───
    // ⚠ 시점 주의 (I5): 이 스냅샷은 "업로드 직후" 상태. 이후 자가검증(validateFull)에서
    //   위반행을 수정해 시트가 바뀌면 writer는 스냅샷을 재덤프해야 한다 (tc-생성.md 자가검증 절차 참조).
    if (SNAPSHOT_DIR) {
        console.log('[4/4] 스냅샷 저장 중...');
        const reader = path.join(__dirname, 'read_gsheet_data.js');
        const dump = (args, outFile) => {
            const out = execFileSync(process.execPath, [reader, MASTER_SPREADSHEET_ID, TAB_NAME, ...args], {
                encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
            });
            fs.writeFileSync(path.join(SNAPSHOT_DIR, outFile), out, 'utf8');
        };
        dump(['--columns', 'A,B,C,D,E,F,G,H,I,J', '--minify'], 'tc_snapshot.json');
        dump(['--minify'], 'tc_snapshot_full.json');
        console.log(`  → tc_snapshot.json / tc_snapshot_full.json 저장 (${SNAPSHOT_DIR})`);
    }

    console.log(`\n✔ 스프레드시트에 "${TAB_NAME}" 탭 생성 완료!`);
    console.log(`👉 https://docs.google.com/spreadsheets/d/${MASTER_SPREADSHEET_ID}/edit`);
    console.log(`\n📊 대시보드 업데이트는 별도로 실행: node update_dashboard.js`);
}

createTcTab().catch(err => {
    console.error('에러:', err.message || err);
    if (err.errors) console.error('상세:', JSON.stringify(err.errors, null, 2));
    process.exit(1);
});
