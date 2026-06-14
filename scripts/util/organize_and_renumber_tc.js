#!/usr/bin/env node

/**
 * organize_and_renumber_tc.js
 * 시트의 TC들을 분류별로 정렬하고 ID를 재부여하는 스크립트
 *
 * 사용법:
 *   node organize_and_renumber_tc.js "시트ID" "탭명" "출력JSON경로"
 */

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { getAuthClient } = require('./google_auth');

const SPREADSHEET_ID = process.argv[2];
const TAB_NAME = process.argv[3];
const OUTPUT_JSON = process.argv[4];

if (!SPREADSHEET_ID || !TAB_NAME || !OUTPUT_JSON) {
  console.error('사용법: node organize_and_renumber_tc.js "시트ID" "탭명" "출력JSON경로"');
  process.exit(1);
}

async function organize() {
  const auth = await getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });

  // 시트에서 현재 데이터 읽기
  console.log('[1/3] 시트에서 현재 TC 읽기...');
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${TAB_NAME}'!A:K`
  });

  const [header, ...rows] = result.data.values || [];
  console.log(`  현재 TC: ${rows.length}개 (헤더 포함)`);

  // TC 파싱 (A~J 컬럼)
  const tcs = rows.map(row => ({
    id: row[0] || '',
    major: row[1] || '',
    minor: row[2] || '',
    sub: row[3] || '',
    verif: row[4] || '',
    step: row[5] || '',
    platform: row[6] || '',
    pcResult: row[7] || '',
    mbResult: row[8] || '',
    note: row[9] || ''
  }));

  // 분류 정렬 순서 정의 (기존 시트 기준)
  const categoryOrder = [
    '기본기능',
    '1. 진입 및 기본 구조',
    '2. 강화 조건 체크',
    '3. 강화 재료',
    '4. 강화 레벨',
    '5. 강화 구간',
    '6. 강화 연출',
    '7. 강화 결과',
    '8. 인벤토리',
    '9. 단일 UI',
    '10. 토스트',
    '11. 테이블',
    '12. 다중 강화',
    '13. 빈 상태',
    '14. 예외처리'
  ];

  // 2단계: 분류별 그룹핑
  console.log('[2/3] 분류별 그룹핑 중...');

  const organized = {};
  categoryOrder.forEach(cat => { organized[cat] = []; });

  tcs.forEach(tc => {
    const cat = tc.major;
    if (!organized[cat]) {
      organized[cat] = [];
    }
    organized[cat].push(tc);
  });

  // 정렬된 순서로 평탄화
  const sortedTCs = [];
  categoryOrder.forEach(cat => {
    if (organized[cat] && organized[cat].length > 0) {
      sortedTCs.push(...organized[cat]);
    }
  });

  // 기타 분류 추가 (categoryOrder에 없는 것들)
  Object.keys(organized).forEach(cat => {
    if (!categoryOrder.includes(cat) && organized[cat].length > 0) {
      console.warn(`  ⚠ 예상 밖의 분류: "${cat}"`);
      sortedTCs.push(...organized[cat]);
    }
  });

  // 3단계: TC ID 재부여 및 분류 중복 제거
  console.log('[3/3] TC ID 재부여 및 분류 정렬 중...');

  let prevMajor = '', prevMinor = '', prevSub = '';
  const finalRows = sortedTCs.map((tc, idx) => {
    const newId = String(idx + 1).padStart(3, '0');
    const displayMajor = tc.major === prevMajor ? '' : tc.major;
    const displayMinor = (tc.minor === prevMinor && tc.major === prevMajor) ? '' : tc.minor;
    const displaySub = (tc.sub === prevSub && tc.minor === prevMinor && tc.major === prevMajor) ? '' : tc.sub;

    prevMajor = tc.major;
    prevMinor = tc.minor;
    prevSub = tc.sub;

    return [newId, displayMajor, displayMinor, displaySub, tc.verif, tc.step, tc.platform, tc.pcResult, tc.mbResult, tc.note, ''];
  });

  // 결과를 JSON으로 저장
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(finalRows, null, 2));

  console.log(`✔ 정렬 완료: ${finalRows.length}개 행`);
  console.log(`✔ JSON 저장: ${OUTPUT_JSON}`);

  // 분류별 통계
  console.log('\n=== 분류별 TC 수 ===');
  const stats = {};
  finalRows.forEach(row => {
    if (row[1]) { // 대분류가 있으면
      if (!stats[row[1]]) stats[row[1]] = 0;
      stats[row[1]]++;
    }
  });

  Object.keys(stats).forEach(cat => {
    console.log(`  ${cat}: ${stats[cat]}개`);
  });

  return finalRows;
}

organize().catch(e => {
  console.error('❌ 에러:', e.message);
  process.exit(1);
});
