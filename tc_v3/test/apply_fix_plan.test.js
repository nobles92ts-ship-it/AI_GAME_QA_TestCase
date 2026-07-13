'use strict';
const assert = require('assert');
const { applyFixPlan, patchId } = require('../lib/apply_fix_plan.js');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  PASS ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' — ' + e.message); } }

const snap = () => ({
  headers: ['TC ID', '대분류', '중분류', '소분류', '검증단계', '재현 스탭', '플랫폼', 'PC 결과', '모바일 결과', '비고'],
  rows: [
    ['001', '기본기능', '진입', '버튼', '정상', '버튼 누르면 열리는지 확인', 'PC', '미진행', 'N/A', ''],
    ['002', 'QA', '타겟팅', '우선순위', '정상', '1순위 대상이 선택되는지 확인', 'PC/모바일', '미진행', '미진행', ''],
    ['003', '', '', '', '예외', '대상 없으면 대기하는지 확인', 'PC/모바일', '미진행', '미진행', ''],
    ['004', 'QA', '파티', '따라가기', '정상', '파티장 따라가는지 확인', 'PC/모바일', '미진행', '미진행', ''],
  ],
});

console.log('apply_fix_plan.js 테스트');

t('edit_cell — F열 변경 적용', () => {
  const r = applyFixPlan(snap(), { patches: [{ op: 'edit_cell', tc_id: '002', col: 'F', before: '1순위 대상이 선택되는지 확인', after: '나를 공격 중인 몬스터가 1순위로 선택되는지 확인', reason: 'x' }] }, null);
  assert.strictEqual(r.conflicts.length, 0);
  assert.strictEqual(r.applied.length, 1);
  assert.strictEqual(r.rows[1][5], '나를 공격 중인 몬스터가 1순위로 선택되는지 확인');
});

t('edit_cell — before 불일치는 충돌(미적용)', () => {
  const r = applyFixPlan(snap(), { patches: [{ op: 'edit_cell', tc_id: '002', col: 'F', before: '틀린 원본', after: 'Z', reason: 'x' }] }, null);
  assert.strictEqual(r.applied.length, 0);
  assert.strictEqual(r.conflicts.length, 1);
  assert.strictEqual(r.conflicts[0].reason, 'before_mismatch');
  assert.strictEqual(r.rows[1][5], '1순위 대상이 선택되는지 확인'); // 원본 보존
});

t('edit_cell — current==after는 no-op 멱등', () => {
  const r = applyFixPlan(snap(), { patches: [{ op: 'edit_cell', tc_id: '001', col: 'G', after: 'PC', reason: 'x' }] }, null);
  assert.strictEqual(r.conflicts.length, 0);
  assert.ok(r.applied[0].noop);
});

t('edit_cell — tc_id 부재 충돌', () => {
  const r = applyFixPlan(snap(), { patches: [{ op: 'edit_cell', tc_id: '999', col: 'F', after: 'Z' }] }, null);
  assert.strictEqual(r.conflicts[0].reason, 'tc_id_not_found');
});

t('edit_cell — 잘못된 열 충돌', () => {
  const r = applyFixPlan(snap(), { patches: [{ op: 'edit_cell', tc_id: '001', col: 'Z', after: 'x' }] }, null);
  assert.strictEqual(r.conflicts[0].reason, 'bad_col');
});

t('delete_row — 삭제 후 A열 재번호', () => {
  const r = applyFixPlan(snap(), { patches: [{ op: 'delete_row', tc_id: '002', reason: 'x' }] }, null);
  assert.strictEqual(r.rows.length, 3);
  assert.deepStrictEqual(r.rows.map(x => x[0]), ['001', '002', '003']); // 재번호
  assert.strictEqual(r.rows[1][5], '대상 없으면 대기하는지 확인'); // 구 003이 002로
});

t('add_row — 앵커 뒤 삽입 + 재번호 + H/I 기본값', () => {
  const r = applyFixPlan(snap(), { patches: [{ op: 'add_row', after_tc_id: '002', row: { b: '', c: '', d: '', e: '예외', f: '2순위 대상이 없으면 3순위로 넘어가는지 확인', g: 'PC/모바일' }, reason: 'coverage' }] }, null);
  assert.strictEqual(r.rows.length, 5);
  assert.strictEqual(r.rows[2][5], '2순위 대상이 없으면 3순위로 넘어가는지 확인'); // 002 뒤 = index 2
  assert.strictEqual(r.rows[2][7], '미진행'); // H 기본
  assert.strictEqual(r.rows[2][8], '미진행'); // I 기본
  assert.deepStrictEqual(r.rows.map(x => x[0]), ['001', '002', '003', '004', '005']);
});

t('add_row — 앵커 부재 충돌', () => {
  const r = applyFixPlan(snap(), { patches: [{ op: 'add_row', after_tc_id: '999', row: { f: 'x' } }] }, null);
  assert.strictEqual(r.conflicts[0].reason, 'anchor_not_found');
});

t('멱등 — 같은 plan 2회 적용(ledger 경유) 시 2회차는 신규 0', () => {
  const plan = { patches: [
    { op: 'edit_cell', tc_id: '002', col: 'F', after: '수정된 문장', reason: 'x' },
    { op: 'add_row', after_tc_id: '004', row: { e: '예외', f: '추가된 케이스', g: 'PC' }, reason: 'y' },
  ] };
  const r1 = applyFixPlan(snap(), plan, null);
  const s2 = Object.assign({}, snap(), { rows: r1.rows });
  const r2 = applyFixPlan(s2, plan, r1.ledger);
  assert.strictEqual(r1.rows.length, 5, 'r1 add로 5행');
  assert.strictEqual(r2.rows.length, 5, 'r2 중복 add 없음(멱등)');
  assert.strictEqual(r2.applied.length, 0, 'r2 신규 적용 0');
  assert.strictEqual(r2.skipped.length, 2, 'r2 전부 ledger 스킵');
});

t('add_row — ledger 없이 2회면 중복(ledger 필요성 입증)', () => {
  const plan = { patches: [{ op: 'add_row', after_tc_id: '004', row: { f: 'dup' } }] };
  const r1 = applyFixPlan(snap(), plan, null);
  const s2 = Object.assign({}, snap(), { rows: r1.rows });
  const r2 = applyFixPlan(s2, plan, null); // ledger 미전달
  assert.strictEqual(r1.rows.length, 5);
  assert.strictEqual(r2.rows.length, 6, 'ledger 없으면 중복 삽입 — 그래서 ledger가 필수');
});

t('복합 — edit+delete+add 동시, 순서 독립', () => {
  const plan = { patches: [
    { op: 'add_row', after_tc_id: '001', row: { e: '예외', f: '신규A', g: 'PC' } },
    { op: 'edit_cell', tc_id: '004', col: 'J', after: '추후 구현' },
    { op: 'delete_row', tc_id: '003' },
  ] };
  const r = applyFixPlan(snap(), plan, null);
  assert.strictEqual(r.conflicts.length, 0);
  assert.strictEqual(r.rows.length, 4); // 4 - 1(del) + 1(add)
  assert.strictEqual(r.rows[1][5], '신규A'); // 001 뒤 삽입
  const four = r.rows.find(x => x[5] === '파티장 따라가는지 확인');
  assert.strictEqual(four[9], '추후 구현'); // edit 유지(원본 tc_id 004 기준)
  assert.ok(!r.rows.some(x => x[5] === '대상 없으면 대기하는지 확인')); // 003 삭제됨
});

t('patchId — reason 달라도 동일 패치 = 같은 id', () => {
  const a = patchId({ op: 'edit_cell', tc_id: '1', col: 'F', after: 'X', reason: 'aaa' });
  const b = patchId({ op: 'edit_cell', tc_id: '1', col: 'F', after: 'X', reason: 'bbb' });
  assert.strictEqual(a, b);
});

t('원본 스냅샷 불변(immutability)', () => {
  const s = snap();
  const before = JSON.stringify(s.rows);
  applyFixPlan(s, { patches: [{ op: 'edit_cell', tc_id: '001', col: 'F', after: 'CHANGED' }] }, null);
  assert.strictEqual(JSON.stringify(s.rows), before, '입력 스냅샷이 변형되면 안 됨');
});

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
