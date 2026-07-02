// validate_tc_rows.js
// TC 검증 룰 단일 소스(SSoT) — 결정적(기계) 검증 전부 이 파일 한 곳에 정의
// 단일 소스: ~/.claude/skills/tc-생성/tc-생성.md (V-항목) + tc-리뷰.md (EVAL 기계부)
//
// 구성:
//   [기존 호환] validatePreWrite(rows)        — tc_data 적재 직전 검증 (writer/create_gsheet)
//   [기존 호환] validatePostWrite(...)        — batch update 직후 read-back 대조
//   [Phase1 신규] expectedHI(j, platform, isBasic) — H/I 기대값 단일 순수함수 (L4-01)
//   [Phase1 신규] adaptInput(filePath)        — tc_data/슬림/풀 덤프 3형상 → 캐노니컬 레코드 (L4-03)
//   [Phase1 신규] fillDownRecords(records)    — B/C/D forward-fill 정규화 (L4-02)
//   [Phase1 신규] parseDesignTables(path)     — tc_design.md 배분표/GlobalDefine 표 파서 (L3-8)
//   [Phase1 신규] validateFull(file, opts)    — V-항목 기계부 일괄 판정 (writer 자가검증 대체)
//
// 공통 안전 원칙 (재검증 합의):
//   - 판정불가(파싱 실패·표 미발견·capability 부족)는 silent pass 금지 — llmFlags로 명시 출력
//   - 차단 게이트는 CRITICAL/HIGH만 (MEDIUM/LOW는 경고) — L4-06
//   - 연속성·조인 키는 fill-down 후 (대,중,소) 튜플 — L4-07
//
// CLI:
//   node validate_tc_rows.js --full <tc_data|스냅샷.json> [--design <tc_design.md>]
//     → 판정 JSON stdout / exit 0=PASS, 4=차단 위반 있음, 1=치명(입력 불능)

const fs = require('fs');
const path = require('path');

const COL_C = 1; // 중분류 (tc_data idx 1, 시트 C열)
const COL_D = 2; // 소분류 (tc_data idx 2, 시트 D열)
const COL_E = 3; // 검증단계 (tc_data idx 3, 시트 E열)
const COL_F = 4; // 재현스탭 (tc_data idx 4, 시트 F열)
const COL_B = 0; // 대분류 (tc_data idx 0, 시트 B열)

const PLATFORM_ENUM = ['PC', '모바일', 'PC/모바일'];
const STAGE_ENUM = ['정상', '부정', '예외'];
// J열 화이트리스트 — 리터럴 4종 + 버그ID 패턴 (플레이스홀더 '버그ID-XXXX' 자체는 위반 — L4-09)
const J_WHITELIST = ['', '추후 구현', '구현 우선순위 낮음', '기획 확인 필요'];
const J_버그ID_RE = /^버그ID-\d+$/;

// 분류 컬럼(B/C/D)에 동작/동사 표현 금지 — EVAL-19 ①②
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

// F열 추상 표현 금지어 — V-05 기계부
const ABSTRACT_IN_STEP = /정상\s*동작|정상적으로|올바르게/;
// F열 내부 설계 태그 잔류 — V-22 (tc-생성.md 명시 정규식)
const DESIGN_TAGS_IN_STEP = [
  /\((ST|DT|C|B)-\d+(\s*#\d+)*\)/,
  /\(§\d+-\d+\)/,
  /`[A-Za-z_]+`\(미지정\)/,
];
// F열 복합 기대결과 후보 — V-15 기계부 (추출만, 분류는 LLM)
const COMPOUND_RESULT_RE = /되고[^.\n]{0,40}되는지|되며[^.\n]{0,40}되는지/;

// F열 번호 다단계/태그 분리 표기 — V-05 의미부 기계화 (2026-06-11 v8 사고: 201행 전부 번호 형식)
// "1. " 시작 = 다단계 번호 서술 (소수점 "1.5초"는 점 뒤 공백이 없어 미매칭 — 오탐 안전)
const NUMBERED_STEP_RE = /^\s*\d+\.\s/;
const TAG_SPLIT_RE = /\[(사전\s*조건|사전\s*상태|행동|기대\s*결과)\]/;
// 플랫폼 분리쌍 정규화 — 조작 단어 치환(클릭↔탭)만 다른 동일 문장 검출용 (v8 사고: 90쌍)
function normFForPlatform(t) {
  return s(t).replace(/PC|모바일|마우스|터치|클릭|탭/g, '').replace(/\s+/g, '');
}

function s(v) { return (v === null || v === undefined) ? '' : String(v).trim(); }
function normJ(v) { return s(v); }

function isJAllowed(j) {
  const n = normJ(j);
  if (J_WHITELIST.includes(n)) return true;
  return J_버그ID_RE.test(n);
}

/**
 * H/I(PC 결과/모바일 결과) 기대값 단일 순수함수 — L4-01
 * 생성(create_gsheet)과 검증(validateFull/precheck)이 반드시 이 함수를 공유한다.
 *  - 기본기능 행: G=PC 강제 전제 → H=미진행, I=N/A
 *  - J='추후 구현': 플랫폼 무관 H/I 모두 N/A
 *  - 그 외(빈값·구현 우선순위 낮음·기획 확인 필요·버그ID-####):
 *    플랫폼 파생 — PC 포함 시 H=미진행 아니면 N/A / 모바일 포함 시 I=미진행 아니면 N/A
 */
function expectedHI(j, platform, isBasic) {
  const jn = normJ(j);
  if (jn === '추후 구현') return { h: 'N/A', i: 'N/A' };
  const p = s(platform);
  if (isBasic) return { h: '미진행', i: 'N/A' };
  return {
    h: (p === 'PC' || p === 'PC/모바일') ? '미진행' : 'N/A',
    i: (p === '모바일' || p === 'PC/모바일') ? '미진행' : 'N/A',
  };
}

// ── 기존 호환 API ───────────────────────────────────────────────────────────

function hasBlocking(violations) {
  return violations.some(v => v.sev === 'CRITICAL' || v.sev === 'HIGH');
}

function validatePreWrite(rows, opts = {}) {
  const violations = [];
  const allowEmptyCDE = opts.allowEmptyCDE !== false; // 그룹핑 빈 값 기본 허용

  // (B,C,D) 튜플 비인접 재등장 검출용 — L4-07 (같은 D가 다른 C 아래 재등장하는 건 합법)
  const lastSeen = new Map(); // tupleKey → 마지막 등장 idx
  let fb = '', fc = '', fd = ''; // fill-down 추적
  const platRows = []; // 플랫폼 분리쌍 검출용 수집 (v8 사고)

  rows.forEach((row, idx) => {
    const b = s(row[COL_B]);
    const c = s(row[COL_C]);
    const d = s(row[COL_D]);
    const e = s(row[COL_E]);
    const f = s(row[COL_F]);
    const g = s(row[5]);
    const lineNo = (opts.startRow || 2) + idx;

    // ① F (재현스탭) 빈 값 — 모든 행 필수
    if (!f) {
      violations.push({ row: lineNo, col: 'F', sev: 'CRITICAL', msg: '재현스탭(F열) 빈 값' });
    }

    // ①-2 검증단계/플랫폼 enum — 컬럼 꼬임(idx4↔idx5 스왑)도 여기서 기계 검출됨
    //   (스왑 시 G에 한글 서술문이 들어와 enum 위반 — 2026-04-17 사고 유형의 사전 차단)
    if (e && !STAGE_ENUM.includes(e)) {
      violations.push({ row: lineNo, col: 'E', sev: 'HIGH', msg: `검증단계 "${e}" — 허용값(정상/부정/예외) 외` });
    }
    if (g && !PLATFORM_ENUM.includes(g)) {
      violations.push({ row: lineNo, col: 'G', sev: 'HIGH', msg: `플랫폼 "${g.slice(0, 30)}" — 허용값(PC/모바일/PC/모바일) 외 (idx4↔5 스왑 의심)` });
    }

    // ② B/C/D 빈 값 (옵션)
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

    // ④-2 F 번호 다단계/태그 분리 표기 금지 — 단일 서술문 위반 (V-05 의미부 기계화, v8 사고)
    if (f && (NUMBERED_STEP_RE.test(f) || TAG_SPLIT_RE.test(f))) {
      violations.push({
        row: lineNo, col: 'F', sev: 'HIGH',
        msg: '재현스탭 번호 매김("1.~ 2.~")/태그 분리 표기 — 개행 없는 단일 서술문으로 통합 필요 (V-05)',
      });
    }

    // ⑤ 그룹 분산: 동일 (B,C,D) 튜플이 비인접 위치에 재등장 — V-17/EVAL-06
    //    (구버전 "같은 D면 C 동일" 규칙은 폐기 — 다른 중분류 아래 같은 소분류 재사용은 합법, L4-06)
    if (b || fb) { fb = b || fb; fc = c || fc; fd = d || fd; }
    const key = `${fb}|${fc}|${fd}`;
    if (fd) {
      if (lastSeen.has(key) && lastSeen.get(key) !== idx - 1) {
        violations.push({
          row: lineNo, col: 'B~D', sev: 'HIGH',
          msg: `분류 그룹 분산: (${fb} > ${fc} > ${fd})이 행 ${(opts.startRow || 2) + lastSeen.get(key)} 이후 비인접 재등장 (V-17)`,
        });
      }
      lastSeen.set(key, idx);
    }

    platRows.push({ lineNo, key: `${fb}|${fc}|${fd}|${e}`, g, f });
  });

  // ⑥ 플랫폼 분리 중복 (V-07d — v8 사고: 동일 내용 PC/모바일 2행 분리 90쌍)
  //    같은 (대,중,소,검증단계) 그룹에서 G=PC 행과 G=모바일 행의 F가 조작 단어 정규화 후
  //    동일하면 분리 사유 없는 중복 — G="PC/모바일" 한 행으로 병합 대상 (HIGH 차단)
  const byKey = new Map();
  for (const r of platRows) {
    if (!byKey.has(r.key)) byKey.set(r.key, []);
    byKey.get(r.key).push(r);
  }
  for (const list of byKey.values()) {
    const pcs = list.filter(x => x.g === 'PC');
    const mos = list.filter(x => x.g === '모바일');
    for (const a of pcs) {
      for (const b of mos) {
        if (a.f && normFForPlatform(a.f) === normFForPlatform(b.f)) {
          violations.push({
            row: b.lineNo, col: 'G', sev: 'HIGH',
            msg: `행 ${a.lineNo}↔${b.lineNo} 동일 내용 PC/모바일 분리 — 조작 차이 서술이 없으면 G="PC/모바일" 한 행으로 병합 (V-07d)`,
          });
        }
      }
    }
  }

  // 차단 게이트: CRITICAL/HIGH만 — MEDIUM/LOW는 경고 (L4-06)
  return { ok: !hasBlocking(violations), violations, totalRows: rows.length };
}

async function validatePostWrite(sheets, spreadsheetId, tabName, startRow, expectedRows) {
  const endRow = startRow + expectedRows.length - 1;
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
    const expC = s(row[COL_C]);
    const expD = s(row[COL_D]);
    const expE = s(row[COL_E]);
    const expF = s(row[COL_F]);

    const actRow = actual[idx] || [];
    const actC = s(actRow[1]);
    const actD = s(actRow[2]);
    const actE = s(actRow[3]);
    const actF = s(actRow[4]);
    const actG = s(actRow[5]);

    if (actC !== '' && expC !== actC) violations.push({ row: lineNo, col: 'C', sev: 'CRITICAL', msg: `C 불일치: 기대 "${expC}" / 실제 "${actC}"` });
    if (actD !== '' && expD !== actD) violations.push({ row: lineNo, col: 'D', sev: 'CRITICAL', msg: `D 불일치: 기대 "${expD}" / 실제 "${actD}"` });
    if (actE !== '' && expE !== actE) violations.push({ row: lineNo, col: 'E', sev: 'CRITICAL', msg: `E 불일치: 기대 "${expE}" / 실제 "${actE}"` });
    if (expF !== actF) violations.push({ row: lineNo, col: 'F', sev: 'CRITICAL', msg: `F 불일치: 기대 "${expF}" / 실제 "${actF}"` });

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
    const loc = v.row ? `행 ${v.row} ${v.col || ''}`.trim() : '전체';
    return `  [${v.sev}] ${loc} — ${v.msg}`;
  }).join('\n');
}

// ── 입력 어댑터 (L4-03) ──────────────────────────────────────────────────────
// 3형상 → 캐노니컬 레코드 {sheetRow, id, B..G, H, I, J} + capability 플래그
//   (a) tc_data.json: 최상위 7요소 배열 — ID/H/I 없음
//   (b) 슬림 스냅샷: {headers(10), rows} — 고정 패딩
//   (c) 풀 덤프: {headers(11), rows} — ragged (트레일링 빈 셀 탈락)

function adaptInput(filePath) {
  const { loadSnapshot } = require('./load_snapshot.js');
  const ls = loadSnapshot(filePath);
  if (!ls.ok) return { ok: false, error: ls.error };
  const data = ls.data;
  const records = [];
  const notes = [];
  let caps;

  if (data && Array.isArray(data.headers) && Array.isArray(data.rows)) {
    // 시트 덤프 — 헤더명 기반 컬럼 매핑 (인덱스 상수 금지: 형상별 시프트 방지)
    const h = data.headers.map(x => s(x));
    const ix = (name) => h.findIndex(x => x.includes(name));
    const map = {
      id: ix('TC ID'), B: ix('대분류'), C: ix('중분류'), D: ix('소분류'),
      E: ix('검증단계'), F: ix('재현'), G: ix('플랫폼'),
      H: ix('PC 결과'), I: ix('모바일'), J: ix('비고'),
    };
    caps = { source: 'snapshot', hasID: map.id >= 0, hasHI: map.H >= 0 && map.I >= 0 };
    data.rows.forEach((r, i) => {
      const row = Array.isArray(r) ? r : [];
      const cell = (k) => (map[k] >= 0 ? s(row[map[k]]) : '');
      const rec = {
        sheetRow: i + 2, id: cell('id'),
        B: cell('B'), C: cell('C'), D: cell('D'), E: cell('E'),
        F: cell('F'), G: cell('G'), H: cell('H'), I: cell('I'), J: cell('J'),
      };
      if (rec.id === 'TC ID' || rec.B === '대분류') { notes.push(`행 ${rec.sheetRow}: 중복 헤더 행 스킵`); return; }
      if (!rec.id && !rec.B && !rec.C && !rec.D && !rec.E && !rec.F) { notes.push(`행 ${rec.sheetRow}: 빈 행 스킵`); return; }
      records.push(rec);
    });
  } else if (data && Array.isArray(data.rows)) {
    // 헤더 없는 rows 객체 — fixer 산출 tc_after_fix[N].json ({tab, savedAt, totalRows, rows})
    // 행이 A열(TC ID)부터 위치 고정: [id, B, C, D, E, F, G, H, I, J, 담당자] (트레일링 ragged)
    // 행 길이 중앙값으로 ID 포함 여부 판별 (≥8 → 시트 위치 레이아웃, 아니면 tc_data 7요소로 간주)
    const sample = data.rows.filter(Array.isArray).slice(0, 10).map(r => r.length).sort((a, b) => a - b);
    const median = sample.length ? sample[Math.floor(sample.length / 2)] : 0;
    const positional = median >= 8;
    caps = { source: positional ? 'fix_dump' : 'tc_data', hasID: positional, hasHI: positional };
    const off = positional ? 1 : 0; // ID열 유무에 따른 오프셋
    data.rows.forEach((r, i) => {
      const row = Array.isArray(r) ? r : [];
      const rec = {
        sheetRow: i + 2, id: positional ? s(row[0]) : '',
        B: s(row[off + 0]), C: s(row[off + 1]), D: s(row[off + 2]), E: s(row[off + 3]),
        F: s(row[off + 4]), G: s(row[off + 5]),
        H: positional ? s(row[7]) : '', I: positional ? s(row[8]) : '', J: s(row[off + 6 + (positional ? 2 : 0)]),
      };
      if (rec.id === 'TC ID' || rec.B === '대분류') { notes.push(`행 ${rec.sheetRow}: 중복 헤더 행 스킵`); return; }
      if (!rec.id && !rec.B && !rec.C && !rec.D && !rec.E && !rec.F) { notes.push(`행 ${rec.sheetRow}: 빈 행 스킵`); return; }
      records.push(rec);
    });
  } else if (Array.isArray(data)) {
    caps = { source: 'tc_data', hasID: false, hasHI: false };
    data.forEach((r, i) => {
      const row = Array.isArray(r) ? r : [];
      records.push({
        sheetRow: i + 2, id: '',
        B: s(row[0]), C: s(row[1]), D: s(row[2]), E: s(row[3]),
        F: s(row[4]), G: s(row[5]), H: '', I: '', J: s(row[6]),
      });
    });
  } else {
    return { ok: false, error: 'unknown_shape: headers+rows도, rows 객체도, 최상위 배열도 아님' };
  }

  return { ok: true, records, caps, notes };
}

// B/C/D forward-fill — L4-02 (불변: 새 배열 반환)
function fillDownRecords(records) {
  let fb = '', fc = '', fd = '';
  let hadBlanks = false;
  const out = records.map(r => {
    if (!r.B || !r.C || !r.D) hadBlanks = true;
    fb = r.B || fb; fc = r.C || fc; fd = r.D || fd;
    return { ...r, B: fb, C: fc, D: fd, rawB: r.B, rawC: r.C, rawD: r.D };
  });
  return { records: out, hadBlanks };
}

// ── tc_design.md 표 파서 (L3-8) ─────────────────────────────────────────────
// 표 탐지는 섹션 헤딩 기반, 칼럼 매칭은 부분일치, bold(**) strip, 구분선·합계행 skip.
// 표 미발견/파싱 불능 → null 반환 (호출측이 llmFlag 출력 — silent pass 금지)

function stripMd(cell) { return s(cell).replace(/\*\*/g, '').replace(/`/g, ''); }

function extractTableAfter(lines, headingRe) {
  const hIdx = lines.findIndex(l => headingRe.test(l));
  if (hIdx < 0) return null;
  let i = hIdx + 1;
  while (i < lines.length && !lines[i].trim().startsWith('|')) {
    // 표가 헤딩 직후 20줄 안에 없으면 미발견 처리
    if (i - hIdx > 20) return null;
    i++;
  }
  if (i >= lines.length) return null;
  const tbl = [];
  while (i < lines.length && lines[i].trim().startsWith('|')) {
    tbl.push(lines[i].trim());
    i++;
  }
  if (tbl.length < 2) return null;
  const parseRow = (line) => line.replace(/^\||\|$/g, '').split('|').map(stripMd);
  const header = parseRow(tbl[0]);
  const rows = tbl.slice(1)
    .filter(l => !/^[\s|:\-]+$/.test(l)) // 구분선
    .map(parseRow);
  return { header, rows };
}

function parseDesignTables(designPath) {
  let text;
  try {
    text = fs.readFileSync(designPath, 'utf8');
  } catch (e) {
    return { ok: false, error: 'design_read_fail: ' + e.message };
  }
  const lines = text.split('\n');
  const result = { ok: true, allocation: null, globalKeys: null, notes: [] };

  // ① 검증단계 사전 배분표
  const alloc = extractTableAfter(lines, /검증단계\s*사전\s*배분표/);
  if (alloc) {
    const ix = (name) => alloc.header.findIndex(c => c.includes(name));
    const m = {
      B: ix('대분류'), C: ix('중분류'), D: ix('소분류'), risk: ix('리스크'),
      normal: ix('정상'), neg: ix('부정'), exc: ix('예외'), note: ix('비고'),
    };
    if (m.D < 0 || m.normal < 0) {
      result.notes.push('배분표 헤더 매핑 실패 — LLM 폴백 필요');
    } else {
      const entries = [];
      let fb = '', fc = '';
      for (const row of alloc.rows) {
        const cell = (k) => (m[k] >= 0 ? s(row[m[k]]) : '');
        const bRaw = cell('B'), cRaw = cell('C'), d = cell('D');
        fb = bRaw || fb; fc = cRaw || fc;
        if (!d || /합계|소계/.test(bRaw + cRaw + d)) { result.notes.push(`배분표 행 스킵: ${bRaw || fb}|${d || '(빈 소분류)'}`); continue; }
        const num = (k) => {
          const v = cell(k).replace(/[^\d]/g, '');
          return v === '' ? null : parseInt(v, 10);
        };
        entries.push({
          B: fb, C: fc, D: d, risk: cell('risk'),
          normal: num('normal'), neg: num('neg'), exc: num('exc'),
          note: cell('note'),
        });
      }
      result.allocation = entries;
    }
  } else {
    result.notes.push('배분표 미발견 — LLM 폴백 필요');
  }

  // ② GlobalDefine 키 표 — 헤더 '키' 부분일치 ('키(추정)' 변형 허용, L3-8)
  const gd = extractTableAfter(lines, /GlobalDefine/);
  if (gd) {
    const keyIdx = gd.header.findIndex(c => c.includes('키'));
    if (keyIdx >= 0) {
      result.globalKeys = gd.rows
        .map(r => s(r[keyIdx]))
        .filter(k => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k));
    } else {
      result.notes.push('GlobalDefine 표 키 칼럼 미발견');
    }
  }

  return result;
}

// ── validateFull — V-항목 기계부 일괄 판정 ──────────────────────────────────
// 기본기능 행: 일반 품질 룰 제외, V-16 전용 검사 적용 (tc-리뷰.md 기본기능 제외 규칙)

function validateFull(filePath, opts = {}) {
  const ad = adaptInput(filePath);
  if (!ad.ok) return { ok: false, fatal: ad.error };
  const caps = ad.caps;
  const fd = fillDownRecords(ad.records);
  const records = fd.records;
  const violations = [];
  const llmFlags = [];
  const notes = [...ad.notes];

  // 계약: tc_data는 전 행 채움 (L4-02 — tc-생성.md 단일 관례)
  if (caps.source === 'tc_data' && fd.hadBlanks) {
    violations.push({ sev: 'HIGH', rule: 'CONTRACT', msg: 'tc_data 전 행 채움 계약 위반 — B/C/D 빈 칸 발견 (dedup은 시트 표시 규칙, tc_data는 풀 값). fill-down 후 평가는 계속함' });
  }

  const lastSeen = new Map(); // (B,C,D) 튜플 분산 검출
  const subStats = new Map(); // 튜플 → {정상,부정,예외, risk?}
  const idNums = [];

  records.forEach((r, i) => {
    const loc = caps.hasID && r.id ? `TC-${r.id}` : `행 ${r.sheetRow}`;
    const isBasic = r.B === '기본기능';

    // V-04 검증단계 enum
    if (r.E && !STAGE_ENUM.includes(r.E)) {
      violations.push({ sev: 'HIGH', rule: 'V-04', row: r.sheetRow, msg: `${loc} 검증단계 "${r.E}" — 허용값(정상/부정/예외) 외` });
    }
    // V-03 플랫폼 enum
    if (r.G && !PLATFORM_ENUM.includes(r.G)) {
      violations.push({ sev: 'HIGH', rule: 'V-03', row: r.sheetRow, msg: `${loc} 플랫폼 "${r.G}" — 허용값(PC/모바일/PC/모바일) 외` });
    }
    // V-05 의미부: 번호 다단계/태그 분리 — 전 행 대상 서식 계약 (기본기능 포함, v8 사고)
    if (r.F && (NUMBERED_STEP_RE.test(r.F) || TAG_SPLIT_RE.test(r.F))) {
      violations.push({ sev: 'HIGH', rule: 'V-05', row: r.sheetRow, msg: `${loc} F열 번호 매김("1.~ 2.~")/태그 분리 표기 — 단일 서술문 위반` });
    }

    // V-19 J 화이트리스트
    if (!isJAllowed(r.J)) {
      violations.push({ sev: 'HIGH', rule: 'V-19', row: r.sheetRow, msg: `${loc} J열 "${r.J}" — 화이트리스트 외${normJ(r.J) === '버그ID-XXXX' ? ' (플레이스홀더 리터럴 금지)' : ''}` });
    }
    // V-20/V-09 H/I 정합 (시트 덤프만)
    if (caps.hasHI) {
      const exp = expectedHI(r.J, r.G, isBasic);
      if (r.H !== exp.h || r.I !== exp.i) {
        violations.push({ sev: 'HIGH', rule: 'V-20', row: r.sheetRow, msg: `${loc} H/I "${r.H}/${r.I}" ≠ 기대 "${exp.h}/${exp.i}" (J="${normJ(r.J)}", G="${r.G}")` });
      }
    }
    // V-02 ID (시트 덤프만)
    if (caps.hasID && r.id) {
      if (/^#/.test(r.id)) violations.push({ sev: 'HIGH', rule: 'V-02', row: r.sheetRow, msg: `${loc} A열 수식 오류 값 "${r.id}"` });
      else if (/^\d+$/.test(r.id)) idNums.push({ n: parseInt(r.id, 10), row: r.sheetRow });
      else llmFlags.push({ rule: 'V-02', row: r.sheetRow, reason: `텍스트 ID "${r.id}" — 병합 정책('093) 여부 LLM 확인` });
    }

    if (isBasic) {
      // V-16 기본기능 5조건 (기계부 ①②③ + ④⑤ 존재성)
      if (r.G !== 'PC') violations.push({ sev: 'CRITICAL', rule: 'V-16', row: r.sheetRow, msg: `${loc} 기본기능 행 G="${r.G}" ≠ "PC"` });
      if (caps.hasHI && r.I !== 'N/A') violations.push({ sev: 'CRITICAL', rule: 'V-16', row: r.sheetRow, msg: `${loc} 기본기능 행 I="${r.I}" ≠ "N/A"` });
      if (r.F && !/[A-Za-z_][A-Za-z0-9_]{2,}/.test(r.F)) violations.push({ sev: 'HIGH', rule: 'V-16', row: r.sheetRow, msg: `${loc} 기본기능 행 F에 GlobalDefine 키 미포함` });
      if (r.F && !/["“”]/.test(r.F)) violations.push({ sev: 'HIGH', rule: 'V-16', row: r.sheetRow, msg: `${loc} 기본기능 행 F에 큰따옴표 안내 문구 인용 없음` });
      return; // 기본기능 행은 일반 품질 룰 제외
    }

    // ── 이하 QA 상세 행 전용 ──
    // V-05 기계부: 추상 표현 + 개행
    if (ABSTRACT_IN_STEP.test(r.F)) {
      violations.push({ sev: 'HIGH', rule: 'V-05', row: r.sheetRow, msg: `${loc} F열 추상 표현("정상 동작/정상적으로/올바르게") 검출` });
    }
    if (r.F.includes('\n')) {
      violations.push({ sev: 'HIGH', rule: 'V-05', row: r.sheetRow, msg: `${loc} F열 개행 포함 — 단일 서술문 위반` });
    }
    // V-14 Output Format 잔류
    if (r.F.includes('Output Format:')) {
      violations.push({ sev: 'HIGH', rule: 'V-14', row: r.sheetRow, msg: `${loc} F열 "Output Format:" 잔류` });
    }
    // V-22 설계 태그 잔류
    for (const re of DESIGN_TAGS_IN_STEP) {
      if (re.test(r.F)) {
        violations.push({ sev: 'HIGH', rule: 'V-22', row: r.sheetRow, msg: `${loc} F열 설계 태그 잔류 (패턴: ${re})` });
        break;
      }
    }
    // V-15 복합 기대결과 — 추출=기계 / 분류=LLM
    if (COMPOUND_RESULT_RE.test(r.F)) {
      llmFlags.push({ rule: 'V-15', row: r.sheetRow, reason: 'F열 복합 기대결과 후보("~되고 ~되는지") — 1NF 위반 여부 LLM 분류' });
    }
    // V-21 "또는" — 추출=기계 / 4분류=LLM
    if (/또는/.test(r.F)) {
      llmFlags.push({ rule: 'V-21', row: r.sheetRow, reason: 'F열 "또는" 검출 — 사전조건/과정/결과/허용나열 4분류 LLM 판정' });
    }
    // V-23 ①② 분류 동사·동작 / ③ 진입 동작 중복 (validatePreWrite 룰 재사용)
    [['B', r.B], ['C', r.C], ['D', r.D]].forEach(([col, val]) => {
      if (!val) return;
      for (const re of FORBIDDEN_VERBS_IN_CATEGORY) {
        if (re.test(val)) {
          violations.push({ sev: 'HIGH', rule: 'V-23', row: r.sheetRow, col, msg: `${loc} 분류(${col})에 동작 표현: "${val}"` });
          break;
        }
      }
    });
    for (const re of FORBIDDEN_ENTRY_IN_STEP) {
      if (re.test(r.F)) {
        violations.push({ sev: 'HIGH', rule: 'V-23', row: r.sheetRow, msg: `${loc} F열 진입 동작 중복 (패턴: ${re})` });
        break;
      }
    }

    // V-06/V-17 그룹 분산 — fill-down 후 (B,C,D) 튜플 (L4-07)
    const key = `${r.B}|${r.C}|${r.D}`;
    if (lastSeen.has(key) && lastSeen.get(key) !== i - 1) {
      violations.push({ sev: 'HIGH', rule: 'V-06', row: r.sheetRow, msg: `${loc} 분류 그룹 분산: (${key})이 비인접 재등장` });
    }
    lastSeen.set(key, i);

    // 분포 집계
    if (!subStats.has(key)) subStats.set(key, { B: r.B, C: r.C, D: r.D, 정상: 0, 부정: 0, 예외: 0 });
    const st = subStats.get(key);
    if (STAGE_ENUM.includes(r.E)) st[r.E]++;
  });

  // V-07d 플랫폼 분리쌍 (v8 사고: 90쌍) — 같은 (B,C,D,E) 그룹의 PC행↔모바일행
  //   정규화 후 동일 → HIGH(분리 사유 없는 중복) / 동일 아님 → llmFlag(분리 정당성 LLM 판정)
  {
    const byKey = new Map();
    records.forEach((r, i) => {
      if (r.B === '기본기능') return;
      if (r.G !== 'PC' && r.G !== '모바일') return;
      const key = `${r.B}|${r.C}|${r.D}|${r.E}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(r);
    });
    for (const list of byKey.values()) {
      const pcs = list.filter(x => x.G === 'PC');
      const mos = list.filter(x => x.G === '모바일');
      for (const a of pcs) {
        for (const b of mos) {
          if (normFForPlatform(a.F) === normFForPlatform(b.F)) {
            violations.push({ sev: 'HIGH', rule: 'V-07d', row: b.sheetRow, msg: `행 ${a.sheetRow}↔${b.sheetRow} 동일 내용 PC/모바일 분리 — G="PC/모바일" 한 행으로 병합 (조작 차이 서술 없음)` });
          } else {
            llmFlags.push({ rule: 'V-07d', row: b.sheetRow, reason: `행 ${a.sheetRow}↔${b.sheetRow} 같은 분류·검증단계의 PC/모바일 분리 — 조작 차이가 실재하는지(분리 정당성) LLM 판정` });
          }
        }
      }
    }
  }

  // V-02 ID 연속성 (숫자 ID만)
  if (idNums.length > 1) {
    const seen = new Set();
    idNums.forEach(({ n, row }) => {
      if (seen.has(n)) violations.push({ sev: 'HIGH', rule: 'V-02', row, msg: `행 ${row} TC ID ${n} 중복` });
      seen.add(n);
    });
    for (let k = 1; k < idNums.length; k++) {
      if (idNums[k].n !== idNums[k - 1].n + 1 && idNums[k].n > idNums[k - 1].n) {
        llmFlags.push({ rule: 'V-02', row: idNums[k].row, reason: `ID 갭 ${idNums[k - 1].n}→${idNums[k].n} — 기본기능 갭 허용 여부 LLM 확인 (EVAL-05)` });
      }
    }
  }

  // 통계
  const qa = records.filter(r => r.B !== '기본기능');
  const basicCount = records.length - qa.length;
  const byStage = { 정상: 0, 부정: 0, 예외: 0 };
  qa.forEach(r => { if (STAGE_ENUM.includes(r.E)) byStage[r.E]++; });
  const qaTotal = byStage.정상 + byStage.부정 + byStage.예외;
  const negRatio = qaTotal ? Math.round(((byStage.부정 + byStage.예외) / qaTotal) * 1000) / 10 : 0;

  // V-10 전체 하한: 부정+예외 ≥ 49% (기본기능 제외 분모)
  if (qaTotal > 0 && negRatio < 49) {
    violations.push({ sev: 'HIGH', rule: 'V-10', msg: `부정+예외 비율 ${negRatio}% < 49% 하한 (QA ${qaTotal}행 기준)` });
  }

  // 배분표 대조 (V-10/V-16리스크 — design 제공 시)
  const unmatched = { sheetOnly: [], tableOnly: [] };
  if (opts.designPath) {
    const design = parseDesignTables(opts.designPath);
    if (!design.ok || !design.allocation) {
      llmFlags.push({ rule: 'V-10', reason: `배분표 파싱 불능(${design.error || design.notes.join('; ')}) — 배분 대조는 LLM 폴백 (silent pass 금지)` });
    } else {
      notes.push(...design.notes);
      const tblMap = new Map(design.allocation.map(e => [`${e.B}|${e.C}|${e.D}`, e]));
      // 시트 → 배분표 대조
      for (const [key, st] of subStats) {
        const e = tblMap.get(key);
        if (!e) { unmatched.sheetOnly.push(key); continue; }
        e._matched = true;
        // 단계별 미달 (부등식: 실제 ≥ 배분표 — 초과는 합법 L3-1)
        [['정상', e.normal], ['부정', e.neg], ['예외', e.exc]].forEach(([stage, want]) => {
          if (want === null || want === undefined) return;
          if (st[stage] < want) {
            if (e.note) llmFlags.push({ rule: 'V-10', reason: `(${key}) ${stage} ${st[stage]} < 배분 ${want}, 배분표 비고 "${e.note}" — 사유 적격성 LLM 판정 (L3-4)` });
            else violations.push({ sev: 'HIGH', rule: 'V-10', msg: `(${key}) ${stage} ${st[stage]}건 < 배분표 ${want}건 (비고 사유 없음)` });
          }
        });
        // 리스크 비율 (EVAL-02: HIGH≥60 / MEDIUM≥49 / LOW≥30)
        const tot = st.정상 + st.부정 + st.예외;
        if (tot > 0 && e.risk) {
          const ratio = ((st.부정 + st.예외) / tot) * 100;
          const th = /HIGH/i.test(e.risk) ? 60 : /MED/i.test(e.risk) ? 49 : /LOW/i.test(e.risk) ? 30 : null;
          if (th !== null && ratio < th - 0.5) {
            const sev = th === 60 ? 'HIGH' : th === 49 ? 'MEDIUM' : 'LOW';
            if (e.note) llmFlags.push({ rule: 'V-16r', reason: `(${key}) [${e.risk}] 부정+예외 ${Math.round(ratio)}% < ${th}%, 비고 "${e.note}" — LLM 판정` });
            else violations.push({ sev, rule: 'V-16r', msg: `(${key}) [${e.risk}] 부정+예외 ${Math.round(ratio)}% < ${th}% (비고 사유 없음)` });
          }
        }
        // 소분류별 정상 ≥ 1 (배분표가 정상 0을 명시했으면 합법 — L3-4)
        if (st.정상 === 0 && (e.normal === null || e.normal > 0)) {
          if (e.note) llmFlags.push({ rule: 'V-10', reason: `(${key}) 정상 0건, 배분표 비고 "${e.note}" — LLM 판정` });
          else violations.push({ sev: 'HIGH', rule: 'V-10', msg: `(${key}) 정상 케이스 0건 (비고 사유 없음)` });
        }
      }
      // 배분표에만 있는 소분류
      for (const e of design.allocation) {
        if (!e._matched) unmatched.tableOnly.push(`${e.B}|${e.C}|${e.D}`);
      }
      if (unmatched.sheetOnly.length || unmatched.tableOnly.length) {
        llmFlags.push({ rule: 'V-10', reason: `배분표↔데이터 분류명 미스매치 — 시트에만: [${unmatched.sheetOnly.join(', ')}] / 배분표에만: [${unmatched.tableOnly.join(', ')}] (L3-3: 축약·개명 여부 LLM 대조)` });
      }
      // V-12 GlobalDefine 키 인용 후보
      if (design.globalKeys && design.globalKeys.length) {
        const uncited = design.globalKeys.filter(k => !records.some(r => r.F.includes(k)));
        if (uncited.length) {
          llmFlags.push({ rule: 'V-12', reason: `GlobalDefine 키 미인용: [${uncited.join(', ')}] — 해당 기능 TC의 F열 포함 의무 여부 LLM 판정` });
        }
      }
    }
  } else {
    // 배분표 없이 호출 — 정상 0 소분류는 LLM 플래그 (사유 확인 불가)
    for (const [key, st] of subStats) {
      if (st.정상 === 0) llmFlags.push({ rule: 'V-10', reason: `(${key}) 정상 0건 — 배분표 미제공으로 사유 확인 불가, LLM 판정` });
    }
  }

  const stats = {
    total: records.length, basic: basicCount, qa: qa.length,
    byStage, negRatio, subCount: subStats.size,
  };

  return {
    ok: !hasBlocking(violations),
    caps, stats, violations, llmFlags, unmatched, notes,
    llmOnly: ['V-11 PC-only 적정성', 'V-12/13 의미 잔여', 'V-18 인용문 정확성', 'V-15/21 검출행 분류'],
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === '--full') {
    const file = args[1];
    const dIdx = args.indexOf('--design');
    const designPath = dIdx >= 0 ? args[dIdx + 1] : null;
    if (!file) {
      console.error('사용법: node validate_tc_rows.js --full <tc_data|스냅샷.json> [--design <tc_design.md>]');
      process.exit(1);
    }
    const r = validateFull(file, { designPath });
    if (r.fatal) {
      console.error('치명: ' + r.fatal);
      process.exit(1);
    }
    console.log(JSON.stringify(r, null, 1));
    process.exit(r.ok ? 0 : 4);
  }
  console.error('사용법: node validate_tc_rows.js --full <파일> [--design <md>]  (라이브러리 사용은 require)');
  process.exit(1);
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 3 — 직변환 파서 (2026-06-11, 사전검증원장 처방 반영)
// 원칙: fail-closed — 미인식 구문은 스킵이 아니라 blocker (L2P3-01).
// 소비자: direct_convert.js (convert/merge). 테스트: tests/run_tests.js [10] (v9 실물 골든).
// ═══════════════════════════════════════════════════════════════════════════

// F5 — 소분류/leaf 태그 화이트리스트 (리스크·플랫폼·J: 외 허용 어휘)
const TREE_EXTRA_TAGS = new Set(['데이터', '동시성', '세션', 'UI', '이미지 참조 필요', '연계', '유저상태', '권한']);
const TREE_RISK = new Set(['HIGH', 'MEDIUM', 'LOW']);
// F4 — 복합문 leaf 검출 ('하고 있/되고 있' 진행형은 단일 검증이라 제외)
const COMPOUND_LEAF_RE = /(하고(?!\s*있)|하며|되고(?!\s*있)|되며)\s/;

// F3 — 분류명 비교 정규화 (하이픈 주변 공백·연속 공백 무시)
function normCatName(v) {
  return s(v).replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim();
}

/**
 * 분류 그룹핑 트리 파서 (strict 기본).
 * 형식: `N. **대분류**` / `N.M 중분류 (중분류)` / `- 소분류 [리스크] [플랫폼] [태그…]` / `→ 단계-n: 본문 [J:…]`
 * 반환: { ok, leaves:[{cat1,cat2,cat3,stage,seq,text,j,platform,risk,line}], blockers:[{type,line,msg}] }
 * - J 도출(F1/L4-F2): [J:] 태그 우선 → 없고 본문에 '미지정' 포함 시 '기획 확인 필요' 자동 부여 → 그 외 ''
 * - '(ST-8 반영)' 류 괄호 주석은 본문에서 제거 (F5)
 * - opts.allowCompound: 복합문 leaf를 blocker 대신 통과 (골든 테스트·이행기용)
 */
function parseDesignTree(text, opts = {}) {
  const strict = opts.strict !== false;
  const allowCompound = !!opts.allowCompound;
  const lines = text.split('\n');
  const start = lines.findIndex(l => /^##\s*분류\s*그룹핑\s*트리/.test(l));
  if (start < 0) {
    return { ok: false, leaves: [], blockers: [{ type: 'no_tree_heading', line: 0, msg: "'## 분류 그룹핑 트리' 헤딩 미발견" }] };
  }
  const leaves = [];
  const blockers = [];
  let cat1 = '', cat2 = '', sub = null;
  for (let i = start + 1; i < lines.length; i++) {
    const raw = lines[i];
    if (/^##\s/.test(raw)) break; // 다음 섹션 — 경계 (F6)
    const t = raw.trim();
    if (!t || t === '---') continue;
    let m;
    if ((m = t.match(/^\d+\.\s+\*\*(.+?)\*\*/))) { cat1 = m[1].trim(); cat2 = ''; sub = null; continue; }
    if ((m = t.match(/^\d+\.\d+\s+(.+?)\s*\(중분류\)/))) { cat2 = m[1].trim(); sub = null; continue; }
    if ((m = t.match(/^-\s+(.+)$/))) {
      const tags = [];
      const name = m[1].replace(/\[([^\]]+)\]/g, (_, tag) => { tags.push(tag.trim()); return ''; }).replace(/\s+/g, ' ').trim();
      const risk = tags.find(x => TREE_RISK.has(x)) || '';
      const platform = tags.find(x => PLATFORM_ENUM.includes(x)) || '';
      if (strict) {
        for (const tag of tags) {
          if (TREE_RISK.has(tag) || PLATFORM_ENUM.includes(tag) || tag.startsWith('J:') || TREE_EXTRA_TAGS.has(tag)) continue;
          blockers.push({ type: 'unknown_tag', line: i + 1, msg: `소분류 '${name}' 미인식 태그 [${tag}] — 화이트리스트(F5) 확인` });
        }
        if (!platform) blockers.push({ type: 'no_platform', line: i + 1, msg: `소분류 '${name}' 플랫폼 태그 없음` });
        if (!risk) blockers.push({ type: 'no_risk', line: i + 1, msg: `소분류 '${name}' 리스크 태그 없음` });
      }
      sub = { name, risk, platform };
      continue;
    }
    if ((m = t.match(/^→\s*(정상|부정|예외)-(\d+)\s*:\s*(.+)$/))) {
      if (!sub || !cat1 || !cat2) { blockers.push({ type: 'orphan_leaf', line: i + 1, msg: `소분류 컨텍스트 없는 leaf: ${t.slice(0, 60)}` }); continue; }
      let jTag = '';
      let body = m[3].replace(/\[J:\s*([^\]]+)\]/g, (_, j) => { jTag = j.trim(); return ''; });
      body = body.replace(/\(\s*(?:ST|DT|C|B|P)-\d+[^)]*\)/g, '').replace(/\s+/g, ' ').trim(); // 괄호 주석 제거 (F5)
      const leftover = body.match(/\[[^\]]+\]/);
      if (strict && leftover) blockers.push({ type: 'unknown_token', line: i + 1, msg: `leaf 잔여 대괄호 토큰 ${leftover[0]}` });
      if (!allowCompound && COMPOUND_LEAF_RE.test(body)) {
        blockers.push({ type: 'compound_leaf', line: i + 1, msg: `복합문 leaf(설계 단계 분해 필요 — F4): ${body.slice(0, 70)}` });
      }
      const j = jTag || (/미지정/.test(body) ? '기획 확인 필요' : '');
      leaves.push({ cat1, cat2, cat3: sub.name, stage: m[1], seq: parseInt(m[2], 10), text: body, j, platform: sub.platform, risk: sub.risk, line: i + 1 });
      continue;
    }
    if (strict) blockers.push({ type: 'unparsed_line', line: i + 1, msg: `트리 내 미인식 행(스킵 금지 — L2P3-01): ${t.slice(0, 60)}` });
  }
  if (!leaves.length) blockers.push({ type: 'no_leaves', line: start + 1, msg: '트리에서 leaf 0건 파싱' });
  return { ok: blockers.length === 0, leaves, blockers };
}

/** 기본기능 검증 항목 표 파서 — 섹션 경계(다음 ##) 안에서만 표 추출 (F6 경계 번짐 방지) */
function parseBasicTable(text) {
  const lines = text.split('\n');
  const start = lines.findIndex(l => /^##\s*기본기능\s*검증\s*항목/.test(l));
  if (start < 0) return { ok: false, error: 'basic_heading_not_found', rows: [] };
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) { if (/^##\s/.test(lines[i])) { end = i; break; } }
  const tbl = extractTableAfter(lines.slice(start, end), /기본기능\s*검증\s*항목/);
  if (!tbl) return { ok: false, error: 'basic_table_not_found', rows: [] };
  const ix = (n) => tbl.header.findIndex(c => c.includes(n));
  const m = { b: ix('대분류'), c: ix('중분류'), d: ix('소분류'), e: ix('검증단계'), txt: ix('검증 내용'), g: ix('플랫폼') };
  if (m.d < 0 || m.e < 0 || m.txt < 0) return { ok: false, error: 'basic_header_mismatch', rows: [] };
  const rows = tbl.rows
    .filter(r => s(r[m.d]))
    .map(r => ({
      cat1: (m.b >= 0 && s(r[m.b])) || '기본기능',
      cat2: m.c >= 0 ? s(r[m.c]) : '',
      cat3: s(r[m.d]),
      stage: s(r[m.e]),
      text: s(r[m.txt]),
      platform: (m.g >= 0 && s(r[m.g])) || 'PC',
    }));
  return { ok: true, rows };
}

/**
 * 배분표 3자 동치 검증 (F2/L4-F1) — 게이트 기준은 "배분표 행별 재합산 = 트리 leaf 수"
 * + 소분류·단계별 대조(정규화 — F3). 선언 합계 행 검산 불일치 = blocking (설계 FAIL — F2).
 */
function checkAllotmentStrict(text, leaves) {
  const lines = text.split('\n');
  const tbl = extractTableAfter(lines, /검증단계\s*사전\s*배분표/);
  const issues = [];
  if (!tbl) return { ok: false, issues: [{ type: 'alloc_missing', blocking: true, msg: '배분표 미발견 (strict — LLM 폴백 금지)' }], rowTotal: 0 };
  const ix = (n) => tbl.header.findIndex(c => c.includes(n));
  const m = { b: ix('대분류'), c: ix('중분류'), d: ix('소분류'), normal: ix('정상'), neg: ix('부정'), exc: ix('예외') };
  if (m.d < 0 || m.normal < 0 || m.neg < 0 || m.exc < 0) {
    return { ok: false, issues: [{ type: 'alloc_header', blocking: true, msg: '배분표 헤더 불일치' }], rowTotal: 0 };
  }
  const num = (v) => { const x = s(v).replace(/[^\d]/g, ''); return x === '' ? 0 : parseInt(x, 10); };
  let fb = '', fc = '';
  const entries = [];
  let decl = null;
  for (const r of tbl.rows) {
    const bRaw = m.b >= 0 ? s(r[m.b]) : '';
    const cRaw = m.c >= 0 ? s(r[m.c]) : '';
    const d = s(r[m.d]);
    if (/합계|소계|총계/.test(bRaw + cRaw + d)) {
      if (!decl) decl = { normal: num(r[m.normal]), neg: num(r[m.neg]), exc: num(r[m.exc]) };
      continue;
    }
    if (!d) {
      // 소분류 빈 행: 비율 요약 행(합법 — v9 실물)만 스킵, 그 외는 미인식 차단
      if (/비율/.test(bRaw + cRaw) || r.some(cell => /%/.test(s(cell)))) continue;
      issues.push({ type: 'alloc_row_unparsed', blocking: true, msg: `배분표 미인식 행(스킵 금지 — L2P3-01): ${r.join('|').slice(0, 60)}` });
      continue;
    }
    fb = bRaw || fb; fc = cRaw || fc;
    entries.push({ b: fb, c: fc, d, normal: num(r[m.normal]), neg: num(r[m.neg]), exc: num(r[m.exc]) });
  }
  const rowSum = entries.reduce((a, e) => ({ normal: a.normal + e.normal, neg: a.neg + e.neg, exc: a.exc + e.exc }), { normal: 0, neg: 0, exc: 0 });
  const rowTotal = rowSum.normal + rowSum.neg + rowSum.exc;
  if (decl) {
    const declTotal = decl.normal + decl.neg + decl.exc;
    if (declTotal !== rowTotal) issues.push({ type: 'sum_decl_mismatch', blocking: true, msg: `배분표 선언 합계 ${declTotal} ≠ 행별 재합산 ${rowTotal} — 설계 검산 오류(F2), 합계 행 재계산 필요` });
  }
  if (leaves.length !== rowTotal) issues.push({ type: 'tree_alloc_mismatch', blocking: true, msg: `트리 leaf ${leaves.length}건 ≠ 배분표 행별 재합산 ${rowTotal}건 (3자 동치 위반)` });
  const treeMap = new Map();
  for (const lf of leaves) {
    const k = [normCatName(lf.cat1), normCatName(lf.cat2), normCatName(lf.cat3)].join('|');
    const e = treeMap.get(k) || { normal: 0, neg: 0, exc: 0 };
    if (lf.stage === '정상') e.normal++; else if (lf.stage === '부정') e.neg++; else e.exc++;
    treeMap.set(k, e);
  }
  for (const e of entries) {
    const k = [normCatName(e.b), normCatName(e.c), normCatName(e.d)].join('|');
    const tc = treeMap.get(k);
    if (!tc) { issues.push({ type: 'alloc_no_tree', blocking: true, msg: `배분표 행이 트리에 없음: ${k}` }); continue; }
    if (tc.normal !== e.normal || tc.neg !== e.neg || tc.exc !== e.exc) {
      issues.push({ type: 'alloc_count_mismatch', blocking: true, msg: `${k} 단계 수 불일치 — 트리 ${tc.normal}/${tc.neg}/${tc.exc} vs 배분표 ${e.normal}/${e.neg}/${e.exc}` });
    }
    treeMap.delete(k);
  }
  for (const k of treeMap.keys()) issues.push({ type: 'tree_no_alloc', blocking: true, msg: `트리 소분류가 배분표에 없음: ${k}` });
  return { ok: !issues.some(i => i.blocking), issues, rowTotal };
}

module.exports = {
  validatePreWrite, validatePostWrite, formatViolations,
  normJ, isJAllowed, expectedHI, adaptInput, fillDownRecords,
  parseDesignTables, validateFull,
  parseDesignTree, parseBasicTable, checkAllotmentStrict, normCatName,
  J_WHITELIST, PLATFORM_ENUM, STAGE_ENUM,
};
