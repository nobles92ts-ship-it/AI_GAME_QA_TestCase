'use strict';
const assert = require('assert');
const { buildLedger, EXCLUSION_REASONS } = require('../lib/traceability.js');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  PASS ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' — ' + e.message); } }

console.log('traceability.js 테스트');

const rules = [
  { rule_id: 'R-1.1', sec_id: 'R-1', text: '문서 목적을 정리합니다.' },
  { rule_id: 'R-2.1', sec_id: 'R-2', text: '미니맵을 클릭하면 월드맵이 열립니다.' },
  { rule_id: 'R-2.2', sec_id: 'R-2', text: '각 NPC는 아이콘으로 구분합니다.' },
];

t('기본 — 커버/제외/미커버 분류 + 게이트', () => {
  const r = buildLedger(rules, [{ rule_id: 'R-2.1', tc_ids: [10, 11] }], [{ rule_id: 'R-1.1', reason: '비TC성서술' }]);
  assert.strictEqual(r.summary.covered, 1);
  assert.strictEqual(r.summary.excluded, 1);
  assert.deepStrictEqual(r.uncovered, ['R-2.2']);
  assert.strictEqual(r.gate.pass, false, '미커버가 있으면 게이트 FAIL');
});

t('미커버 0 + 제외 사유 정상 → 게이트 PASS', () => {
  const r = buildLedger(rules,
    [{ rule_id: 'R-2.1', tc_ids: [10] }, { rule_id: 'R-2.2', tc_ids: [12] }],
    [{ rule_id: 'R-1.1', reason: '비TC성서술' }]);
  assert.strictEqual(r.gate.pass, true);
  assert.strictEqual(r.summary.coverage_rate, 1);
});

// ── 래퍼 관용 (2026-07-29 신설) ──
// 원장은 LLM 산출이라 {coverage:[...]}/{exclusions:[...]} 형태로 오는 일이 잦다.
// 예전엔 exclusions 래퍼가 곧장 TypeError로 체인을 세웠다(월드맵_2차_개선 런).
t('coverage 래퍼 {coverage:[...]} 허용', () => {
  const r = buildLedger(rules, { coverage: [{ rule_id: 'R-2.1', tc_ids: [10] }] }, [{ rule_id: 'R-1.1', reason: '비TC성서술' }]);
  assert.strictEqual(r.summary.covered, 1, '래퍼가 벗겨지지 않음');
  assert.strictEqual(r.danglingCoverage.length, 0, '래퍼 키가 dangling rule_id로 오인됨');
});

t('exclusions 래퍼 {exclusions:[...]} 허용 — TypeError 재발 방지', () => {
  const r = buildLedger(rules, [{ rule_id: 'R-2.1', tc_ids: [10] }], { exclusions: [{ rule_id: 'R-1.1', reason: '비TC성서술' }] });
  assert.strictEqual(r.summary.excluded, 1, '래퍼가 벗겨지지 않음');
});

t('coverage 객체 맵 형식도 계속 지원', () => {
  const r = buildLedger(rules, { 'R-2.1': [10, 11] }, []);
  assert.strictEqual(r.summary.covered, 1);
});

t('exclusions 미지정(기본값)에서도 크래시 없음', () => {
  const r = buildLedger(rules, [{ rule_id: 'R-2.1', tc_ids: [10] }]);
  assert.strictEqual(r.summary.excluded, 0);
  assert.strictEqual(r.summary.uncovered, 2);
});

// ── 제외 사유 정확값 검사 ──
t('서술형 제외 사유는 badExclusion으로 FAIL', () => {
  const r = buildLedger(rules, [{ rule_id: 'R-2.1', tc_ids: [10] }, { rule_id: 'R-2.2', tc_ids: [12] }],
    [{ rule_id: 'R-1.1', reason: '비TC성 서술 — 문서 목적 문단' }]);
  assert.strictEqual(r.badExclusion.length, 1, '정확값 아닌 사유가 통과됨');
  assert.strictEqual(r.gate.pass, false);
});

t('허용 사유는 3종뿐', () => {
  assert.deepStrictEqual(EXCLUSION_REASONS, ['타기획서', '비TC성서술', '중복규칙']);
});

t('note 필드가 있어도 reason 판정에 영향 없음', () => {
  const r = buildLedger(rules, [{ rule_id: 'R-2.1', tc_ids: [10] }, { rule_id: 'R-2.2', tc_ids: [12] }],
    [{ rule_id: 'R-1.1', reason: '비TC성서술', note: '개요 문단 — 검증 대상 아님' }]);
  assert.strictEqual(r.badExclusion.length, 0);
  assert.strictEqual(r.gate.pass, true);
});

// ── 드리프트 감지 ──
t('존재하지 않는 rule_id를 가리키면 dangling으로 FAIL', () => {
  const r = buildLedger(rules,
    [{ rule_id: 'R-2.1', tc_ids: [10] }, { rule_id: 'R-2.2', tc_ids: [12] }, { rule_id: 'R-9.9', tc_ids: [99] }],
    [{ rule_id: 'R-1.1', reason: '비TC성서술' }]);
  assert.deepStrictEqual(r.danglingCoverage, ['R-9.9']);
  assert.strictEqual(r.gate.pass, false);
});

t('tc_ids 빈 배열은 커버로 치지 않음', () => {
  const r = buildLedger(rules, [{ rule_id: 'R-2.1', tc_ids: [] }], []);
  assert.ok(r.uncovered.includes('R-2.1'), '빈 tc_ids가 커버로 계산됨');
});

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
