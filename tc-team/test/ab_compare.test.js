'use strict';
const assert = require('assert');
const { compare, coverage } = require('../lib/ab_compare.js');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  PASS ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' — ' + e.message); } }
const R = (a, b, c, d, e, f) => [a, b, c, d, e, f, 'PC/모바일', '미진행', '미진행', ''];

console.log('ab_compare.js 테스트');

const rules = [
  { rule_id: 'R-1.1', text: '나를 공격 중인 몬스터를 1순위로 타겟팅' },
  { rule_id: 'R-1.2', text: '파티원을 공격 중인 몬스터를 2순위로 타겟팅' },
  { rule_id: 'R-2.1', text: '유저에게 피격되어도 몬스터 자동 사냥 유지' },
];
const v2 = { rows: [
  R('001', 'QA', 'm', '타겟', '정상', '나를 공격 중인 몬스터를 1순위로 타겟팅하는지 확인'),
  R('002', 'QA', 'm', '타겟', '정상', '파티원을 공격 중인 몬스터를 2순위로 타겟팅하는지 확인'),
] };
const v3 = { rows: [
  R('001', 'QA', 'm', '타겟', '정상', '나를 공격 중인 몬스터를 1순위로 타겟팅하는지 확인'),
  R('002', 'QA', 'm', '타겟', '정상', '파티원을 공격 중인 몬스터를 2순위로 타겟팅하는지 확인'),
  R('003', 'QA', 'x', '피격', '부정', '유저에게 피격되어도 몬스터 대상 자동 사냥이 유지되는지 확인'),
] };

t('TC 수 델타 + 퍼센트', () => {
  const r = compare(v2, v3, rules);
  assert.strictEqual(r.counts.total.v2, 2);
  assert.strictEqual(r.counts.total.v3, 3);
  assert.strictEqual(r.counts.total.delta, 1);
  assert.strictEqual(r.counts.total.pct, 50);
});

t('콘텐츠 위반 양쪽 0', () => {
  const r = compare(v2, v3, rules);
  assert.strictEqual(r.content_violations.v2, 0);
  assert.strictEqual(r.content_violations.v3, 0);
});

t('커버리지 근사 — v3가 R-2.1 추가 커버(v3_only)', () => {
  const r = compare(v2, v3, rules);
  assert.ok(r.coverage_approx.v3.covered >= r.coverage_approx.v2.covered);
  assert.ok(r.coverage_approx.v3_only.includes('R-2.1'), 'v3가 유저피격 규칙 추가 커버: ' + JSON.stringify(r.coverage_approx));
  assert.strictEqual(r.coverage_approx.v2_only.length, 0);
});

t('coverage 함수 — 미커버 규칙 목록', () => {
  const cov = coverage(rules, v2.rows);
  assert.ok(cov.missed.includes('R-2.1'));
  assert.strictEqual(cov.covered, 2);
});

t('콘텐츠 위반 유입 감지(v3에 추상표현)', () => {
  const bad = { rows: [R('001', 'QA', 'm', 't', '정상', '정상적으로 타겟팅되는지 확인')] };
  const r = compare(v2, bad, rules);
  assert.strictEqual(r.content_violations.v3, 1);
});

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
