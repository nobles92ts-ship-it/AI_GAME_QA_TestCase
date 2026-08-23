#!/usr/bin/env node
/**
 * item_dict.js — DXR 아이템 실명 사전 생성기 (2026-08-13 신설)
 *
 * 배경: 재현스탭이 아이템을 **일반명사로만** 지목하면 테스터가 무엇을 집어야 할지 모른다.
 *   실측(기능C_v2, 159 TC) — "세공 재료 아이템을 사용하면…" 처럼
 *   유형만 적힌 TC가 44건이었고, 어떤 아이템으로 재현하는지가 시트 어디에도 없었다.
 *   더 나쁜 경우: TC 039~044 는 "제작+성장 겸용 재료 아이템"을 전제했는데 **현행 테이블에 0건**이었다.
 *   즉 유형만 적으면 (a) 재현 불가와 (b) 존재하지 않는 케이스를 구분할 수 없다.
 *
 * 정책 — **사전 생성기다. 문장은 쓰지 않는다.**
 *   - 여기서 하는 일: "유형 → 대표 실아이템"과 "소비 시스템 교차(겸용 조합)"를 테이블에서 뽑는다.
 *   - 재현스탭에 어떻게 병기할지는 LLM(설계자·품질 렌즈)이 rules/tc-설계.md §아이템 실명 병기 로 판단.
 *   - 판정을 코드가 소유하는 이유: 아이템의 소비처는 테이블 조인으로 100% 결정되며,
 *     LLM 추측이 끼면 "겸용 0건" 같은 반증을 못 낸다.
 *
 * ⚠ 표시명 함정 — 이름이 있다고 특정되는 게 아니다.
 *   제작 레시피 재료 60종이 NameCode `ItemName_Sample_Temp` 를 **공유**해 표시명이 전부
 *   "제작 재료 임시 명칭"이었다. 이런 유형은 이름 대신 Index 로 지목해야 한다 →
 *   name_placeholder=true + placeholder_reason 을 남기고, cite 에 Index 를 넣어 준다.
 *
 * ⚠ 소비 시스템은 "획득 경로"가 아니다. RewardGroup·Quest·Mail 등에 아이템 Index 가 등장하는 것은
 *   그 아이템을 **얻는** 경로이지 **쓰는** 곳이 아니다. 사전에는 소비처만 담는다(SYSTEMS 4종).
 *
 * ⚠ combos 의 0건 항목을 지우지 말 것. "그 조합은 데이터에 없다"가 이 파일의 가장 값진 산출이다.
 *   소비자(tc-설계 §아이템 실명 병기 · eval_digest [quality])가 그 0을 근거로 기획 확인을 띄운다.
 *
 * 사용: node item_dict.js --out <item_dict.json> [--tables <dir>] [--gamestring <dir>]
 * exit 0=생성 / 4=원본 테이블·xlsx 모듈 없음(스킵 신호·비차단) / 2=인자·입력 오류
 */

'use strict';
const fs = require('fs');
const path = require('path');

// 소비 시스템 정의 — 아이템을 **쓰는** 곳. (헤더행=0, 한글설명=1, DevFlag=2, 타입=3, 데이터=4~)
// 시트/컬럼이 없으면 그 시스템만 스킵하고 skipped 에 사유를 남긴다(테이블 개편에 죽지 않도록).
//
// ⚠ 바인딩은 **코드가 아니라 config 가 소유한다.** 게임마다 테이블·시트·컬럼 이름이 다르고,
//   여기에 박아 두면 (a) 남의 프로젝트에서 못 쓰고 (b) 우리 스키마가 배포물에 실린다.
//   `--systems <json>` 로 주입하며, 형식은 `item_dict.systems.json.template` 참조.
//   주입이 없으면 사전 생성을 스킵한다(exit 4 · 비차단) — 현행 "원본 없음" 경로와 같다.
let SYSTEMS = [];
/** 주입된 바인딩으로 교체. CLI 와 테스트가 쓴다. */
function setSystems(list) { SYSTEMS = Array.isArray(list) ? list : []; }

// 아이템 테이블의 컬럼 바인딩 — **코드는 역할 키(idx·nameCode·inv…)만 안다.**
// 실제 컬럼명은 게임 스키마라 config 가 소유한다(SYSTEMS 와 같은 이유).
// 기본값은 역할명 그대로 = 스키마를 모르는 상태. 주입이 없으면 컬럼을 못 찾아 사전이 비고,
// 그 사실이 skipped/warn 에 남는다(조용히 틀린 사전을 만들지 않는다).
const COL_ROLES = ['idx', 'desc', 'nameCode', 'type', 'inv', 'grade', 'live'];
let ITEM_COLS = Object.fromEntries(COL_ROLES.map(r => [r, r]));
function setItemColumns(map) {
  ITEM_COLS = Object.fromEntries(COL_ROLES.map(r => [r, (map && map[r]) || r]));
}

const DATA_ROW = 4;      // 데이터 시작 행 (0-based)
const MAX_EXAMPLES = 3;  // 유형·시스템당 대표 예시 개수

// ── 순수 로직 ────────────────────────────────────────────────────────────────

function colIndexes(rows, name) {
  const hdr = (rows && rows[0]) || [];
  const out = [];
  for (let c = 0; c < hdr.length; c++) if (String(hdr[c]) === name) out.push(c);
  return out;
}

/**
 * @param itemRows  아이템 테이블 시트를 header:1 로 읽은 2차원 배열
 * @param systemRows { [systemKey]: rows|null } — 없으면 그 시스템 스킵
 * @param loc        Map(이름코드 → 표시명)
 */
function buildDict(itemRows, systemRows, loc, meta) {
  // 역할 → 실제 컬럼 인덱스. 컬럼명은 ITEM_COLS(config 주입)가 정한다.
  const ih = {};
  for (const role of COL_ROLES) ih[role] = colIndexes(itemRows, ITEM_COLS[role])[0];
  const items = new Map();
  const nameUsers = new Map();   // 표시명 → 사용 아이템 수 (표시명 공유 검출)
  const cell = (row, k) => (ih[k] == null || row[ih[k]] == null ? '' : String(row[ih[k]]));
  for (let r = DATA_ROW; r < itemRows.length; r++) {
    const row = itemRows[r];
    if (!row) continue;
    const idx = Number(row[ih.idx]);
    if (!Number.isInteger(idx) || idx <= 0) continue;
    const nameCode = cell(row, 'nameCode');
    const name = loc.get(nameCode) || '';
    items.set(idx, {
      name, nameCode,
      desc: cell(row, 'desc'),
      type: cell(row, 'type'),
      inv: cell(row, 'inv'),
      grade: cell(row, 'grade'),
      live: row[ih.live] === true || cell(row, 'live').toLowerCase() === 'true',
    });
    if (name) nameUsers.set(name, (nameUsers.get(name) || 0) + 1);
  }

  // 표시명으로 개별 특정이 되는가 — 사유를 구분해 남긴다(고치는 사람이 원인을 알아야 한다).
  function placeholderReason(it) {
    if (!it.name) return 'no_string';                                // GameString 미등록
    if (nameUsers.get(it.name) > 1) return 'shared';                  // 여러 아이템이 같은 이름
    if (/_Temp\d*$|_Temp\b|(^|_)Test_/i.test(it.nameCode)) return 'temp_code';
    if (/임시/.test(it.name)) return 'temp_word';
    return null;
  }

  // 예시 고르기 — live 우선 → 이름으로 특정되는 것 우선 → Index 오름차순.
  function pickExamples(indexes) {
    return [...indexes]
      .filter(i => items.has(i))
      .map(i => ({ index: i, it: items.get(i) }))
      .map(o => ({ ...o, ph: placeholderReason(o.it) }))
      .sort((a, b) => (b.it.live - a.it.live) || ((a.ph ? 1 : 0) - (b.ph ? 1 : 0)) || (a.index - b.index))
      .slice(0, MAX_EXAMPLES)
      .map(({ index, it, ph }) => ({
        index,
        name: it.name || null,
        item_type: it.type,
        grade: it.grade || null,
        live: it.live,
        name_placeholder: !!ph,
        ...(ph ? { placeholder_reason: ph } : {}),
        // 재현스탭에 그대로 넣을 지목 문구 — 특정 불가면 Index 를 붙여 준다.
        cite: ph ? `${it.name || it.type}(Index ${index})` : it.name,
      }));
  }

  // 소비 시스템 교차
  const sysMembers = new Map();
  const skipped = [];
  for (const s of SYSTEMS) {
    const rows = systemRows[s.key];
    if (!rows) { skipped.push({ system: s.key, reason: `${s.file}/${s.sheet} 없음` }); continue; }
    const cols = colIndexes(rows, s.col);
    if (!cols.length) { skipped.push({ system: s.key, reason: `${s.sheet}.${s.col} 컬럼 없음` }); continue; }
    const set = new Set();
    for (let r = DATA_ROW; r < rows.length; r++) {
      const row = rows[r];
      if (!row) continue;
      for (const c of cols) {
        const v = Number(row[c]);
        if (Number.isInteger(v) && v > 0 && items.has(v)) set.add(v);
      }
    }
    sysMembers.set(s.key, set);
  }

  const systems = [];
  for (const s of SYSTEMS) {
    const set = sysMembers.get(s.key);
    if (!set) continue;
    const ex = pickExamples(set);
    const allPh = ex.length > 0 && ex.every(e => e.name_placeholder);
    systems.push({
      key: s.key,
      condition: s.cond,
      item_count: set.size,
      examples: ex,
      ...(allPh ? { warn: `${s.key} 재료는 대표 예시 전부 표시명으로 특정 불가 — 재현스탭에 Index 병기 필수` } : {}),
    });
  }

  // 유형별 (분류 × 유형 — 컬럼 바인딩은 ITEM_COLS)
  const byType = new Map();
  for (const [idx, it] of items) {
    const k = `${it.inv}\u0000${it.type}`;
    if (!byType.has(k)) byType.set(k, []);
    byType.get(k).push(idx);
  }
  const types = [...byType.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'ko'))
    .map(([k, list]) => {
      const [inv, type] = k.split('\u0000');
      return { inventory_category: inv, item_type: type, item_count: list.length, examples: pickExamples(list) };
    });

  // 겸용 조합 — 0건도 반드시 싣는다(위 ⚠ 참조).
  const combos = [];
  const keys = systems.map(s => s.key);
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = sysMembers.get(keys[i]), b = sysMembers.get(keys[j]);
      const both = [...a].filter(x => b.has(x));
      combos.push({
        systems: [keys[i], keys[j]],
        item_count: both.length,
        examples: pickExamples(both),
        ...(both.length === 0
          ? { note: `${keys[i]}+${keys[j]} 겸용 아이템이 현행 테이블에 없음 — 이 조합을 전제한 TC 는 검증 불가(기획 확인 대상)` }
          : {}),
      });
    }
  }

  // 이름 색인 — "인용된 아이템명이 실제로 존재하는가"를 기계가 판정할 수 있게 한다.
  //   name_index: 표시명으로 개별 특정되는 아이템만 (name → Index)
  //   placeholder_names: 특정 불가한 표시명 (이 이름이 인용되면 Index 병기가 필수)
  // 없으면 "기억·추측으로 아이템명 쓰지 말 것" 규칙을 아무도 검사할 수 없다(산문으로만 남는다).
  const name_index = {};
  const phNames = new Set();
  for (const [idx, it] of items) {
    if (!it.name) continue;
    if (placeholderReason(it)) phNames.add(it.name);
    else if (!(it.name in name_index)) name_index[it.name] = idx;
  }

  return {
    generated_by: 'item_dict.js',
    ...(meta ? { source: meta } : {}),
    item_count: items.size,
    systems,
    combos,
    types,
    placeholder_names: [...phNames].sort((a, b) => a.localeCompare(b, 'ko')),
    name_index,
    ...(skipped.length ? { skipped } : {}),
  };
}

// GameString CSV — 값에 쉼표·따옴표가 섞이므로 따옴표를 아는 최소 파서를 쓴다(split(',') 는 값을 쪼갠다).
function parseCsvLine(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

module.exports = { buildDict, parseCsvLine, setSystems, setItemColumns, get SYSTEMS() { return SYSTEMS; }, DATA_ROW };

// ── CLI ──────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const argv = process.argv.slice(2);
  const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  const OUT = opt('--out');
  const TABLES = opt('--tables');
  const GSTR = opt('--gamestring');
  const SYSFILE = opt('--systems');

  if (!OUT) {
    console.error('사용: node item_dict.js --out <item_dict.json> --tables <dir> --systems <json> [--gamestring <dir>]');
    process.exit(2);
  }
  // 경로·스키마 바인딩은 전부 주입이다(하드코딩 기본값 없음). 하나라도 없으면 스킵 — 파이프라인 비차단.
  if (!TABLES || !SYSFILE) {
    console.error('[item_dict] --tables / --systems 미지정 — 스킵 (config 의 item_dict_tables · item_dict_systems 확인)');
    process.exit(4);
  }
  let SYSCFG;
  try { SYSCFG = JSON.parse(fs.readFileSync(SYSFILE, 'utf8')); }
  catch (e) {
    console.error(`[item_dict] systems 바인딩을 읽지 못함 — 스킵: ${SYSFILE} (${e.message})`);
    process.exit(4);
  }
  const ITEM_FILE = SYSCFG.item_file, ITEM_SHEET = SYSCFG.item_sheet;
  if (!ITEM_FILE || !ITEM_SHEET || !Array.isArray(SYSCFG.systems)) {
    console.error('[item_dict] systems 바인딩 형식 오류 — item_file · item_sheet · systems[] 필요 (template 참조)');
    process.exit(4);
  }
  setSystems(SYSCFG.systems);
  setItemColumns(SYSCFG.item_columns);   // 역할 → 실제 컬럼명 (없으면 역할명 그대로 = 스키마 미지정)
  // 원본이 없는 머신(CI·다른 PC)에서는 조용히 스킵 — 파이프라인을 막지 않는다.
  if (!fs.existsSync(path.join(TABLES, ITEM_FILE))) {
    console.error(`[item_dict] 원본 테이블 없음 — 스킵: ${TABLES}/${ITEM_FILE}`);
    process.exit(4);
  }
  let XLSX;
  try { XLSX = require('xlsx'); }
  catch (e) { console.error('[item_dict] xlsx 모듈 없음 — 스킵 (npm i xlsx)'); process.exit(4); }

  const readSheet = (file, sheet) => {
    const p = path.join(TABLES, file);
    if (!fs.existsSync(p)) return null;
    const wb = XLSX.readFile(p, { cellDates: false });
    if (!wb.SheetNames.includes(sheet)) return null;
    return XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, raw: true, defval: null });
  };

  const loc = new Map();
  if (GSTR && fs.existsSync(GSTR)) {
    for (const f of fs.readdirSync(GSTR).filter(x => x.toLowerCase().endsWith('.csv'))) {
      const txt = fs.readFileSync(path.join(GSTR, f), 'utf8').replace(/^\uFEFF/, '');
      for (const line of txt.split(/\r?\n/)) {
        if (!line) continue;
        const cells = parseCsvLine(line);
        const k = (cells[0] || '').trim();
        if (k && !loc.has(k)) loc.set(k, (cells[1] || '').trim());
      }
    }
  }

  const itemRows = readSheet(ITEM_FILE, ITEM_SHEET);
  if (!itemRows) { console.error(`[item_dict] ${ITEM_FILE} / ${ITEM_SHEET} 를 읽지 못함 — 스킵`); process.exit(4); }

  const systemRows = {};
  for (const s of SYSTEMS) systemRows[s.key] = readSheet(s.file, s.sheet);

  const out = buildDict(itemRows, systemRows, loc, { tables: TABLES, gamestring: GSTR });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');

  const sum = out.systems.map(s => `${s.key}=${s.item_count}`).join(' ');
  const zero = out.combos.filter(c => c.item_count === 0).map(c => c.systems.join('+'));
  console.error(`[item_dict] 생성 — 아이템 ${out.item_count}종 / ${sum}${zero.length ? ` / 겸용0건: ${zero.join(', ')}` : ''}`);
  process.exit(0);
}
