/**
 * create_xlsx_tc_from_json.js — tc_data.json 을 로컬 .xlsx 로 출력 (Google Sheets 불필요)
 *
 * create_gsheet_tc_from_json.js 와 동일한 행 구성(TC ID 자동·머지다운 빈칸·
 * expectedHI 로 PC/모바일 결과)을 그대로 복제하되, 시트 업로드 대신 로컬 엑셀 파일로 저장한다.
 * 이미 설치된 의존성(xlsx)만 사용하므로 OAuth/구글 설정이 전혀 필요 없다.
 *
 * 입력 tc_data.json: [["대분류","중분류","소분류","검증단계","재현스탭","플랫폼","비고(optional)"], ...]
 *   ※ 헤더 행 포함 금지 — 데이터 행만.
 *
 * 사용법:
 *   node create_xlsx_tc_from_json.js "기능명" "출력경로.xlsx" "tc_data.json경로"
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { expectedHI } = require('./validate_tc_rows');

const FEATURE   = process.argv[2];
const OUT_PATH  = process.argv[3];
const JSON_FILE = process.argv[4];

if (!FEATURE || !OUT_PATH || !JSON_FILE) {
  console.error('사용법: node create_xlsx_tc_from_json.js "기능명" "출력경로.xlsx" "tc_data.json경로"');
  process.exit(1);
}

let tcData;
try {
  tcData = JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
} catch (e) {
  console.error(`[ERROR] tc_data.json 읽기 실패: ${e.message}`);
  process.exit(2);
}
if (!Array.isArray(tcData) || tcData.length === 0) {
  console.error('[ERROR] tc_data.json 이 비었거나 배열이 아닙니다.');
  process.exit(3);
}

const header = ['TC ID', '대분류', '중분류', '소분류', '검증단계', '재현 스탭', '플랫폼', 'PC 결과', '모바일 결과', '비고', '담당자'];
const rows = [header];
let prevMajor = '', prevMinor = '', prevSub = '';

for (let i = 0; i < tcData.length; i++) {
  const [major, minor, sub, verif, step, platform, note = ''] = tcData[i];
  const id = String(i + 1).padStart(3, '0');           // 시트의 =TEXT(ROW()-1,"000") 와 동일 표기
  const dMajor = major === prevMajor ? '' : major;
  const dMinor = minor === prevMinor ? '' : minor;
  const dSub   = sub === prevSub ? '' : sub;
  prevMajor = major; prevMinor = minor; prevSub = sub;
  const hi = expectedHI(note, platform, major === '기본기능');  // PC/모바일 결과 — 시트와 동일 규칙
  rows.push([id, dMajor, dMinor, dSub, verif, step, platform, hi.h, hi.i, note, '']);
}

const ws = XLSX.utils.aoa_to_sheet(rows);
ws['!cols'] = [
  { wch: 7 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 9 },
  { wch: 64 }, { wch: 10 }, { wch: 9 }, { wch: 11 }, { wch: 16 }, { wch: 9 },
];
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, String(FEATURE).replace(/[\\/?*\[\]:]/g, '_').substring(0, 31) || 'TC');

const outDir = path.dirname(path.resolve(OUT_PATH));
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
XLSX.writeFile(wb, OUT_PATH);
console.log(`[OK] ${tcData.length}개 TC → ${path.resolve(OUT_PATH)}`);
