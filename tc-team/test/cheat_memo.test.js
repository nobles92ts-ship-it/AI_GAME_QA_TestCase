'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cm = require('../lib/cheat_memo');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; } catch (e) { fail++; console.error('FAIL ' + name + ': ' + e.stack); } }

const P = (name, optional = false, item = false) => ({ name, type: 'int', optional, item });
const cheats = [
  { id: 's:ClearTutorial', scope: 's', command: 'ClearTutorial', desc: '', params: [] },
  { id: 'c:DX_KillPlayer', scope: 'c', command: 'DX_KillPlayer', desc: '', params: [] },
  { id: 's:AddItem', scope: 's', command: 'AddItem', desc: '', params: [P('addItemIndex', false, true), P('itemCount', true)] },
  { id: 's:MoveMap', scope: 's', command: 'MoveMap', desc: '', params: [P('mapIndex'), P('x', true)] },
];
const byId = id => cheats.find(c => c.id === id);
const items = new Map([['회복 물약(대)', ['202012001']], ['회복 물약(소)', ['202010001', '202032001']],
  ['제작 재료 임시 명칭', ['1', '2', '3', '4']]]);

t('인자 없는 치트 → 그대로 한 줄 (서버는 s 접두)', () => {
  assert.deepStrictEqual(cm.buildLine(byId('s:ClearTutorial'), [], items), { lines: ['s ClearTutorial'] });
  assert.deepStrictEqual(cm.buildLine(byId('c:DX_KillPlayer'), [], items), { lines: ['DX_KillPlayer'] });
});
t('아이템 이름이 하나에만 걸리면 ID 확정, 생략 인자는 비움', () => {
  assert.deepStrictEqual(cm.buildLine(byId('s:AddItem'), ['회복 물약(대)'], items), { lines: ['s AddItem 202012001'] });
});
t('같은 이름이 여러 아이템이면 3개까지 한 줄씩 전부 (「있으면 있는 대로」)', () => {
  assert.deepStrictEqual(cm.buildLine(byId('s:AddItem'), ['회복 물약(소)'], items), { lines: ['s AddItem 202010001', 's AddItem 202032001'] });
});
t('양성 표본: 4개 이상 걸리는 이름은 너무 넓어 뺀다 · 표에 없는 이름은 다음 검색어로', () => {
  assert.match(cm.buildLine(byId('s:AddItem'), ['제작 재료 임시 명칭'], items).reason, /너무 넓음/);
  assert.deepStrictEqual(cm.buildLine(byId('s:AddItem'), ['없는 이름', '회복 물약(대)'], items), { lines: ['s AddItem 202012001'] });
});
t('양성 표본: 표에 없는 이름 · 등록 안 된 치트 · 아이템 외 필수 인자', () => {
  assert.match(cm.buildLine(byId('s:AddItem'), ['없는 물건'], items).reason, /표에 없는/);
  assert.match(cm.buildLine(undefined, [], items).reason, /등록되지/);
  assert.match(cm.buildLine(byId('s:MoveMap'), [], items).reason, /필수 인자/);
  assert(!cm.pickable(byId('s:MoveMap')) && cm.pickable(byId('s:AddItem')));
});
t('묶음은 대·중·소 첫 등장 순 · g 번호', () => {
  const g = cm.groupsOf([['001', 'A', 'B', 'C', '정상', 's1'], ['002', 'A', 'B', 'C', '정상', 's2'], ['003', 'A', 'B', 'D', '정상', 's3']]);
  assert.deepStrictEqual(g.map(x => [x.g, x.first_tc, x.tc_count]), [[1, '001', 2], [2, '003', 1]]);
});
t('resolve: g 로 조인(AI 가 돌려준 글자 무시) · 3개 상한 · 알림 줄', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cheatmemo-'));
  try {
    fs.writeFileSync(path.join(dir, 'cheat_groups.json'), JSON.stringify({ groups: [
      { g: 1, key: ['A', 'B', 'C'], first_tc: '001' }, { g: 2, key: ['A', 'B', 'D'], first_tc: '003' }] }));
    fs.writeFileSync(path.join(dir, '_cheat_picks.json'), JSON.stringify({ picks: [
      { g: 2, key: ['엉뚱', '글자'], cheats: [{ id: 's:ClearTutorial' }, { id: 'c:!사망' }, { id: 's:AddItem', terms: ['회복 물약(대)'] }, { id: 'c:DX_KillPlayer' }] }] }));
    const m = cm.resolve(dir, { dict: { source: 'fake', date: '2026-10-21', cheats }, itemNames: items });
    assert.deepStrictEqual(m.groups[0].lines, []);
    assert.deepStrictEqual(m.groups[1].lines, ['s ClearTutorial', 's AddItem 202012001'], '4번째는 상한 밖');
    assert.equal(m.groups[1].skipped[0].reason, '등록되지 않은 치트');
    assert.match(fs.readFileSync(path.join(dir, '.cheat_memo_notice.txt'), 'utf8'), /^🔧 소분류 치트 메모: 1\/2 소분류 · 고른 치트 3개 중 확실 2개/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
const sheet = [
  ['TC ID', '대분류', '중분류', '소분류'],
  ['001', 'A', 'B', 'C'], ['002', '', '', ''],      // 묶음 1 — 맨 윗줄 행 1
  ['003', '', '', 'D'], ['004', '', '', ''],        // 묶음 2 — 대·중은 위에서 잇는다
  ['005', 'A', 'E', 'C'],                           // 같은 소분류 글자라도 중분류가 다르면 다른 묶음
];
t('시트 맨 윗줄 찾기 — 빈 대·중·소는 위 값을 잇는다', () => {
  const top = cm.topRows(sheet);
  assert.equal(top.get(JSON.stringify(['A', 'B', 'C'])), 1);
  assert.equal(top.get(JSON.stringify(['A', 'B', 'D'])), 3);
  assert.equal(top.get(JSON.stringify(['A', 'E', 'C'])), 5);
});
t('메모 계획: 사람 메모 보호 · 우리 낡은 메모 지움 · 같은 값이면 안 씀', () => {
  const groups = [{ key: ['A', 'B', 'C'], lines: ['s ClearTutorial'] }, { key: ['A', 'B', 'D'], lines: ['DX_KillPlayer'] },
    { key: ['A', 'E', 'C'], lines: [] }];
  const notes = ['', '', '', '사람이 단 메모', '', cm.SIGNATURE + '\n옛 줄'];
  const p = cm.planNotes(sheet, notes, groups);
  assert.deepStrictEqual(p.writes, [{ row: 1, note: cm.SIGNATURE + '\ns ClearTutorial' }, { row: 5, note: '' }]);
  assert.deepStrictEqual(p.kept_human, [4]);
  const again = cm.planNotes(sheet, ['', cm.SIGNATURE + '\ns ClearTutorial', '', '사람이 단 메모', '', ''], groups);
  assert.deepStrictEqual(again.writes, [], '멱등');
});
t('실사전(Command.xlsx): 아이템 지급·인자 없는 치트는 후보, 맵 이동은 아님', () => {
  const d = cm.loadCheats('<GAMEDATA_ROOT>/ExcelTable');
  if (!d) { console.log('  (Command.xlsx 없음 — 건너뜀)'); return; }
  const f = id => d.cheats.find(c => c.id === id);
  for (const id of ['s:ClearTutorial', 's:AddItem', 'c:DX_KillPlayer']) assert(f(id) && cm.pickable(f(id)), id);
  assert(f('s:MoveMap') && !cm.pickable(f('s:MoveMap')));
  assert(f('s:AddItem').params[0].item);
});
console.log(`결과: ${pass} PASS / ${fail} FAIL`); process.exit(fail ? 1 : 0);
