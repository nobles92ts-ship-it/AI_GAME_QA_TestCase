'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { auditEvidence } = require('../lib/design_evidence_audit');
let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('PASS ' + name); } catch (e) { fail++; console.log('FAIL ' + name + ': ' + e.message); } }
const analysis = rows => '### A-5. GlobalDefine 키 목록\n| 키 | 초기값 | 용도 |\n|---|---|---|\n' + rows.map(([k, v]) => `| ${k} | ${v} | fixture |`).join('\n');
const design = rows => '## GlobalDefine 키 목록\n| 키 | 초기값 | 용도 |\n|---|---|---|\n' + rows.map(([k, v]) => `| ${k} | ${v} | fixture |`).join('\n');
const item = (note, extra = {}) => ({ id: 'Q1', branch: 'apply', approved: true, source: 'Current.xlsx > Define', note, ...extra });
const run = (a, d, items = [], raw = '# source') => auditEvidence({ analysis: analysis(a), design: design(d), crossref: { items }, raw });
const blockers = r => r.findings.filter(x => x.severity === 'HIGH');

test('matching explicit approved value is consistent', () => {
  const r = run([['MinLevel', '20']], [['MinLevel', '20']], [item('MinLevel=20')]);
  assert.strictEqual(blockers(r).length, 0); assert.strictEqual(r.approved_values.length, 1);
});
test('design value drift from approved value is HIGH', () => {
  const r = run([['MinLevel', '20']], [['MinLevel', '30']], [item('MinLevel=20')]);
  assert.ok(blockers(r).some(x => x.code === 'value_mismatch' && x.key === 'MinLevel'));
});
test('explicit analysis/design value mismatch is detected without inventing approval', () => {
  const r = run([['MaxCount', '100']], [['MaxCount', '50']]);
  assert.ok(blockers(r).length); assert.strictEqual(r.approved_values.length, 0);
});
test('analysis configuration key lost from design is detected', () => {
  const r = run([['MaxCount', '100']], [], [item('MaxCount=100')]);
  assert.ok(blockers(r).some(x => x.code === 'missing_design_key'));
});
test('revoked approval and nested historic approval are not used', () => {
  const r = run([['MinLevel', '20']], [['MinLevel', '20']], [item('MinLevel=30', { approved: false, native_provenance: item('MinLevel=30') })]);
  assert.strictEqual(r.approved_values.length, 0); assert.strictEqual(blockers(r).length, 0);
});
test('locate/keep/discover or missing source cannot become approved values', () => {
  for (const extra of [{ branch: 'locate' }, { branch: 'keep' }, { branch: 'discover' }, { approved: 'true' }, { source: '' }]) {
    assert.strictEqual(run([['MinLevel', '20']], [['MinLevel', '20']], [item('MinLevel=30', extra)]).approved_values.length, 0);
  }
});
test('raw example numbers do not override a current approved value', () => {
  const r = run([['MinLevel', '20']], [['MinLevel', '20']], [item('MinLevel=20')], '가데이터 MinLevel=30 / 예시 {0}\n![image](images/a.png)');
  assert.strictEqual(blockers(r).length, 0); assert.ok(r.provenance_hints.some(x => x.kind === 'example'));
  assert.ok(r.provenance_hints.some(x => x.kind === 'image')); assert.strictEqual(r.semantic_or_pixel_verification, false);
});
test('example or struck values inside approved notes are not promoted', () => {
  const example = run([['MinLevel', '20']], [['MinLevel', '20']], [item('예시 MinLevel=30')]);
  assert.strictEqual(example.approved_values.length, 0);
  assert.ok(example.findings.some(x => x.code === 'ambiguous_approval_context'));
  const struck = run([['MinLevel', '20']], [['MinLevel', '20']], [item('~~MinLevel=30~~. MinLevel=20')]);
  assert.strictEqual(struck.approved_values.length, 1); assert.strictEqual(blockers(struck).length, 0);
});
test('mixed example/resolved cell requires review instead of choosing one number', () => {
  const r = run([['MinLevel', '원문 가데이터 30; DXR 확정 20']], [['MinLevel', '20']], [item('MinLevel=20')]);
  assert.strictEqual(blockers(r).length, 0); assert.ok(r.findings.some(x => x.severity === 'REVIEW'));
});
test('conflicting approved pairs require review, never pick one', () => {
  const r = run([['MinLevel', '20']], [['MinLevel', '20']], [item('MinLevel=20'), item('MinLevel=30', { id: 'Q2' })]);
  assert.strictEqual(r.approved_values.length, 0); assert.ok(r.findings.some(x => x.code === 'ambiguous_approval'));
});
test('an alternative approval is not a confirmed numeric prefix', () => {
  for (const note of ['MinLevel=20/30', 'MinLevel=20 또는 30', 'MinLevel=20~30', 'MinLevel=20-30', 'MinLevel=20 -> 30', 'MinLevel=20→30']) {
    const r = run([['MinLevel', '30']], [['MinLevel', '30']], [item(note)]);
    assert.strictEqual(r.approved_values.length, 0, note); assert.strictEqual(blockers(r).length, 0, note);
    assert.ok(r.findings.some(x => x.severity === 'REVIEW'), note);
  }
});
test('arithmetic is not collapsed into a scalar by markdown cleanup', () => {
  const r = run([['UpdateInterval', '1*60']], [['UpdateInterval', '60']]);
  assert.strictEqual(blockers(r).length, 0); assert.ok(r.findings.some(x => x.code === 'ambiguous_value'));
  assert.strictEqual(blockers(run([['MinLevel', '**20**']], [['MinLevel', '20']])).length, 0);
});
test('AS-IS and example row metadata cannot cause false HIGH or missing-key HIGH', () => {
  const a = '### A-5. GlobalDefine 키 목록\n| 키 | 초기값 | 용도 |\n|---|---|---|\n| OldInterval | ~~10분~~ | AS-IS 폐기 |\n| MinLevel | 30 | 가데이터 예시 |';
  const r = auditEvidence({ analysis: a, design: design([['MinLevel', '20']]), raw: '', crossref: { items: [item('MinLevel=20')] } });
  assert.strictEqual(blockers(r).length, 0); assert.ok(r.findings.some(x => x.severity === 'REVIEW'));
});
test('existing 기획서 초기값 header is supported', () => {
  const d = design([['MinLevel', '20']]).replace('| 초기값 |', '| 기획서 초기값 |').replace('| 키 |', '| 키/항목 |');
  assert.strictEqual(blockers(auditEvidence({ analysis: analysis([['MinLevel', '20']]), design: d, raw: '' })).length, 0);
});
test('nested QA/BVA tables do not hide a real baseline mismatch', () => {
  const a = analysis([['MinLevel', '20']]) + '\n#### QA/BVA 시험용 설정\n| 키 | 초기값 |\n|---|---|\n| MinLevel | 19 |';
  const r = auditEvidence({ analysis: a, design: design([['MinLevel', '30']]), raw: '' });
  assert.ok(blockers(r).some(x => x.code === 'value_mismatch'));
});
test('unreadable design table is review-required rather than falsely missing', () => {
  const d = '## GlobalDefine 키 목록\n| 특수키표기 | 사용자정의값 |\n|---|---|\n| MinLevel | 20 |';
  const r = auditEvidence({ analysis: analysis([['MinLevel', '20']]), design: d, raw: '' });
  assert.strictEqual(blockers(r).length, 0); assert.ok(r.findings.some(x => x.code === 'unsupported_global_table'));
});
test('different explicit platform scopes require judgment instead of comparison', () => {
  const a = analysis([['MinLevel', '20']]).replace('fixture', '[PC]');
  const d = design([['MinLevel', '30']]).replace('fixture', '[AOS]');
  const r = auditEvidence({ analysis: a, design: d, raw: '' });
  assert.strictEqual(blockers(r).length, 0); assert.ok(r.findings.some(x => x.code === 'scope_unverified'));
});
test('heading platform scopes are preserved', () => {
  const a = analysis([['MinLevel', '20']]).replace('키 목록', '키 목록 [PC]');
  const d = design([['MinLevel', '30']]).replace('키 목록', '키 목록 [AOS]');
  const r = auditEvidence({ analysis: a, design: d, raw: '' });
  assert.strictEqual(blockers(r).length, 0); assert.ok(r.findings.some(x => x.code === 'scope_unverified'));
});
test('explicit scope column and comment are not silently ignored', () => {
  for (const inComment of [false, true]) {
    const a = analysis([['MinLevel', '20']]).replace('용도', '적용 범위').replace('fixture', '서버A');
    const d = inComment ? design([['MinLevel', '30']]).replace('fixture', 'scope=서버B') : design([['MinLevel', '30']]).replace('용도', '적용 범위').replace('fixture', '서버B');
    const r = auditEvidence({ analysis: a, design: d, raw: '' });
    assert.strictEqual(blockers(r).length, 0); assert.ok(r.findings.some(x => x.code === 'scope_unverified'));
  }
});
test('equivalent time units compare equal', () => {
  const r = run([['UpdateInterval', '60분']], [['UpdateInterval', '3600초']], [item('UpdateInterval=1시간')]);
  assert.strictEqual(blockers(r).length, 0);
});
test('missing unit remains unverified', () => {
  const r = run([['UpdateInterval', '1시간']], [['UpdateInterval', '1']], [item('UpdateInterval=1시간')]);
  assert.strictEqual(blockers(r).length, 0); assert.ok(r.findings.some(x => x.code === 'unit_unverified'));
});
test('no inferred aliases and QA/BVA input values are not baseline values', () => {
  const r = auditEvidence({ analysis: analysis([['MinLevel', '20']]), design: design([['MinLevel', '20']]) + '\n## QA 케이스\n| 키 | 초기값 |\n|---|---|\n| MinLevel | 19 |', crossref: { items: [item('DifferentMinLevel=20')] }, raw: '' });
  assert.strictEqual(blockers(r).length, 0); assert.ok(r.findings.some(x => x.code === 'unmapped_approval'));
});
test('struck AS-IS and unresolved values are not confirmed', () => {
  const r = run([['UpdateInterval', '~~10분~~ → 미정']], [['UpdateInterval', '기획 확인 필요']]);
  assert.strictEqual(blockers(r).length, 0); assert.ok(r.findings.some(x => x.severity === 'REVIEW'));
});
test('CLI rejects malformed crossref and does not change source files', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-evidence-'));
  try {
    for (const [name, value] of Object.entries({ 'analysis.md': analysis([['MinLevel', '20']]), 'tc_design.md': design([['MinLevel', '20']]), 'confluence_raw.md': '# source', 'dxr_crossref.json': '{broken' })) fs.writeFileSync(path.join(tmp, name), value);
    const cli = path.resolve(__dirname, '../lib/design_evidence_audit.js');
    let r = spawnSync(process.execPath, [cli, tmp], { encoding: 'utf8' }); assert.strictEqual(r.status, 1);
    assert.strictEqual(fs.readFileSync(path.join(tmp, 'analysis.md'), 'utf8'), analysis([['MinLevel', '20']]));
    fs.writeFileSync(path.join(tmp, 'dxr_crossref.json'), JSON.stringify({ items: [item('MinLevel=20')] }));
    r = spawnSync(process.execPath, [cli, tmp], { encoding: 'utf8' }); assert.strictEqual(r.status, 0, r.stderr);
    const first = JSON.parse(fs.readFileSync(path.join(tmp, 'design_evidence_audit.json'), 'utf8'));
    fs.writeFileSync(path.join(tmp, 'tc_design.md'), design([['MinLevel', '30']]));
    r = spawnSync(process.execPath, [cli, tmp], { encoding: 'utf8' }); assert.strictEqual(r.status, 4);
    const second = JSON.parse(fs.readFileSync(path.join(tmp, 'design_evidence_audit.json'), 'utf8'));
    assert.notStrictEqual(first.input_hashes['tc_design.md'], second.input_hashes['tc_design.md']);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
