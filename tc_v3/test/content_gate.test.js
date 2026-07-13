'use strict';
const assert = require('assert');
const fs = require('fs');
const { checkContent } = require('../lib/content_gate.js');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  PASS ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' — ' + e.message); } }

// 10열 [A,B,C,D,E,F,G,H,I,J]
const row = (over = {}) => {
  const r = ['001', 'QA', '중', '소', '정상', '버튼을 누르면 창이 열리는지 확인', 'PC/모바일', '미진행', '미진행', ''];
  if (over.F != null) r[5] = over.F;
  if (over.G != null) r[6] = over.G;
  if (over.J != null) r[9] = over.J;
  if (over.A != null) r[0] = over.A;
  return r;
};

console.log('content_gate.js 테스트');

t('클린 행 = PASS', () => {
  const res = checkContent([row(), row({ A: '002', G: 'PC' }), row({ A: '003', G: '모바일', J: '추후 구현' })]);
  assert.ok(res.pass, JSON.stringify(res.byType));
});

t('추상표현(정상적으로) 차단', () => {
  const res = checkContent([row({ F: '기능이 정상적으로 작동하는지 확인' })]);
  assert.strictEqual(res.pass, false);
  assert.strictEqual(res.byType.abstract, 1);
});

t('추상표현 — 올바르게/적절히/제대로/문제없이 전부 차단', () => {
  for (const w of ['올바르게', '적절히', '제대로', '문제없이']) {
    const res = checkContent([row({ F: `${w} 처리되는지 확인` })]);
    assert.strictEqual(res.pass, false, w);
  }
});

t('lookbehind — "비정상적으로"는 추상 아님(정당 표현)', () => {
  const res = checkContent([row({ F: '입력이 비정상적으로 크면 거부되는지 확인' })]);
  assert.strictEqual(res.byType.abstract, undefined, '비정상적으로는 통과해야');
});

t('Output Format 잔류 차단', () => {
  const res = checkContent([row({ F: "Output Format: '[사전 상태]에서 ~'" })]);
  assert.strictEqual(res.byType.output_format_residue, 1);
});

t('G열 enum 위반 차단 / 3종 허용', () => {
  assert.strictEqual(checkContent([row({ G: '윈도우' })]).byType.g_enum, 1);
  for (const g of ['PC', '모바일', 'PC/모바일']) assert.ok(checkContent([row({ G: g })]).pass, g);
});

t('J열 화이트리스트 — 4종+빈값+버그ID 허용, 그외 차단', () => {
  for (const j of ['', '추후 구현', '구현 우선순위 낮음', '기획 확인 필요', '버그ID-123', '버그ID-9']) {
    assert.ok(checkContent([row({ J: j })]).pass, 'allow: ' + j);
  }
  assert.strictEqual(checkContent([row({ J: '아무 메모' })]).byType.j_whitelist, 1);
  assert.strictEqual(checkContent([row({ J: '버그ID-abc' })]).byType.j_whitelist, 1, '버그ID 뒤 숫자 아니면 위반');
});

t('위반 리포트에 row index + tc_id 포함', () => {
  const res = checkContent([row({ A: '007', G: 'XBOX' })]);
  assert.strictEqual(res.violations[0].tc_id, '007');
  assert.strictEqual(res.violations[0].row, 0);
});

t('J는 trim 후 판정(공백만=빈값 허용)', () => {
  assert.ok(checkContent([row({ J: '   ' })]).pass);
});

// ── v2 content rules (added from A/B pilot feedback) ──
t('위임표현 + 무플래그 = 차단(delegation_unflagged)', () => {
  const res = checkContent([row({ F: '저장 정책이 스펙대로 처리되는지 확인' })]);
  assert.strictEqual(res.pass, false);
  assert.strictEqual(res.byType.delegation_unflagged, 1);
});

t('위임표현 + J=기획 확인 필요 = 경고만(통과)', () => {
  const res = checkContent([row({ F: '저장 정책이 스펙대로 처리되는지 확인', J: '기획 확인 필요' })]);
  assert.ok(res.pass, '플래그 있으면 차단 아님');
  assert.strictEqual(res.warnByType.delegation_flagged, 1);
});

t('위임표현 4종(스펙/규칙/정책/기준대로) 전부 감지', () => {
  for (const w of ['스펙대로', '규칙대로', '정책대로', '기준대로']) {
    const res = checkContent([row({ F: `동작이 ${w} 되는지 확인` })]);
    assert.strictEqual(res.byType.delegation_unflagged, 1, w);
  }
});

t("'정확히+동사' = 경고 등급(비차단)", () => {
  const res = checkContent([row({ F: '목록이 정확히 갱신되는지 확인' })]);
  assert.ok(res.pass, '경고는 차단 아님');
  assert.strictEqual(res.warnByType.exact_vague, 1);
});

t("'정확히 동일한 숫자'류(비동사)는 경고 아님", () => {
  const res = checkContent([row({ F: '두 번호가 정확히 동일한 숫자로 표시되는지 확인' })]);
  // '정확히 동일한'은 EXACT_VAGUE(동사 직결)에 안 걸림 — 구체 기준 동반 표현 허용
  assert.strictEqual(res.warnByType.exact_vague, undefined);
});

// Integration smokes below run against a local fixture set (not shipped). They skip cleanly
// when the fixture is absent, so the unit suite stays green out of the box.
t('integration: flagged-delegation set passes (skips without fixture)', () => {
  const p = './fixtures/sample_pilot/tc_final.json';
  if (!fs.existsSync(p)) { console.log('    (skip — no fixture)'); return; }
  const res = checkContent(JSON.parse(fs.readFileSync(p, 'utf8')).rows);
  assert.ok(res.pass, 'all delegation flagged → 0 blocks: ' + JSON.stringify(res.byType));
});

t('integration: unflagged delegation is detected (skips without fixture)', () => {
  const p = './fixtures/sample_pilot/baseline.json';
  if (!fs.existsSync(p)) { console.log('    (skip — no fixture)'); return; }
  const res = checkContent(JSON.parse(fs.readFileSync(p, 'utf8')).rows);
  assert.ok(res.byType.delegation_unflagged >= 1, 'unflagged delegation should be caught');
});

// Integration smoke: a prior-generation snapshot should still pass the content gate (equivalence).
t('integration: prior-generation snapshot passes gate (skips without fixture)', () => {
  const p = './fixtures/sample_feature/tc_snapshot.json';
  if (!fs.existsSync(p)) { console.log('    (skip — no fixture)'); return; }
  const snap = JSON.parse(fs.readFileSync(p, 'utf8'));
  const res = checkContent(snap.rows);
  assert.ok(res.pass, 'prior-generation output should pass content_gate: ' + JSON.stringify(res.violations.slice(0, 3)));
});

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
