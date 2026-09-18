'use strict';
const assert = require('assert');
const {
  parseTableMap, findReferencedSheets, extractValueTokens, selectRows, renderSheet, buildExtract,
} = require('../lib/xlsx_extract.js');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  PASS ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' — ' + e.message); } }

// _테이블맵.md 실물 형식
const MAP_MD = [
  '## Map (Zone.xlsx)',
  '- 위치: `C:\\Game\\Tables\\Zone.xlsx`',
  '- 시트 **MapInfo** — 데이터 23행 · 키 Index(int32)',
  '  - 컬럼: Index, Name, MapGroup',
  '- 시트 **ZoneType** — 데이터 13행 · 키 Index(enum)',
  '## ConfigKey (Config.xlsx)',
  '- 시트 **ConfigInfo** — 데이터 111행 · 키 ConfigKey(enum)',
  '## Item (Goods.xlsx)',
  '- 시트 **GoodsInfo** — 데이터 5000행 · 키 Index(int32)',
  '- 시트 **GoodsCategory** — 데이터 40행 · 키 GoodsType(enum)',
  '- 시트 **#기획참고** — 데이터 3행 · 키 x',
  '## Quest (Quest.xlsx)',
  '- 시트 **Stage** — 데이터 17행 · 키 StageIndex(int32)',
].join('\n');

// 헤더행(0) + 한글설명(1) + 적용범위(2) + 타입(3) + 데이터(4~)
const sheet = (cols, data) => [cols, cols.map(() => '설명'), cols.map(() => 'all'), cols.map(() => 'int32'), ...data];

console.log('xlsx_extract.js 테스트');

t('테이블맵 파싱 — 시트 → 파일·행수 색인', () => {
  const idx = parseTableMap(MAP_MD);
  assert.deepStrictEqual(idx.get('ZoneType'), { file: 'Zone.xlsx', rows: 13 });
  assert.deepStrictEqual(idx.get('ConfigInfo'), { file: 'Config.xlsx', rows: 111 });
  assert.strictEqual(idx.get('GoodsInfo').file, 'Goods.xlsx');
});

t('참조 시트 탐지 — 시트명 단어 일치 + 지목된 xlsx 의 시트 전부, # 시트 제외', () => {
  const idx = parseTableMap(MAP_MD);
  const raw = 'ZoneType > CycleType 참조. ConfigInfo의 값. Goods.xlsx > GoodsCategory.GoodsType';
  const got = findReferencedSheets(raw, idx).map(s => s.sheet).sort();
  assert.deepStrictEqual(got, ['ConfigInfo', 'GoodsCategory', 'GoodsInfo', 'ZoneType']);
});

t('참조 시트 탐지 — 다른 단어 안의 부분 문자열은 시트로 치지 않는다 (StageIndex ≠ Stage)', () => {
  const idx = parseTableMap(MAP_MD);
  const got = findReferencedSheets('{1} 에는 StageIndex 를 참조', idx).map(s => s.sheet);
  assert.deepStrictEqual(got, []);
});

t('값 토큰 — = 오른쪽 한글 구절을 조사 앞에서 자른다', () => {
  const tk = extractValueTokens('GoodsCategory.GoodsType=던전 시간 충전이면서 Value / EntryConditionType = 전투력인 경우 Value');
  assert.ok(tk.has('던전 시간 충전'), [...tk].join('|'));
  assert.ok(tk.has('전투력'), [...tk].join('|'));
  assert.ok(tk.has('EntryConditionType'));
});

t('행 선택 — 작은 시트는 전량', () => {
  const rows = sheet(['Index', 'MaxStackLimit'], [['A', 120], ['B', 120]]);
  const sel = selectRows(rows, { maxRows: 200, tokens: new Set() });
  assert.strictEqual(sel.mode, 'full');
  assert.strictEqual(sel.data.length, 2);
  assert.strictEqual(sel.total, 2);
});

t('행 선택 — 큰 시트는 값 토큰과 칸이 정확히 같은 행만', () => {
  const data = Array.from({ length: 300 }, (_, i) => [i, i === 7 || i === 9 ? '던전 시간 충전' : '장비', 30]);
  const sel = selectRows(sheet(['Index', 'GoodsType', 'Value2'], data), { maxRows: 200, tokens: new Set(['던전 시간 충전']) });
  assert.strictEqual(sel.mode, 'filtered');
  assert.deepStrictEqual(sel.data.map(r => r[0]), [7, 9]);
  assert.strictEqual(sel.total, 300);
});

t('행 선택 — 큰 시트에 맞는 행이 없으면 none (값을 지어내지 않는다)', () => {
  const data = Array.from({ length: 300 }, (_, i) => [i, '장비']);
  const sel = selectRows(sheet(['Index', 'GoodsType'], data), { maxRows: 200, tokens: new Set(['던전 시간 충전']) });
  assert.strictEqual(sel.mode, 'none');
  assert.strictEqual(sel.data.length, 0);
});

t('렌더 — 블록 제목이 §1.2-2 출처 형식 그대로 (파일 > 시트 (N행, 빌드, 날짜))', () => {
  const rows = sheet(['ConfigKey', 'Value'], [['WeeklyResetDay', 1]]);
  const md = renderSheet({ file: 'Config.xlsx', sheet: 'ConfigInfo', rows, sel: selectRows(rows, { maxRows: 200, tokens: new Set() }), build: 'MAIN_BUILD', date: '2026-09-11' });
  assert.ok(md.includes('### Config.xlsx > ConfigInfo (1행, MAIN_BUILD, 2026-09-11)'), md);
  assert.ok(md.includes('WeeklyResetDay'));
  assert.ok(md.includes('| 1 |') || md.includes('| 1'), md);
});

t('참조 시트 탐지 — 시트명 직접 지목은 named, 파일만 지목된 시트는 named=false', () => {
  const idx = parseTableMap(MAP_MD);
  const by = Object.fromEntries(findReferencedSheets('Goods.xlsx > GoodsCategory.GoodsType', idx).map(s => [s.sheet, s.named]));
  assert.strictEqual(by.GoodsCategory, true);
  assert.strictEqual(by.GoodsInfo, false);
});

t('행 선택 — named=false 시트는 작아도 토큰 매칭 행만 (무관 시트가 통째로 딸려오지 않게)', () => {
  const rows = sheet(['Index', 'Path'], [[1, '/Game/Weapon/A'], [2, '/Game/Weapon/B']]);
  const sel = selectRows(rows, { maxRows: 200, tokens: new Set(['던전 시간 충전']), named: false });
  assert.strictEqual(sel.mode, 'none');
  assert.strictEqual(sel.total, 2);
});

t('통합 — 없는 파일은 누락 목록에 남기고 계속 (비차단)', () => {
  const idx = parseTableMap(MAP_MD);
  const read = (file, sh) => (sh === 'ZoneType' ? sheet(['Index', 'MaxStackLimit'], [['정예', 120]]) : null);
  const { md, stats } = buildExtract('ZoneType 참조 · ConfigInfo 참조', idx, read, { maxRows: 200, build: 'MAIN_BUILD', date: '2026-09-11' });
  assert.strictEqual(stats.written, 1);
  assert.deepStrictEqual(stats.missing, ['Config.xlsx > ConfigInfo']);
  assert.ok(md.includes('MaxStackLimit'));
  assert.ok(md.includes('Config.xlsx > ConfigInfo'), '누락도 파일에 적는다');
});

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
