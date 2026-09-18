#!/usr/bin/env node
/**
 * xlsx_extract.js — 대조용 로컬 데이터테이블 원본 추출기 (2026-09-11 신설)
 *
 * 배경: tc-대조.md §1.2-2 가 "추출 조건을 채우면 xlsx 값까지 apply" 로 잠금을 풀었지만(2026-09-10),
 *   대조 에이전트는 원본을 **한 번도 열지 않았다**. 실측(기능A 2026-09-11) —
 *   locate 21건 중 13건이 xlsx 컬럼을 지목하고 note 에 "로컬 xlsx 미열람"만 남겼고,
 *   로그의 xlsx 언급 15건은 전부 규칙 문구의 플레이스홀더(`<파일>.xlsx`)였다.
 *   (직접 원인은 핸드오프에 남은 옛 금지 문구였지만, LLM 에게 코드를 돌리라고 부탁하는 구조 자체가
 *    tc-대조.md §1.4 스텁 가드와 같은 모양으로 무너진다 — "문구만으로는 안 지켜졌다".)
 *
 * 정책 — **추출기다. 판정은 하지 않는다.**
 *   - 여기서 하는 일: 기획서가 지목한 시트를 원본 xlsx 에서 그대로 떠서 $SPEC/xlsx_extract.md 에 남긴다.
 *   - 어떤 값이 어떤 질문의 답인지는 대조 에이전트가 판단한다(apply/locate).
 *   - 사실을 코드가 소유하는 이유: 셀 값은 파일에 있고, LLM 이 열어 줘야만 존재하면 안 된다.
 *
 * ⚠ 큰 시트는 통째로 뜨지 않는다. `--max-rows` 초과 시 기획서의 값 토큰(`X=Y` 의 Y, 식별자)과
 *   **칸이 정확히 같은** 행만 남긴다. 맞는 행이 0이면 위치만 적는다 — 근처 행을 대신 싣지 않는다(§1.2-1).
 *
 * 사용: node xlsx_extract.js --raw <confluence_raw.md> --tablemap <_테이블맵.md> --out <xlsx_extract.md>
 *                            [--tables <dir>] [--max-rows 200]
 * exit 0=생성 / 4=원본 테이블·테이블맵·xlsx 모듈 없음, 또는 참조 시트 0건(스킵·비차단) / 2=인자·입력 오류
 */

'use strict';
const fs = require('fs');
const path = require('path');

const DATA_ROW = 4;           // 헤더행=0, 한글설명=1, 적용범위=2, 타입=3, 데이터=4~ (item_dict.js 와 같은 규약)
const CELL_MAX = 60;          // 렌더 시 셀 문자열 상한 — 경로·설명 컬럼이 표를 터뜨리지 않게
const PARTICLE_CUT = ['이면서', '이면', '인 경우', ' 인 경우', ' (', '('];

/** _테이블맵.md → Map<시트명, {file, rows}> */
function parseTableMap(md) {
  const index = new Map();
  let file = null;
  for (const line of md.split(/\r?\n/)) {
    const f = line.match(/^## .+\(([^()]+\.xlsx)\)\s*$/);
    if (f) { file = f[1]; continue; }
    const s = line.match(/^- 시트 \*\*([^*]+)\*\* — 데이터 (\d+)행/);
    if (s && file) index.set(s[1], { file, rows: Number(s[2]) });
  }
  return index;
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// ASCII 단어 경계 — "StageIndex" 안의 "Act" 는 시트가 아니다. 한글 조사("MapInfo를")는 경계로 친다.
const wordHit = (text, word) => new RegExp(`(^|[^A-Za-z0-9_])${escapeRe(word)}(?![A-Za-z0-9_])`).test(text);

/**
 * 기획서가 지목한 시트: ① 시트명이 단어로 등장(named=true) ② `<파일>.xlsx` 만 지목되면 그 파일의 나머지 시트(named=false).
 * named=false 는 selectRows 에서 토큰 매칭 행만 싣는다 — "Goods.xlsx > GoodsCategory" 한 줄에 AssetPath 118행이
 * 딸려 오던 것(실측 57.5KB) 방지. 그래도 파일 단위 포함을 두는 이유: 기획서가 GoodsCategory 을 지목하고
 * 실제 값(Value2)은 GoodsInfo 에 있는 경우가 있다(기능A 1회 충전량). `#` 시트 제외.
 */
function findReferencedSheets(raw, index) {
  const namedFiles = new Set((raw.match(/[A-Za-z_][A-Za-z0-9_]*\.xlsx/g) || []));
  const out = [];
  for (const [sheet, meta] of index) {
    if (sheet.startsWith('#')) continue;
    const named = wordHit(raw, sheet);
    if (named || namedFiles.has(meta.file)) out.push({ sheet, file: meta.file, rows: meta.rows, named });
  }
  return out;
}

/** 큰 시트 행 필터용 토큰: `X=Y` 의 Y(조사 앞까지) + CamelCase 식별자 */
function extractValueTokens(raw) {
  const tokens = new Set();
  for (const m of raw.matchAll(/=\s*([^=|*\n{}]+)/g)) {
    const cut = PARTICLE_CUT.reduce((s, p) => { const i = s.indexOf(p); return i > 0 ? s.slice(0, i) : s; }, m[1]);
    const v = cut.trim();
    if (v && v.length <= 30) tokens.add(v);
  }
  for (const m of raw.matchAll(/\b[A-Z][A-Za-z0-9]*[a-z][A-Za-z0-9]*\b/g)) tokens.add(m[0]);
  return tokens;
}

const cellStr = c => (c === null || c === undefined ? '' : String(c).trim());

/**
 * 전량은 "시트명이 직접 지목됐고(named) 작을 때"만. 그 밖(큰 시트 · 파일만 지목된 시트)은 토큰 매칭 행만.
 * @returns {{mode:'full'|'filtered'|'none', data:any[][], total:number}}
 */
function selectRows(rows, { maxRows, tokens, named = true }) {
  const data = rows.slice(DATA_ROW).filter(r => r && r.some(c => cellStr(c) !== ''));
  if (named && data.length <= maxRows) return { mode: 'full', data, total: data.length };
  const hit = data.filter(r => r.some(c => tokens.has(cellStr(c)))).slice(0, maxRows);
  return { mode: hit.length ? 'filtered' : 'none', data: hit, total: data.length };
}

const cell = c => cellStr(c).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').slice(0, CELL_MAX);

function renderSheet({ file, sheet, rows, sel, build, date }) {
  const head = rows[0] || [];
  const width = head.length;
  const line = r => `| ${Array.from({ length: width }, (_, i) => cell(r[i])).join(' | ')} |`;
  const title = `### ${file} > ${sheet} (${sel.total}행, ${build}, ${date})`;
  const note = {
    full: `전량 ${sel.total}행.`,
    filtered: `⚠ 부분 — 기획서 값 토큰과 칸이 정확히 같은 ${sel.data.length}행만 실음(전체 ${sel.total}행). 여기 없는 행은 **없다는 뜻이 아니다** → 필요하면 locate.`,
    none: `⚠ 기획서 값 토큰과 맞는 행 0건(전체 ${sel.total}행). 값은 싣지 않았다 → locate.`,
  }[sel.mode];
  const parts = [title, '', note, ''];
  if (sel.mode !== 'none') {
    parts.push(line(head), `|${' --- |'.repeat(width)}`, line(rows[1] || []), ...sel.data.map(line));
  }
  return parts.join('\n');
}

/** 순수 조립부 — readSheet(file, sheet) 는 2차원 배열 또는 null 을 돌려준다(테스트에서 주입). */
function buildExtract(raw, index, readSheet, { maxRows, build, date }) {
  const tokens = extractValueTokens(raw);
  const refs = findReferencedSheets(raw, index);
  const blocks = [];
  const missing = [];
  let written = 0;
  for (const ref of refs) {
    const rows = readSheet(ref.file, ref.sheet);
    if (!rows) { missing.push(`${ref.file} > ${ref.sheet}`); continue; }
    blocks.push(renderSheet({ ...ref, rows, sel: selectRows(rows, { maxRows, tokens, named: ref.named }), build, date }));
    written++;
  }
  const header = [
    '# xlsx_extract — 대조용 로컬 데이터테이블 원본 추출본',
    '',
    `> 생성 ${date} · 빌드 ${build} · 결정론 추출(lib/xlsx_extract.js). **판정은 하지 않았다** — 어떤 값이 답인지는 대조가 정한다(tc-대조.md §1.2-2).`,
    '> 각 블록 제목을 `source` 에 **그대로** 옮기면 §1.2-2 출처 형식이 된다. 2행째(한글설명)는 기획 메모이며 데이터가 아니다.',
    '',
    `참조 시트 ${refs.length} · 추출 ${written} · 누락 ${missing.length}`,
    ...(missing.length ? ['', '## 누락 (기획서가 지목했으나 원본에서 못 읽음 → locate)', ...missing.map(m => `- ${m}`)] : []),
    '',
  ].join('\n');
  return { md: [header, ...blocks].join('\n\n') + '\n', stats: { referenced: refs.length, written, missing } };
}

module.exports = { parseTableMap, findReferencedSheets, extractValueTokens, selectRows, renderSheet, buildExtract, DATA_ROW };

// ── CLI ──────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const argv = process.argv.slice(2);
  const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  const RAW = opt('--raw');
  const MAP = opt('--tablemap');
  const OUT = opt('--out');
  const TABLES = opt('--tables', '<GAMEDATA_ROOT>/ExcelTable');
  const MAX_ROWS = Number(opt('--max-rows', '200'));

  if (!RAW || !MAP || !OUT || !Number.isInteger(MAX_ROWS) || MAX_ROWS < 1) {
    console.error('사용: node xlsx_extract.js --raw <confluence_raw.md> --tablemap <_테이블맵.md> --out <xlsx_extract.md> [--tables <dir>] [--max-rows N]');
    process.exit(2);
  }
  if (!fs.existsSync(RAW)) { console.error(`[xlsx_extract] 기획서 원문 없음: ${RAW}`); process.exit(2); }
  // 원본·색인이 없는 머신(집 PC·CI)에서는 조용히 스킵 — 파이프라인을 막지 않는다.
  if (!fs.existsSync(MAP) || !fs.existsSync(TABLES)) {
    console.error(`[xlsx_extract] 테이블맵/원본 테이블 없음 — 스킵: ${fs.existsSync(MAP) ? TABLES : MAP}`);
    process.exit(4);
  }
  let XLSX;
  try { XLSX = require('xlsx'); }
  catch (e) { console.error('[xlsx_extract] xlsx 모듈 없음 — 스킵 (npm i xlsx)'); process.exit(4); }

  const books = new Map();
  const readSheet = (file, sheet) => {
    const p = path.join(TABLES, file);
    if (!fs.existsSync(p)) return null;
    if (!books.has(p)) books.set(p, XLSX.readFile(p, { cellDates: false }));
    const wb = books.get(p);
    if (!wb.SheetNames.includes(sheet)) return null;
    return XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, raw: true, defval: null });
  };

  const index = parseTableMap(fs.readFileSync(MAP, 'utf8'));
  const raw = fs.readFileSync(RAW, 'utf8');
  const build = path.basename(path.dirname(path.dirname(path.resolve(TABLES))));   // …/DX_Trunk/CommonData/ExcelTable → DX_Trunk
  const date = new Date().toISOString().slice(0, 10);
  const { md, stats } = buildExtract(raw, index, readSheet, { maxRows: MAX_ROWS, build, date });

  if (stats.referenced === 0) {
    console.error('[xlsx_extract] 기획서가 지목한 테이블 시트 0건 — 스킵(추출본 미생성)');
    process.exit(4);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, md, 'utf8');
  console.error(`[xlsx_extract] 생성 — 참조 ${stats.referenced} / 추출 ${stats.written} / 누락 ${stats.missing.length} · ${(Buffer.byteLength(md) / 1024).toFixed(1)}KB → ${OUT}`);
}
