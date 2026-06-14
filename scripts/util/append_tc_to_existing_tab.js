#!/usr/bin/env node

/**
 * append_tc_to_existing_tab.js
 * 기존 탭에 신규 TC를 append하는 스크립트
 *
 * 사용법:
 *   node append_tc_to_existing_tab.js "시트ID" "탭명" "JSON파일경로"
 */

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { getAuthClient } = require('./google_auth');

const SPREADSHEET_ID = process.argv[2];
const TAB_NAME = process.argv[3];
const JSON_FILE = process.argv[4];

if (!SPREADSHEET_ID || !TAB_NAME || !JSON_FILE) {
  console.error('사용법: node append_tc_to_existing_tab.js "시트ID" "탭명" "JSON파일경로"');
  process.exit(1);
}

async function appendTCs() {
  // JSON 로드
  const jsonPath = path.resolve(JSON_FILE);
  if (!fs.existsSync(jsonPath)) {
    console.error(`❌ JSON 파일 없음: ${jsonPath}`);
    process.exit(1);
  }

  const newTCs = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  console.log(`[*] JSON 로드: ${newTCs.length}개 TC`);

  const auth = await getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });

  // 1단계: 기존 시트에서 현재 행 수 확인
  console.log(`[1/3] 기존 시트 행 수 확인 중...`);
  const getResult = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${TAB_NAME}'!A:A`
  });

  const existingRows = getResult.data.values ? getResult.data.values.length : 0;
  const startRow = existingRows + 1; // 다음 행에 시작
  const startId = parseInt((getResult.data.values?.[existingRows - 1]?.[0] || '0').replace(/^0+/, ''), 10) + 1 || 66;

  console.log(`   기존 행: ${existingRows - 1}개 (헤더 포함)`);
  console.log(`   삽입 시작: A${startRow}, ID: ${String(startId).padStart(3, '0')}`);

  // 2단계: 신규 TC 행 생성 (tc-생성.md 형식 준수)
  console.log(`[2/3] 신규 TC 행 생성 중...`);

  let prevMajor = '', prevMinor = '', prevSub = '';
  const rowsToInsert = newTCs.map((tc, idx) => {
    const id = String(startId + idx).padStart(3, '0');
    const major = tc[0];
    const minor = tc[1];
    const sub = tc[2];
    const verif = tc[3];
    const step = tc[4];
    const platform = tc[5];
    const note = tc[6] || '';

    // 분류 중복 제거 (같으면 빈 문자열)
    const displayMajor = major === prevMajor ? '' : major;
    const displayMinor = (minor === prevMinor && major === prevMajor) ? '' : minor;
    const displaySub = (sub === prevSub && minor === prevMinor && major === prevMajor) ? '' : sub;

    prevMajor = major;
    prevMinor = minor;
    prevSub = sub;

    // PC/모바일 결과 초기화
    let pc = 'N/A', mb = 'N/A';
    if (platform === 'PC' || platform === 'PC/모바일') pc = '미진행';
    if (platform === '모바일' || platform === 'PC/모바일') mb = '미진행';

    // 행 배열: A~J (K는 담당자, 추후 처리)
    return [id, displayMajor, displayMinor, displaySub, verif, step, platform, pc, mb, note, ''];
  });

  console.log(`   생성 완료: ${rowsToInsert.length}개 행`);

  // 3단계: 시트에 업로드
  console.log(`[3/3] 시트에 업로드 중...`);

  const endRow = startRow + rowsToInsert.length - 1;
  const range = `'${TAB_NAME}'!A${startRow}:K${endRow}`;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range,
    valueInputOption: 'USER_ENTERED',
    resource: { values: rowsToInsert }
  });

  console.log(`✔ 업로드 완료: ${range}`);
  console.log(`   총 ${rowsToInsert.length}개 행 추가`);
  console.log(`   TC ID: ${String(startId).padStart(3, '0')} ~ ${String(startId + rowsToInsert.length - 1).padStart(3, '0')}`);
}

appendTCs().catch(e => {
  console.error('❌ 에러:', e.message);
  process.exit(1);
});
