'use strict';
const assert = require('assert');
const { to7col, resolveAndWrite } = require('../lib/sheet_write.js');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  PASS ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' — ' + e.message); } }

console.log('sheet_write.js 테스트');

t('10열 → 7열 변환 [대,중,소,검증단계,재현스탭,플랫폼,비고]', () => {
  const rows = [['001', '기본기능', '진입', '버튼', '정상', 'F문장', 'PC', '미진행', 'N/A', '비고값']];
  const d = to7col(rows);
  assert.deepStrictEqual(d[0], ['기본기능', '진입', '버튼', '정상', 'F문장', 'PC', '비고값']);
  assert.strictEqual(d[0].length, 7);
});

t('빈 셀은 빈 문자열로', () => {
  const d = to7col([['001', '', '', '', '예외', 'F', 'PC/모바일', '미진행', '미진행', '']]);
  assert.deepStrictEqual(d[0], ['', '', '', '예외', 'F', 'PC/모바일', '']);
});

t('베이스 탭 비어있으면 생성', () => {
  const created = [];
  const res = resolveAndWrite(t => (created.push(t), { exit: 0 }), () => {}, { baseTab: '자동_사냥_기능', runId: 'r1', marker: null });
  assert.ok(res.ok);
  assert.strictEqual(res.tab, '자동_사냥_기능');
  assert.strictEqual(res.action, 'created');
});

t('베이스 탭 점유(남의 것) → _v2로 bump', () => {
  const res = resolveAndWrite(
    t => t === '자동_사냥_기능' ? { exit: 3 } : { exit: 0 },
    () => {},
    { baseTab: '자동_사냥_기능', runId: 'r1', marker: null });
  assert.ok(res.ok);
  assert.strictEqual(res.tab, '자동_사냥_기능_v2');
  assert.strictEqual(res.action, 'created');
});

t('_v2도 점유 → _v3', () => {
  const taken = new Set(['자동_사냥_기능', '자동_사냥_기능_v2']);
  const res = resolveAndWrite(t => taken.has(t) ? { exit: 3 } : { exit: 0 }, () => {}, { baseTab: '자동_사냥_기능', runId: 'r1', marker: null });
  assert.strictEqual(res.tab, '자동_사냥_기능_v3');
});

t('우리 소유 탭 존재(마커) → 삭제 후 재기록(clear_and_rewrite)', () => {
  const deleted = [];
  let deletedFlag = false;
  const res = resolveAndWrite(
    t => (t === '자동_사냥_기능_v2' && !deletedFlag) ? { exit: 3 } : { exit: 0 },
    t => { deleted.push(t); deletedFlag = true; },
    { baseTab: '자동_사냥_기능', runId: 'r1', marker: { run_id: 'r1', tab: '자동_사냥_기능_v2' } });
  assert.ok(res.ok);
  assert.strictEqual(res.tab, '자동_사냥_기능_v2');
  assert.strictEqual(res.action, 'clear_and_rewrite');
  assert.deepStrictEqual(deleted, ['자동_사냥_기능_v2']);
});

t('다른 run의 마커는 재사용 안 함(내 것만 clear)', () => {
  // marker.run_id != runId → 마커 후보 제외, 베이스부터. 베이스 점유면 bump.
  const res = resolveAndWrite(
    t => t === '자동_사냥_기능' ? { exit: 3 } : { exit: 0 },
    () => { throw new Error('남의 탭을 지우면 안 됨'); },
    { baseTab: '자동_사냥_기능', runId: 'r2', marker: { run_id: 'r1', tab: '자동_사냥_기능' } });
  assert.strictEqual(res.tab, '자동_사냥_기능_v2');
});

t('검증 오류(exit 4) → 즉시 중단(시트 미변형)', () => {
  const res = resolveAndWrite(() => ({ exit: 4 }), () => {}, { baseTab: 'X', runId: 'r1', marker: null });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.action, 'validation_error');
  assert.strictEqual(res.exit, 4);
});

t('모든 v접미사 점유 → no_free_tab', () => {
  const res = resolveAndWrite(() => ({ exit: 3 }), () => {}, { baseTab: 'X', runId: 'r1', marker: null, maxSuffix: 3 });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.action, 'no_free_tab');
});

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
