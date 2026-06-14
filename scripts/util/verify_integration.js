const { google } = require('googleapis');
const { getAuthClient } = require('./google_auth');
const fs = require('fs');

const SS = process.argv[2], TAB = process.argv[3], BACKUP = process.argv[4];

(async () => {
  const auth = await getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SS, range: `'${TAB}'!A1:O` });
  const rows = res.data.values || [];
  const backup = JSON.parse(fs.readFileSync(BACKUP, 'utf8'));

  console.log('=== 통합 결과 검증 ===');
  console.log('총 행:', rows.length, '(기대 119 = 헤더+118)');

  // TC ID 연속성
  const ids = rows.slice(1).map(r => r[0]);
  const expected = ids.map((_, i) => String(i + 1).padStart(3, '0'));
  const idOk = ids.every((v, i) => v === expected[i]);
  console.log('TC ID 001~%s 연속:', ids[ids.length - 1], idOk ? 'OK' : '❌ 불일치');

  // 대분류
  const majors = [...new Set(rows.slice(1).map(r => r[1]).filter(Boolean))];
  console.log('대분류:', JSON.stringify(majors));

  // 기본기능 섹션 경계
  console.log('첫 데이터 B열:', rows[1][1], '| 27번째 TC B열:', rows[27][1]);

  // K~O 패널 보존 (행 1~8, 열 K=10~O=14)
  let panelOk = true, diffs = [];
  for (let i = 0; i < 8; i++) {
    for (let c = 10; c <= 14; c++) {
      const now = (rows[i] && rows[i][c]) || '';
      const old = (backup[i] && backup[i][c]) || '';
      if (now !== old) { panelOk = false; diffs.push(`행${i + 1}열${c}: "${old}"→"${now}"`); }
    }
  }
  console.log('K~O 패널 보존:', panelOk ? 'OK' : '❌ ' + diffs.join(' / '));

  // 추후 구현 행 H/I=N/A
  const future = rows.slice(1).filter(r => (r[9] || '') === '추후 구현');
  console.log('추후 구현 건수:', future.length, '| H/I 모두 N/A:',
    future.every(r => r[7] === 'N/A' && r[8] === 'N/A') ? 'OK' : '❌');

  // 기획 확인 필요 건수
  const needCheck = rows.slice(1).filter(r => (r[9] || '') === '기획 확인 필요').length;
  console.log('기획 확인 필요 건수:', needCheck);
})().catch(e => { console.error('에러:', e.message || e); process.exit(1); });
