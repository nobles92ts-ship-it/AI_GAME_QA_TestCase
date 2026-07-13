'use strict';
const assert = require('assert');
const { regroupRows, isContiguous } = require('../lib/regroup.js');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  PASS ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' — ' + e.message); } }
const R = (a, b, c, d, f) => [a, b, c, d, '정상', f, 'PC', '미진행', 'N/A', ''];

console.log('regroup.js 테스트');

t('비인접 그룹 감지', () => {
  const rows = [R('001', 'X', 'm', 'a', 'f1'), R('002', 'Y', 'n', 'b', 'f2'), R('003', 'X', 'm', 'a', 'f3')];
  assert.strictEqual(isContiguous(rows), false, 'X가 0,2로 분산');
});

t('재그룹화로 인접화 + 재번호', () => {
  const rows = [R('001', 'X', 'm', 'a', 'f1'), R('002', 'Y', 'n', 'b', 'f2'), R('003', 'X', 'm', 'a', 'f3')];
  const out = regroupRows(rows);
  assert.ok(isContiguous(out));
  // X 그룹(f1,f3) 먼저(최초등장), 그 다음 Y(f2)
  assert.deepStrictEqual(out.map(r => r[5]), ['f1', 'f3', 'f2']);
  assert.deepStrictEqual(out.map(r => r[0]), ['001', '002', '003']);
});

t('이미 인접이면 순서 불변(멱등)', () => {
  const rows = [R('001', 'X', 'm', 'a', 'f1'), R('002', 'X', 'm', 'a', 'f2'), R('003', 'Y', 'n', 'b', 'f3')];
  const out = regroupRows(rows);
  assert.deepStrictEqual(out.map(r => r[5]), ['f1', 'f2', 'f3']);
  const out2 = regroupRows(out);
  assert.deepStrictEqual(out2.map(r => r[5]), ['f1', 'f2', 'f3'], '멱등');
});

t('병합(빈 B/C/D 연속행) 그룹키 상속', () => {
  // 002는 B/C/D 빈값 → 001 그룹 상속. 003은 새 그룹. 004는 001 그룹 재등장(비인접)
  const rows = [
    R('001', 'X', 'm', 'a', 'f1'), ['002', '', '', '', '부정', 'f2', 'PC', '미진행', 'N/A', ''],
    R('003', 'Y', 'n', 'b', 'f3'), R('004', 'X', 'm', 'a', 'f4'),
  ];
  assert.strictEqual(isContiguous(rows), false);
  const out = regroupRows(rows);
  assert.ok(isContiguous(out));
  // X그룹: f1,f2(상속),f4 인접 → 그 다음 Y f3
  assert.deepStrictEqual(out.map(r => r[5]), ['f1', 'f2', 'f4', 'f3']);
});

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
