'use strict';
/**
 * Phase 0 스파이크 — tc-v3 결정론 스파인을 실물 데이터로 end-to-end 실행 + 불변식 검증.
 * LLM 무관(한도 영향 없음). 목적: 유틸 합성이 실물에서 돌아가는가 + 격리 불변식 성립하는가.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { slice } = require('../lib/slicer.js');
const { runGate } = require('../lib/design_gate.js');
const { checkContent } = require('../lib/content_gate.js');
const { buildLedger } = require('../lib/traceability.js');
const { applyFixPlan } = require('../lib/apply_fix_plan.js');
const { diff } = require('../lib/golden_diff.js');

const NODE = process.execPath;
const SPEC = process.env.TC_SPEC_DIR || './fixtures/sample_feature';
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + ' — ' + e.message); } }
function manifest(dir) {
  const m = {};
  for (const f of fs.readdirSync(dir)) { const s = fs.statSync(path.join(dir, f)); if (s.isFile()) m[f] = s.size + ':' + s.mtimeMs; }
  return m;
}

console.log('═══ tc-v3 Phase 0 spike (integration — skips without fixture) ═══\n');

if (!fs.existsSync(path.join(SPEC, 'confluence_raw.md')) || !fs.existsSync(path.join(SPEC, 'tc_snapshot.json'))) {
  console.log('no fixture — spike skipped'); process.exit(0);
}

const rawText = fs.readFileSync(path.join(SPEC, 'confluence_raw.md'), 'utf8');
const snap = JSON.parse(fs.readFileSync(path.join(SPEC, 'tc_snapshot.json'), 'utf8'));
const hasDesign = fs.existsSync(path.join(SPEC, 'tc_design.md'));

// ── S4 슬라이서 ──
let sliced;
t('S4 슬라이서 — 기획서 원문 분해', () => {
  sliced = slice(rawText);
  assert.ok(sliced.sections.length >= 3 && sliced.rules.length >= 10);
  console.log(`      섹션 ${sliced.sections.length} · 규칙 ${sliced.rules.length}`);
});

// ── S2 설계 게이트 (격리) + 격리 불변식 ──
t('S2 design_gate — 격리 실행이 실물 specs를 건드리지 않음 (§9 핵심)', () => {
  if (!hasDesign) { console.log('      (tc_design.md 없음 — 게이트 스킵)'); return; }
  const before = manifest(SPEC);
  const g = runGate(path.join(SPEC, 'tc_design.md'), { node: NODE });
  const after = manifest(SPEC);
  assert.deepStrictEqual(after, before, '실물 specs 파일이 변경됨 — 격리 실패!');
  console.log(`      게이트 exit=${g.exit} pass=${g.pass}` + (g.counts ? ` (기본 ${g.counts.basic}/QA ${g.counts.qa}/총 ${g.counts.total})` : ''));
  assert.ok(g.pass || g.exit === 4, '게이트는 통과 또는 blocker여야(오류 아님)');
});

// ── S5 콘텐츠 게이트 (실물 스냅샷 회귀) ──
t('S5 content_gate — 실물 v2 스냅샷 통과(동등성)', () => {
  const c = checkContent(snap.rows);
  console.log(`      ${c.total}행 → ${c.pass ? 'PASS' : 'FAIL ' + JSON.stringify(c.byType)}`);
  assert.ok(c.pass);
});

// ── ② 역추적 원장 (실물 규칙 앵커로 게이트 기동) ──
t('② traceability — 실물 규칙에 커버리지 게이트 기동', () => {
  const rules = sliced.rules;
  // 합성 커버리지: 80% 커버, 10% 제외, 10% 미커버 → 게이트가 미커버를 정확히 차단하는지
  const cov = {}, ex = [];
  rules.forEach((r, i) => {
    if (i % 10 === 9) return;               // 미커버(사유 없음)
    if (i % 10 === 8) { ex.push({ rule_id: r.rule_id, reason: '추후구현' }); return; } // 제외
    cov[r.rule_id] = ['T' + i];             // 커버
  });
  const led = buildLedger(rules, cov, ex);
  assert.strictEqual(led.gate.pass, false, '미커버 존재 → 차단해야');
  assert.ok(led.uncovered.length > 0);
  console.log(`      커버 ${led.summary.covered} · 제외 ${led.summary.excluded} · 미커버 ${led.summary.uncovered} → 게이트 차단 ✓`);
  // 완전 커버 변형 → 통과
  const cov2 = {}; rules.forEach((r, i) => { cov2[r.rule_id] = ['T' + i]; });
  assert.strictEqual(buildLedger(rules, cov2, []).gate.pass, true);
});

// ── S5 apply_fix_plan (실물 tc_id로 편집+추가) ──
t('S5 apply_fix_plan — 실물 스냅샷에 편집+행추가 결정론 적용', () => {
  const id2 = snap.rows[2][0];   // 실물 3번째 행 tc_id
  const plan = { patches: [
    { op: 'edit_cell', tc_id: snap.rows[1][0], col: 'J', after: '기획 확인 필요', reason: 'spike' },
    { op: 'add_row', after_tc_id: id2, row: { b: '', c: '', d: '', e: '예외', f: '스파이크 검증용 추가 케이스 확인', g: 'PC' }, reason: 'spike-coverage' },
  ] };
  const r1 = applyFixPlan(snap, plan, null);
  assert.strictEqual(r1.conflicts.length, 0);
  assert.strictEqual(r1.rows.length, snap.rows.length + 1, '행 추가 반영');
  // 멱등: 같은 plan + ledger 재적용 → 신규 0, 행수 불변
  const s2 = Object.assign({}, snap, { rows: r1.rows });
  const r2 = applyFixPlan(s2, plan, r1.ledger);
  assert.strictEqual(r2.applied.length, 0);
  assert.strictEqual(r2.rows.length, r1.rows.length, '멱등 — 중복 없음');
  console.log(`      ${snap.rows.length}행 → 적용 후 ${r1.rows.length}행 · 재적용 멱등 ✓`);
  global.__fixed = r1.rows;
});

// ── ③ golden_diff (수정 전/후 = 회귀 감지, 자기=pass) ──
t('③ golden_diff — 자기 비교 pass · 수정본은 구조 변화 감지', () => {
  assert.strictEqual(diff(snap, snap).verdict, 'pass');
  const d = diff(snap, { rows: global.__fixed });
  assert.strictEqual(d.verdict, 'regression', '행 추가 = 구조 회귀로 감지');
  assert.strictEqual(d.deltas.rowCount.delta, 1);
  console.log(`      자기=pass · +1행 수정본=regression(rowCount +1) ✓`);
});

console.log(`\n═══ 결과: ${pass} 통과 / ${fail} 실패 ═══`);
console.log(fail ? '스파인 통합 실패 — 위 항목 확인' : '결정론 스파인이 실물 데이터에서 end-to-end 합성됨 (LLM 무관)');
process.exit(fail ? 1 : 0);
