#!/usr/bin/env node
'use strict';
/**
 * cheat_memo.js — 소분류 치트 메모 (2026-10-22, FINAL-5 안)
 *
 * DXQA 도우미 치트 찾기 방식을 옮겼다(DXQA_Native core.py·native_backend.py·situation_ai.py):
 *   ① AI(FINAL-5 치트, sonnet)는 등록된 치트 id 와 아이템 이름 검색어만 낸다 — 명령·ID 는 만들지 않는다.
 *   ② 이 파일이 이름을 Item 테이블에서 ID 로 확정하고, 인자 형식을 맞춰 한 줄로 조립한다.
 *   ③ 확실한 줄만 그 소분류 맨 윗줄 D칸 **셀 메모**로 단다. 셀 값은 바꾸지 않는다(소분류 글자는 게이트 묶음 열쇠).
 *
 * 「확실한 줄」 = 사전(Command.xlsx)에 있는 명령 · 필수 인자가 없거나 아이템 이름이 표에 있음(같은 이름 여럿이면
 *   3개까지 한 줄씩 전부) · 생략 가능한 인자는 기본값. 어긋나면 그 치트는 빼고 이유를 cheat_memo.json 에 남긴다.
 *
 * 사용:
 *   node cheat_memo.js prepare <spec> [--tables <dir>]                    → cheat_groups.json · cheat_catalog.json
 *   node cheat_memo.js resolve <spec> [--tables <dir>] [--gamestring <dir>] → cheat_memo.json · .cheat_memo_notice.txt
 *   node cheat_memo.js apply   <spec> --sheet-id <ID> --tab <탭> [--dry-run] → D칸 메모 기재 (--dry-run = 읽기만)
 * exit 0=완료 / 4=원본 없음(스킵) / 1=오류 — 어느 쪽이든 완료처리는 계속 간다(비차단).
 */
const fs = require('fs');
const path = require('path');
const { parseCsvLine } = require('./item_dict');

const SIGNATURE = '🔧 준비 치트 (tc-team)';
const MAX_PER_GROUP = 3;
const DEFAULT_TABLES = '<GAMEDATA_ROOT>/ExcelTable';
const DEFAULT_GSTR = '<GAMEDATA_ROOT>/CSV/GameString';
const HEAD_ROWS = 4; // Command.xlsx·Goods.xlsx: 1=헤더 2=설명 3=스코프 4=타입 — 데이터는 5행부터
// 아이템 ID 인자 — DXQA core.binding 의 GoodsInfo 연결과 같은 이름들
const ITEM_PARAMS = new Set(['itemindex', 'initemindex', 'additemindex']);

const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
function writeAtomic(file, text) { fs.writeFileSync(file + '.tmp', text); fs.renameSync(file + '.tmp', file); }

function loadXlsx() { try { return require('xlsx'); } catch { return null; } }

/** Command.xlsx → 치트 목록. 인자: 이름 · 생략 가능(기본값 표기 `= 1`) · 타입 · 아이템 ID 인지. */
function loadCheats(tables) {
  const XLSX = loadXlsx(), file = path.join(tables, 'Command.xlsx');
  if (!XLSX || !fs.existsSync(file)) return null;
  const wb = XLSX.readFile(file), out = [];
  for (const [scope, sheet] of [['s', 'CommandServer'], ['c', 'CommandClient']]) {
    if (!wb.Sheets[sheet]) continue;
    for (const r of XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: '' }).slice(HEAD_ROWS)) {
      const command = String(r[1] || '').trim();
      if (!command) continue;
      const params = [];
      for (let i = 3; i < r.length - 1; i += 2) {
        const type = String(r[i] || '').trim(), raw = String(r[i + 1] || '').trim();
        if (!type && !raw) continue;
        const name = raw.split('=')[0].trim();
        params.push({ name, type, optional: raw.includes('='), item: ITEM_PARAMS.has(name.toLowerCase()) });
      }
      out.push({ id: `${scope}:${command}`, scope, command, desc: String(r[2] || '').replace(/\s+/g, ' ').trim(), params });
    }
  }
  return { source: file, date: fs.statSync(file).mtime.toISOString().slice(0, 10), cheats: out };
}

/** 확실한 줄이 될 수 있는 치트만 — 필수 인자가 없거나, 필수 인자가 아이템 ID 하나뿐. */
const pickable = c => c.params.filter(p => !p.optional).every(p => p.item) && c.params.filter(p => !p.optional).length <= 1;

/** Goods.xlsx GoodsInfo + GameString → 표시명 → [Index…] (같은 이름 여럿이면 확정하지 않는다). */
function loadItemNames(tables, gamestring) {
  const XLSX = loadXlsx(), file = path.join(tables, 'Goods.xlsx');
  if (!XLSX || !fs.existsSync(file)) return null;
  const loc = new Map();
  if (fs.existsSync(gamestring)) {
    for (const f of fs.readdirSync(gamestring).filter(x => x.toLowerCase().endsWith('.csv'))) {
      for (const line of fs.readFileSync(path.join(gamestring, f), 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
        if (!line) continue;
        const cells = parseCsvLine(line), k = (cells[0] || '').trim();
        if (k && !loc.has(k)) loc.set(k, (cells[1] || '').trim());
      }
    }
  }
  const wb = XLSX.readFile(file);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets.GoodsInfo, { header: 1, defval: '' });
  const ci = name => rows[0].findIndex(h => String(h) === name);
  const iIdx = ci('Index'), iName = ci('NameCode'), names = new Map();
  for (const r of rows.slice(HEAD_ROWS)) {
    const idx = String(r[iIdx] || '').trim(), name = loc.get(String(r[iName] || '').trim());
    if (!idx || !name) continue;
    if (!names.has(name)) names.set(name, []);
    names.get(name).push(idx);
  }
  return names;
}

/** 최종 TC → 소분류 묶음(등장 순). g = 조인 번호 — AI 가 돌려준 글자로 조인하지 않는다. */
function groupsOf(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = JSON.stringify([r[1], r[2], r[3]]);
    if (!map.has(key)) map.set(key, { g: map.size + 1, key: [r[1], r[2], r[3]], first_tc: String(r[0]), tc_count: 0, steps: [] });
    const grp = map.get(key);
    grp.tc_count++;
    if (grp.steps.length < 2) grp.steps.push(String(r[5] || ''));
  }
  return [...map.values()];
}

function finalRows(spec) {
  const j = readJson(path.join(spec, 'tcteam_tc_final.json'));
  return Array.isArray(j) ? j : j.rows;
}

function prepare(spec, opts = {}) {
  const dict = loadCheats(opts.tables || DEFAULT_TABLES);
  if (!dict) return null;
  const catalog = dict.cheats.filter(pickable).map(c => ({ id: c.id, command: c.command, desc: c.desc,
    item_param: c.params.some(p => p.item && !p.optional) }));
  writeAtomic(path.join(spec, 'cheat_catalog.json'), JSON.stringify({ source: dict.source, date: dict.date, cheats: catalog }, null, 1) + '\n');
  const groups = groupsOf(finalRows(spec));
  writeAtomic(path.join(spec, 'cheat_groups.json'), JSON.stringify({ groups }, null, 1) + '\n');
  return { catalog: catalog.length, groups: groups.length };
}

/**
 * 고른 치트 하나 → 확실한 줄들 또는 빼는 이유.
 * 이름이 표에 있으면 걸린 아이템을 모두 한 줄씩 낸다(10-22 결정 — 같은 이름이 여럿이면 전부).
 * 표에 없으면 빼고, MAX_SAME_NAME 개보다 많이 걸리면 이름이 너무 넓어 뺀다.
 */
const MAX_SAME_NAME = 3;
function buildLine(cheat, terms, itemNames) {
  if (!cheat) return { reason: '등록되지 않은 치트' };
  if (!pickable(cheat)) return { reason: '아이템 외 필수 인자가 있어 값을 확정할 수 없음' };
  const head = (cheat.scope === 's' ? 's ' : '') + cheat.command;
  const item = cheat.params.find(p => !p.optional); // 생략 가능 인자는 기본값 — 뒤를 비워 둔다
  if (!item) return { lines: [head] };
  if (!itemNames) return { reason: 'Item 테이블을 읽지 못함' };
  const found = (terms || []).map(t => [t, itemNames.get(String(t).trim()) || []]).filter(([, ids]) => ids.length);
  if (!found.length) return { reason: '표에 없는 이름: ' + (terms || []).join(', ') };
  const [term, ids] = found[0];
  if (ids.length > MAX_SAME_NAME) return { reason: `이름이 아이템 ${ids.length}개에 걸려 너무 넓음: ${term}` };
  return { lines: ids.map(id => head + ' ' + id) };
}

function resolve(spec, opts = {}) {
  const dict = opts.dict || loadCheats(opts.tables || DEFAULT_TABLES);
  if (!dict) return null;
  const byId = new Map(dict.cheats.map(c => [c.id, c]));
  const itemNames = opts.itemNames !== undefined ? opts.itemNames : loadItemNames(opts.tables || DEFAULT_TABLES, opts.gamestring || DEFAULT_GSTR);
  const groups = readJson(path.join(spec, 'cheat_groups.json')).groups;
  const picksFile = path.join(spec, '_cheat_picks.json');
  const picks = fs.existsSync(picksFile) ? (readJson(picksFile).picks || []) : [];
  const byG = new Map(picks.filter(p => Number.isInteger(p?.g)).map(p => [p.g, p]));
  let picked = 0, kept = 0;
  const out = groups.map(grp => {
    const lines = [], skipped = [];
    for (const c of (byG.get(grp.g)?.cheats || []).slice(0, MAX_PER_GROUP)) {
      picked++;
      const r = buildLine(byId.get(c?.id), c?.terms, itemNames);
      if (r.lines) { kept++; for (const l of r.lines) if (!lines.includes(l)) lines.push(l); }
      else skipped.push({ id: c?.id, terms: c?.terms || [], reason: r.reason });
    }
    return { g: grp.g, key: grp.key, first_tc: grp.first_tc, lines, skipped };
  });
  const memo = { source: dict.source, date: dict.date, picked, kept, groups: out };
  writeAtomic(path.join(spec, 'cheat_memo.json'), JSON.stringify(memo, null, 1) + '\n');
  const withLines = out.filter(g => g.lines.length).length;
  writeAtomic(path.join(spec, '.cheat_memo_notice.txt'),
    `🔧 소분류 치트 메모: ${withLines}/${out.length} 소분류 · 고른 치트 ${picked}개 중 확실 ${kept}개 (빠진 이유 cheat_memo.json)\n`);
  return memo;
}

/** 시트 행 → 소분류 묶음 맨 윗줄. 대·중·소는 묶음 맨 윗줄에만 적힌다(EVAL-08) — 빈 칸은 위 값을 잇는다. */
function topRows(values) {
  const top = new Map();
  let cur = ['', '', ''];
  values.forEach((row, i) => {
    if (i === 0) return; // 머리글
    const [b, c, d] = [row[1], row[2], row[3]].map(v => String(v ?? '').trim());
    if (!String(row[0] ?? '').trim()) return;
    cur = [b || cur[0], c || cur[1], d || cur[2]];
    const key = JSON.stringify(cur);
    if (!top.has(key)) top.set(key, i);
  });
  return top;
}

/** 메모 계획: 우리 메모(서명)·빈 칸만 쓰고 지운다. 사람 메모는 그대로 두고 알린다. */
function planNotes(values, notes, groups) {
  const top = topRows(values), want = new Map(), writes = [], kept_human = [];
  for (const g of groups) {
    const row = top.get(JSON.stringify(g.key));
    if (row !== undefined && g.lines.length) want.set(row, [SIGNATURE, ...g.lines].join('\n'));
  }
  for (let r = 1; r < values.length; r++) {
    const have = notes[r] || '', ours = have.startsWith(SIGNATURE), w = want.get(r);
    if (w !== undefined) {
      if (have && !ours) kept_human.push(r + 1);
      else if (have !== w) writes.push({ row: r, note: w });
    } else if (ours) writes.push({ row: r, note: '' });
  }
  return { writes, kept_human, matched: want.size };
}

async function apply(spec, sheetId, tab, dryRun = false) {
  const { google } = require('googleapis');
  const { getAuthClient } = require(path.resolve(__dirname, '../../scripts/util/google_auth'));
  const memo = readJson(path.join(spec, 'cheat_memo.json'));
  const sheets = google.sheets({ version: 'v4', auth: await getAuthClient() });
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const sm = meta.data.sheets.find(s => s.properties.title === tab);
  if (!sm) throw new Error(`탭 "${tab}" 없음`);
  const grid = await sheets.spreadsheets.get({ spreadsheetId: sheetId, ranges: [`${tab}!A1:D`], includeGridData: true,
    fields: 'sheets(data(rowData(values(formattedValue,note))))' });
  const rd = grid.data.sheets[0].data[0].rowData || [];
  const values = rd.map(r => (r.values || []).map(v => v.formattedValue || ''));
  const notes = rd.map(r => ((r.values || [])[3] || {}).note || '');
  const plan = planNotes(values, notes, memo.groups);
  if (plan.writes.length && !dryRun) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: sheetId, requestBody: { requests: plan.writes.map(w => ({ updateCells: {
      range: { sheetId: sm.properties.sheetId, startRowIndex: w.row, endRowIndex: w.row + 1, startColumnIndex: 3, endColumnIndex: 4 },
      rows: [{ values: [{ note: w.note }] }], fields: 'note' } })) } });
  }
  return plan;
}

module.exports = { SIGNATURE, loadCheats, pickable, groupsOf, buildLine, prepare, resolve, topRows, planNotes };

if (require.main === module) {
  const [cmd, specArg, ...rest] = process.argv.slice(2);
  const opt = n => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : undefined; };
  const spec = specArg && path.resolve(specArg);
  const say = m => console.log('[치트 메모] ' + m);
  (async () => {
    if (!['prepare', 'resolve', 'apply'].includes(cmd) || !spec) throw new Error('사용: cheat_memo.js prepare|resolve|apply <spec> …');
    if (cmd === 'prepare') {
      const r = prepare(spec, { tables: opt('--tables') });
      if (!r) { say('Command.xlsx·xlsx 모듈 없음 — 건너뜀'); process.exit(4); }
      say(`후보 치트 ${r.catalog}개 · 소분류 ${r.groups}개`);
    } else if (cmd === 'resolve') {
      const m = resolve(spec, { tables: opt('--tables'), gamestring: opt('--gamestring') });
      if (!m) { say('Command.xlsx 없음 — 건너뜀'); process.exit(4); }
      say(`고른 ${m.picked}개 중 확실 ${m.kept}개`);
    } else {
      const sheetId = opt('--sheet-id'), tab = opt('--tab');
      if (!sheetId || !tab) throw new Error('apply 에는 --sheet-id · --tab 필요');
      const dry = rest.includes('--dry-run');
      const p = await apply(spec, sheetId, tab, dry);
      say(`${dry ? '(읽기만) ' : ''}메모 대상 ${p.matched}곳 · ${dry ? '바꿀' : '바꾼'} 칸 ${p.writes.length}` + (p.kept_human.length ? ` · 사람 메모라 건너뜀 ${p.kept_human.length}곳(행 ${p.kept_human.join(',')})` : ''));
    }
  })().catch(e => { console.error('[치트 메모] ' + e.message); process.exit(1); });
}
