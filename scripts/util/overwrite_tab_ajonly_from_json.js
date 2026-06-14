/**
 * overwrite_tab_ajonly_from_json.js
 * 기존 탭의 A~J열만 JSON 통합 데이터로 교체한다. K~O열(프로젝트 정보 패널)은 보존.
 * 기록 직전 기존 A:O 전체를 백업 파일로 저장한다.
 *
 * 사용법:
 *   node overwrite_tab_ajonly_from_json.js "탭명" "스프레드시트ID" "JSON경로" "백업경로"
 *
 * JSON 형식: [["대분류","중분류","소분류","검증단계","재현스탭","플랫폼","비고"], ...]
 *   ※ index 4=재현스탭, index 5=플랫폼 (시트 F/G열과 동일 순서)
 */
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { getAuthClient } = require('./google_auth');
const { applyFormatToTab } = require('./apply_format_tab');

const TAB_NAME = process.argv[2];
const SS_ID = process.argv[3];
const JSON_FILE = process.argv[4];
const BACKUP_FILE = process.argv[5];

if (!TAB_NAME || !SS_ID || !JSON_FILE || !BACKUP_FILE) {
  console.error('사용법: node overwrite_tab_ajonly_from_json.js "탭명" "스프레드시트ID" "JSON경로" "백업경로"');
  process.exit(1);
}

(async () => {
  const tcData = JSON.parse(fs.readFileSync(path.resolve(JSON_FILE), 'utf8'));
  console.log(`JSON 로드: ${tcData.length}개 TC`);

  const auth = await getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SS_ID });
  const tab = meta.data.sheets.find(s => s.properties.title === TAB_NAME);
  if (!tab) { console.error(`❌ "${TAB_NAME}" 탭을 찾을 수 없습니다.`); process.exit(1); }

  // ── 백업: 기존 A:O 전체 ──
  const backupRes = await sheets.spreadsheets.values.get({ spreadsheetId: SS_ID, range: `'${TAB_NAME}'!A1:O` });
  const oldRows = backupRes.data.values || [];
  fs.writeFileSync(path.resolve(BACKUP_FILE), JSON.stringify(oldRows, null, 2), 'utf8');
  console.log(`✔ 백업 저장: ${oldRows.length}행 → ${BACKUP_FILE}`);

  // ── A~J 데이터 변환 (분류 dedup, TC ID 수식, 결과열 초기값) ──
  const header = ['TC ID', '대분류', '중분류', '소분류', '검증단계', '재현 스탭', '플랫폼', 'PC 결과', '모바일 결과', '비고'];
  const out = [header];
  let pMaj = '', pMin = '', pSub = '';
  for (const row of tcData) {
    const [maj, min, sub, verif, step, plat, note = ''] = row;
    const dMaj = maj === pMaj ? '' : maj;
    const dMin = min === pMin ? '' : min;
    const dSub = sub === pSub ? '' : sub;
    pMaj = maj; pMin = min; pSub = sub;
    let pc = 'N/A', mo = 'N/A';
    if (plat === 'PC' || plat === 'PC/모바일') pc = '미진행';
    if (plat === '모바일' || plat === 'PC/모바일') mo = '미진행';
    if (note === '추후 구현') { pc = 'N/A'; mo = 'N/A'; } // 빌드 부재 — 검증 불가
    out.push(['=TEXT(ROW()-1,"000")', dMaj, dMin, dSub, verif, step, plat, pc, mo, note]);
  }

  // ── 기존 A2:J{old} clear (헤더 유지 위해 A2부터, K~O는 미접촉) ──
  if (oldRows.length > 1) {
    await sheets.spreadsheets.values.clear({ spreadsheetId: SS_ID, range: `'${TAB_NAME}'!A2:J${oldRows.length}` });
    console.log(`✔ 기존 A2:J${oldRows.length} clear (K~O 보존)`);
  }

  // ── A1:J{new} 기록 ──
  await sheets.spreadsheets.values.update({
    spreadsheetId: SS_ID,
    range: `'${TAB_NAME}'!A1`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: out },
  });
  console.log(`✔ 기록 완료: ${out.length - 1}개 TC (A1:J${out.length})`);

  // ── 서식 적용 (A~J만, 기본기능 회색·드롭다운·조건부서식·필터) ──
  await applyFormatToTab(TAB_NAME, false, SS_ID);

  console.log(`\n✔ "${TAB_NAME}" 탭 통합 완료`);
  console.log(`👉 https://docs.google.com/spreadsheets/d/${SS_ID}/edit`);
})().catch(e => { console.error('에러:', e.message || e); if (e.errors) console.error(JSON.stringify(e.errors, null, 2)); process.exit(1); });
