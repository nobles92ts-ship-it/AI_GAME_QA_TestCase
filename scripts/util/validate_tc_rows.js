// validate_tc_rows.js
// TC 시트 적재 검증 유틸 — C/D/E/F열 (인덱스 2/3/4/5) 결정적 검증
// 단일 소스: ~/.claude/tc-team-v2/skills/tc-생성/tc-생성.md
//
// 사용:
//   const { validatePreWrite, validatePostWrite } = require('./validate_tc_rows.js');
//
//   // 적재 직전
//   const preCheck = validatePreWrite(rows);
//   if (!preCheck.ok) { console.error(preCheck.violations); process.exit(1); }
//
//   // batch update 직후
//   const postCheck = await validatePostWrite(sheets, spreadsheetId, tabName, startRow, rows);
//   if (!postCheck.ok) { console.error(postCheck.violations); process.exit(2); }

const COL_C = 1; // 중분류 (tc_data idx 1, 시트 C열)
const COL_D = 2; // 소분류 (tc_data idx 2, 시트 D열)
const COL_E = 3; // 검증단계 (tc_data idx 3, 시트 E열)
const COL_F = 4; // 재현스탭 (tc_data idx 4, 시트 F열)
const COL_B = 0; // 대분류 (tc_data idx 0, 시트 B열)

// 분류 컬럼(C/D/E)에 동작/동사 표현 금지 — EVAL-19 ①②
// 단어 경계·어미·조사로 한정하여 false positive 차단
// (정당 분류명: "원클릭 결제", "클래스 선택", "터치 컨트롤" 등은 통과)
const FORBIDDEN_VERBS_IN_CATEGORY = [
  /버튼을?\s*클릭/i, /Tab을?\s*클릭/i, /아이콘을?\s*클릭/i,
  /확인을\s/, /선택을\s/, /입력을\s/,
  /눌러서|눌렀을\s|누르면/,
  /드래그하/, /실행하|종료하|시작하/,
  /를\s*클릭/, /을\s*클릭/,
  /합니다$|한다$/,
];

// 재현스탭(F)에 진입 동작 중복 금지 — EVAL-19 ③
const FORBIDDEN_ENTRY_IN_STEP = [
  /HUD에서/,
  /\S+\s*Tab을\s*클릭/,
  /화면\s*진입\s*후\s*\S+화면에서/,
];

function validatePreWrite(rows, opts = {}) {
  const violations = [];
  const allowEmptyCDE = opts.allowEmptyCDE !== false; // 그룹핑 빈 값 기본 허용

  let prevB = '', prevC = '', prevD = '';

  rows.forEach((row, idx) => {
    const b = (row[COL_B] || '').toString().trim(); // 대분류
    const c = (row[COL_C] || '').toString().trim(); // 중분류
    const d = (row[COL_D] || '').toString().trim(); // 소분류
    const f = (row[COL_F] || '').toString().trim(); // 재현스탭
    const lineNo = (opts.startRow || 2) + idx;

    // ① F (재현스탭) 빈 값 — 모든 행 필수
    if (!f) {
      violations.push({ row: lineNo, col: 'F', sev: 'CRITICAL', msg: '재현스탭(F열) 빈 값' });
    }

    // ② B/C/D 빈 값 (그룹 첫 행만 검사)
    if (!allowEmptyCDE) {
      if (!b) violations.push({ row: lineNo, col: 'B', sev: 'CRITICAL', msg: '대분류 빈 값' });
      if (!c) violations.push({ row: lineNo, col: 'C', sev: 'CRITICAL', msg: '중분류 빈 값' });
      if (!d) violations.push({ row: lineNo, col: 'D', sev: 'CRITICAL', msg: '소분류 빈 값' });
    }

    // ③ B/C/D(대/중/소분류) 동사·동작 표현 금지
    [['B', b], ['C', c], ['D', d]].forEach(([col, val]) => {
      if (!val) return;
      for (const re of FORBIDDEN_VERBS_IN_CATEGORY) {
        if (re.test(val)) {
          violations.push({
            row: lineNo, col, sev: 'HIGH',
            msg: `분류에 동작 표현 금지: "${val}" (패턴: ${re})`,
          });
          break;
        }
      }
    });

    // ④ F(재현스탭)에 진입 동작 중복 금지
    if (f) {
      for (const re of FORBIDDEN_ENTRY_IN_STEP) {
        if (re.test(f)) {
          violations.push({
            row: lineNo, col: 'F', sev: 'HIGH',
            msg: `재현스탭에 진입 동작 중복 금지 (패턴: ${re})`,
          });
          break;
        }
      }
    }

    // ⑤ 같은 D(소분류)면 C(중분류)도 동일해야 함
    if (d && d === prevD && c && c !== prevC) {
      violations.push({
        row: lineNo, col: 'C', sev: 'MEDIUM',
        msg: `같은 소분류(${d})인데 중분류 불일치: "${c}" vs 직전 "${prevC}"`,
      });
    }

    if (b) prevB = b;
    if (c) prevC = c;
    if (d) prevD = d;
  });

  return { ok: violations.length === 0, violations, totalRows: rows.length };
}

async function validatePostWrite(sheets, spreadsheetId, tabName, startRow, expectedRows) {
  const endRow = startRow + expectedRows.length - 1;
  // B~G: B=대분류, C=중분류, D=소분류, E=검증단계, F=재현스탭, G=플랫폼 (G는 꼬임 탐지용)
  const range = `'${tabName}'!B${startRow}:G${endRow}`;
  const violations = [];

  const r = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const actual = r.data.values || [];

  if (actual.length !== expectedRows.length) {
    violations.push({
      sev: 'CRITICAL',
      msg: `행 수 불일치: 기대 ${expectedRows.length} / 실제 ${actual.length} — 병합셀로 인한 행 손실 의심`,
    });
    return { ok: false, violations };
  }

  expectedRows.forEach((row, idx) => {
    const lineNo = startRow + idx;
    // tc_data: [대분류(0), 중분류(1), 소분류(2), 검증단계(3), 재현스탭(4), 플랫폼(5), 비고(6)]
    const expC = (row[COL_C] || '').toString().trim(); // 중분류(1)
    const expD = (row[COL_D] || '').toString().trim(); // 소분류(2)
    const expE = (row[COL_E] || '').toString().trim(); // 검증단계(3)
    const expF = (row[COL_F] || '').toString().trim(); // 재현스탭(4)

    // B:G range → actRow[0]=B=대분류, [1]=C=중분류, [2]=D=소분류, [3]=E=검증단계, [4]=F=재현스탭, [5]=G=플랫폼
    const actRow = actual[idx] || [];
    const actC = (actRow[1] || '').toString().trim(); // C=중분류
    const actD = (actRow[2] || '').toString().trim(); // D=소분류
    const actE = (actRow[3] || '').toString().trim(); // E=검증단계
    const actF = (actRow[4] || '').toString().trim(); // F=재현스탭
    const actG = (actRow[5] || '').toString().trim(); // G=플랫폼 (꼬임 탐지)

    // C/D는 그룹핑 dedup으로 인해 같은 그룹 2번째 이후 행은 빈 값 정상 (빈 값이면 비교 skip)
    if (actC !== '' && expC !== actC) violations.push({ row: lineNo, col: 'C', sev: 'CRITICAL', msg: `C 불일치: 기대 "${expC}" / 실제 "${actC}"` });
    if (actD !== '' && expD !== actD) violations.push({ row: lineNo, col: 'D', sev: 'CRITICAL', msg: `D 불일치: 기대 "${expD}" / 실제 "${actD}"` });
    if (actE !== '' && expE !== actE) violations.push({ row: lineNo, col: 'E', sev: 'CRITICAL', msg: `E 불일치: 기대 "${expE}" / 실제 "${actE}"` });
    if (expF !== actF) violations.push({ row: lineNo, col: 'F', sev: 'CRITICAL', msg: `F 불일치: 기대 "${expF}" / 실제 "${actF}"` });

    // F가 G로 침범했는지 — 컬럼 꼬임 패턴 (2026-04-17 사고)
    if (actG && /^(클릭|확인|입력|이동|진입)/.test(actG) === false &&
        actG.length > 30 && /[가-힣]/.test(actG)) {
      violations.push({
        row: lineNo, col: 'G', sev: 'CRITICAL',
        msg: `G열에 긴 한글 문장 적재 — F→G 컬럼 꼬임 의심: "${actG.slice(0, 40)}..."`,
      });
    }
  });

  return { ok: violations.length === 0, violations, totalRows: expectedRows.length };
}

function formatViolations(violations) {
  return violations.map(v => {
    const loc = v.row ? `행 ${v.row} ${v.col}` : '전체';
    return `  [${v.sev}] ${loc} — ${v.msg}`;
  }).join('\n');
}

module.exports = { validatePreWrite, validatePostWrite, formatViolations };
