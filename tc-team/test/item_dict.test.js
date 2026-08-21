'use strict';
const assert = require('assert');
const { buildDict, parseCsvLine, setSystems } = require('../lib/item_dict.js');

// 바인딩은 config 소유(하드코딩 기본값 없음) — 테스트도 주입해서 쓴다.
// 형식·의미는 lib/item_dict.systems.json.template 과 동일.
setSystems([
  { key: '제작', file: 'SystemA.xlsx', sheet: 'TableA', col: 'ColA', cond: 'SystemA.TableA.ColA 등재' },
  { key: '강화', file: 'SystemB.xlsx', sheet: 'TableB', col: 'ColB', cond: 'SystemB.TableB.ColB 등재' },
  { key: '가공', file: 'SystemC.xlsx', sheet: 'TableC', col: 'ColC', cond: 'SystemC.TableC.ColC 등재' },
  { key: '수집', file: 'SystemD.xlsx', sheet: 'TableD', col: 'ColD', cond: 'SystemD.TableD.ColD 등재' },
]);

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  PASS ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' — ' + e.message); } }

// ItemInfo 형태: 헤더행(0) + 한글설명(1) + DevFlag(2) + 타입(3) + 데이터(4~)
const IH = ['Index', 'Description', 'NameCode', 'ItemType', 'InventoryCategory', 'Grade', 'UseInLive'];
const filler = ['', '', ''];
function itemSheet(rows) {
  return [IH, ['(DB)인덱스', '기획 참고', '표시 이름', 'ItemType', 'InventoryCategory', 'Grade', '라이브'], filler, filler, ...rows];
}
// [Index, Description, NameCode, ItemType, InventoryCategory, Grade, UseInLive]
const I = (idx, code, type, inv = '재료', live = true) => [idx, '', code, type, inv, '일반', live];

function sysSheet(colName, values) {
  return [['Index', colName], ['(DB)인덱스', '재료'], filler, filler, ...values.map((v, i) => [i + 1, v])];
}

console.log('item_dict.js 테스트');

t('소비 시스템 소속 판정 — 레시피 재료만 제작 시스템에 든다', () => {
  const items = itemSheet([I(301, 'ItemName_A', '제작 재료'), I(302, 'ItemName_B', '성장 재료')]);
  const loc = new Map([['ItemName_A', '샘플 재료A'], ['ItemName_B', '샘플 강화권B']]);
  const d = buildDict(items, { 제작: sysSheet('ColA', [301]), 강화: sysSheet('ColB', [302]) }, loc);
  const craft = d.systems.find(s => s.key === '제작');
  assert.strictEqual(craft.item_count, 1);
  assert.strictEqual(craft.examples[0].index, 301);
  assert.strictEqual(craft.examples[0].cite, '샘플 재료A');
});

t('겸용 0건도 combos 에 실린다 + note 를 단다 (반증 근거 — 지우면 안 됨)', () => {
  const items = itemSheet([I(301, 'ItemName_A', '제작 재료'), I(302, 'ItemName_B', '성장 재료')]);
  const loc = new Map([['ItemName_A', '샘플 재료A'], ['ItemName_B', '샘플 강화권B']]);
  const d = buildDict(items, { 제작: sysSheet('ColA', [301]), 강화: sysSheet('ColB', [302]) }, loc);
  const combo = d.combos.find(c => c.systems.join('+') === '제작+강화');
  assert.strictEqual(combo.item_count, 0);
  assert.ok(/현행 테이블에 없음/.test(combo.note), 'note 로 검증 불가를 알려야 한다');
});

t('겸용 아이템이 실제로 있으면 예시가 실린다', () => {
  const items = itemSheet([I(301, 'ItemName_A', '성장 재료')]);
  const loc = new Map([['ItemName_A', '만능 결정']]);
  const d = buildDict(items, { 제작: sysSheet('ColA', [301]), 강화: sysSheet('ColB', [301]) }, loc);
  const combo = d.combos.find(c => c.systems.join('+') === '제작+강화');
  assert.strictEqual(combo.item_count, 1);
  assert.strictEqual(combo.examples[0].cite, '만능 결정');
  assert.strictEqual(combo.note, undefined);
});

t('표시명 공유 → placeholder + cite 에 Index 병기 (제작 재료 60종 실측 함정)', () => {
  const items = itemSheet([I(301, 'ItemName_Sample_Temp', '제작 재료'), I(302, 'ItemName_Sample_Temp', '제작 재료')]);
  const loc = new Map([['ItemName_Sample_Temp', '제작 재료 임시 명칭']]);
  const d = buildDict(items, { 제작: sysSheet('ColA', [301, 302]) }, loc);
  const ex = d.systems.find(s => s.key === '제작').examples[0];
  assert.strictEqual(ex.name_placeholder, true);
  assert.strictEqual(ex.placeholder_reason, 'shared');
  assert.strictEqual(ex.cite, '제작 재료 임시 명칭(Index 301)');
});

t('예시 전부 placeholder 면 시스템에 warn 을 단다', () => {
  const items = itemSheet([I(301, 'ItemName_Sample_Temp', '제작 재료'), I(302, 'ItemName_Sample_Temp', '제작 재료')]);
  const loc = new Map([['ItemName_Sample_Temp', '제작 재료 임시 명칭']]);
  const d = buildDict(items, { 제작: sysSheet('ColA', [301, 302]) }, loc);
  assert.ok(/Index 병기 필수/.test(d.systems.find(s => s.key === '제작').warn));
});

t('placeholder 사유 3종 구분 — temp_code / temp_word / no_string', () => {
  const items = itemSheet([
    I(401, 'ItemName_Test_Stone_1', '성장 재료'),
    I(402, 'ItemName_B', '성장 재료'),
    I(403, 'ItemName_Missing', '성장 재료'),
  ]);
  const loc = new Map([['ItemName_Test_Stone_1', '수호석'], ['ItemName_B', '임시 물약']]);
  const d = buildDict(items, {}, loc);
  const by = {};
  for (const e of d.types.find(x => x.item_type === '성장 재료').examples) by[e.index] = e;
  assert.strictEqual(by[401].placeholder_reason, 'temp_code');
  assert.strictEqual(by[402].placeholder_reason, 'temp_word');
  assert.strictEqual(by[403].placeholder_reason, 'no_string');
});

t('예시 정렬 — live 우선 → 이름으로 특정되는 것 우선 → Index 오름차순', () => {
  const items = itemSheet([
    I(501, 'ItemName_Shared', '제작 재료', '재료', true),
    I(502, 'ItemName_Shared', '제작 재료', '재료', true),
    I(503, 'ItemName_Named', '제작 재료', '재료', true),
    I(504, 'ItemName_Dead', '제작 재료', '재료', false),
  ]);
  const loc = new Map([['ItemName_Shared', '공유 이름'], ['ItemName_Named', '고유 이름'], ['ItemName_Dead', '비라이브']]);
  const d = buildDict(items, {}, loc);
  const ex = d.types.find(x => x.item_type === '제작 재료').examples;
  assert.strictEqual(ex[0].index, 503, '이름으로 특정되는 live 아이템이 먼저');
  assert.strictEqual(ex[1].index, 501, '같은 조건이면 Index 오름차순');
});

t('시트·컬럼이 없는 시스템은 skipped 에 사유를 남기고 죽지 않는다', () => {
  const items = itemSheet([I(301, 'ItemName_A', '제작 재료')]);
  const loc = new Map([['ItemName_A', '샘플 재료A']]);
  const d = buildDict(items, { 제작: sysSheet('wrong_col', [301]), 강화: null }, loc);
  assert.strictEqual(d.systems.length, 0, '컬럼 없으면 시스템 미포함');
  assert.strictEqual(d.skipped.length, 4, 'SYSTEMS 4종 전부 사유 기록');
  assert.ok(d.skipped.some(s => /컬럼 없음/.test(s.reason)));
});

t('획득 경로는 소비처가 아니다 — SYSTEMS 밖 테이블은 사전에 안 들어온다', () => {
  const items = itemSheet([I(301, 'ItemName_A', '제작 재료')]);
  const loc = new Map([['ItemName_A', '샘플 재료A']]);
  // RewardGroup 처럼 SYSTEMS 에 없는 키는 무시돼야 한다
  const d = buildDict(items, { RewardGroup: sysSheet('RewardIndex', [301]) }, loc);
  assert.strictEqual(d.systems.length, 0);
  assert.strictEqual(d.combos.length, 0);
});

t('데이터 시작 행 앞의 메타행(한글설명·타입)을 아이템으로 읽지 않는다', () => {
  const items = itemSheet([I(301, 'ItemName_A', '제작 재료')]);
  const d = buildDict(items, {}, new Map([['ItemName_A', '샘플 재료A']]));
  assert.strictEqual(d.item_count, 1);
});

t('GameString CSV 파서 — 따옴표 안의 쉼표를 쪼개지 않는다', () => {
  assert.deepStrictEqual(parseCsvLine('Key_A,"이름, 부제",Cat'), ['Key_A', '이름, 부제', 'Cat']);
  assert.deepStrictEqual(parseCsvLine('Key_B,값,,'), ['Key_B', '값', '', '']);
  assert.deepStrictEqual(parseCsvLine('Key_C,"""인용"" 포함"'), ['Key_C', '"인용" 포함']);
});

console.log(`결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
