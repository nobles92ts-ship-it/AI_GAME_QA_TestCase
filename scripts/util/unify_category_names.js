#!/usr/bin/env node

/**
 * unify_category_names.js
 * 신규 TC의 분류명을 기존 분류명으로 통일
 */

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { getAuthClient } = require('./google_auth');

const SPREADSHEET_ID = process.argv[2];
const TAB_NAME = process.argv[3];

if (!SPREADSHEET_ID || !TAB_NAME) {
  console.error('사용법: node unify_category_names.js "시트ID" "탭명"');
  process.exit(1);
}

const categoryMap = {
  "1. 진입/기본/탭": "1. 진입 및 기본 구조",
  "3. 강화 재료 선택": "3. 강화 재료",
  "4. 대상 레벨 선택": "4. 강화 레벨",
  "6. 강화 연출/연계": "6. 강화 연출",
  "8. 인벤토리 필터": "8. 인벤토리",
  "10. 토스트 메시지": "10. 토스트",
  "13. 빈 상태 처리": "13. 빈 상태",
  "14. 예외처리/세션": "14. 예외처리"
};

async function unify() {
  const auth = await getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });

  // 시트에서 데이터 읽기
  console.log('[1/2] 시트에서 현재 TC 읽기...');
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${TAB_NAME}'!A:K`
  });

  const [header, ...rows] = result.data.values || [];
  console.log(`  현재 TC: ${rows.length}개`);

  // 분류명 통일
  console.log('[2/2] 분류명 통일 중...');

  const updates = [];
  let changedCount = 0;

  rows.forEach((row, idx) => {
    const major = row[1] || '';
    if (categoryMap[major]) {
      const newMajor = categoryMap[major];
      const rowNum = idx + 2; // 헤더 제외
      updates.push({
        range: `'${TAB_NAME}'!B${rowNum}`,
        values: [[newMajor]]
      });
      changedCount++;
      console.log(`  Row ${rowNum}: "${major}" → "${newMajor}"`);
    }
  });

  // 배치 업데이트
  if (updates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: {
        data: updates,
        valueInputOption: 'USER_ENTERED'
      }
    });
    console.log(`✔ ${changedCount}개 행의 분류명이 통일되었습니다.`);
  } else {
    console.log('✔ 변경할 분류명이 없습니다.');
  }
}

unify().catch(e => {
  console.error('❌ 에러:', e.message);
  process.exit(1);
});
