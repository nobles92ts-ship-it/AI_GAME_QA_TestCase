'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildReport, renderMarkdown, renderHtml, generate } = require('../lib/quality_report');
const { parseMetadata, CHECKS } = require('../lib/execution_metadata');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; } catch (e) { fail++; console.error('FAIL ' + name + ': ' + e.stack); } }
function fixture() {
  return { feature: '인증', source: 'REQ-1 SCR-1 인증 화면', design: '',
    rows: [['001', '가입', '인증', '토큰', '부정', '변조 토큰으로 인증하면 거부되는지 확인', 'PC', '미진행', 'N/A', '']],
    slices: { rules: [{ rule_id: 'R1', sec_id: 'S1', text: '인증 거부' }, { rule_id: 'R2', text: '목적' }, { rule_id: 'R3', text: '재가입 정책' }] },
    coverage: [{ rule_id: 'R1', tc_ids: ['TC001'] }], exclusions: [{ rule_id: 'R2', reason: '비TC성서술' }],
    lenses: {}, labels: null, patches: null };
}
function metadata() {
  return { schema_version: 1, groups: [{ path: ['가입', '인증', '토큰'], risk: 'HIGH', priority: 'P1', priority_reason: '이번 빌드 변경 영역',
    requirement_ids: ['REQ-1'], screen_ids: ['SCR-1'], dependencies: ['인증 테스트 계정'], cleanup: ['생성 세션 종료'],
    automation: { status: 'candidate', reason: '변조 입력과 거부 로그를 관측 가능', method: '테스트 API', oracle: '거부 응답', reset: '세션 정리' } }],
    checks: CHECKS.map(id => ({ id, status: 'not_applicable', reason: '이 fixture에서는 미적용' })) };
}
const fenced = m => '## 실행 계획 메타데이터\n```json\n' + JSON.stringify(m) + '\n```';
t('three coverage denominators remain distinct', () => {
  const r = buildReport(fixture());
  assert.deepStrictEqual([r.coverage.rules, r.coverage.covered, r.coverage.excluded, r.coverage.uncovered], [3, 1, 1, 1]);
  assert.equal(r.coverage.direct_rate, 1 / 3); assert.equal(r.coverage.scoped_rate, 1 / 2); assert.equal(r.coverage.accounted_rate, 2 / 3);
  assert(renderMarkdown(r).includes('재가입 정책'));
});
t('empty denominator is unknown, not 100%', () => {
  const f = fixture(); f.slices.rules = []; f.coverage = []; f.exclusions = [];
  const r = buildReport(f); assert.equal(r.coverage.direct_rate, null); assert.equal(r.coverage.scoped_rate, null);
});
t('all excluded has no in-scope percentage', () => {
  const f = fixture(); f.slices.rules = [f.slices.rules[1]]; f.coverage = [];
  const r = buildReport(f); assert.equal(r.coverage.scoped_rate, null); assert.equal(r.coverage.accounted_rate, 1);
});
t('nonexistent final TC is uncovered in report', () => {
  const f = fixture(); f.coverage[0].tc_ids = ['099'];
  const r = buildReport(f); assert.equal(r.coverage.covered, 0); assert(r.warnings.some(x => x.includes('099')));
});
t('invalid exclusions do not inflate allowed exclusion coverage', () => {
  const f = fixture(); f.exclusions[0].reason = '임의 생략';
  const r = buildReport(f); assert.equal(r.coverage.excluded, 0); assert.equal(r.coverage.uncovered, 2);
});
t('source ID prefix is not mistaken for actual ID', () => {
  assert.throws(() => parseMetadata(fenced(metadata()), 'REQ-10 SCR-10'), /원문.*ID/);
});
t('applicable axis is linked to actual final classification', () => {
  const f = fixture(), m = metadata();
  m.checks[0] = { id: CHECKS[0], status: 'applicable', reason: '인증 실패', evidence: '원문 인증 규칙', paths: [['가입', '인증', '토큰']] };
  f.design = fenced(m); assert(!buildReport(f).warnings.some(x => x.includes('검토 축 TC 매칭 없음')));
  m.checks[0].paths = [['가입', '인증', '없는 분류']]; f.design = fenced(m);
  assert(buildReport(f).warnings.some(x => x.includes('검토 축 TC 매칭 없음')));
});
t('unresolved applicability is visible in summary warnings', () => {
  const f = fixture(), m = metadata(); m.checks[0].status = 'needs_info'; f.design = fenced(m);
  assert(buildReport(f).warnings.some(x => x.includes('적용성 확인 필요')));
});
t('legacy run missing metadata stays unknown', () => {
  const r = buildReport(fixture()); assert.equal(r.execution[0].priority, '미기록'); assert.equal(r.execution[0].automation.status, '미기록');
  assert.equal(r.review.lenses.structure, null); assert.equal(r.review.questions, null);
});
t('metadata supplies independent risk and priority plus automation evidence', () => {
  const f = fixture(); f.design = fenced(metadata()); const r = buildReport(f);
  assert.equal(r.execution[0].risk, 'HIGH'); assert.equal(r.execution[0].priority, 'P1');
  assert.equal(r.execution[0].automation.status, 'candidate'); assert.equal(r.execution[0].cleanup[0], '생성 세션 종료');
  assert.deepStrictEqual(r.execution[0].requirement_ids, ['REQ-1']);
});
t('source IDs are not invented', () => {
  const m = metadata(); m.groups[0].screen_ids = ['SCR-999']; assert.throws(() => parseMetadata(fenced(m), 'REQ-1 SCR-1'), /원문.*ID/);
});
t('malformed metadata cannot silently become missing', () => assert.throws(() => parseMetadata('## 실행 계획 메타데이터\n```json\n{bad}\n```', ''), /JSON/));
t('four policies and six additional checks must be explicit and unique', () => {
  const m = metadata(); m.checks.pop(); assert.throws(() => parseMetadata(fenced(m), 'REQ-1 SCR-1'), /검토 축/);
});
t('automation candidate needs method, oracle and reset', () => {
  const m = metadata(); delete m.groups[0].automation.oracle; assert.throws(() => parseMetadata(fenced(m), 'REQ-1 SCR-1'), /oracle/);
});
t('ambiguous metadata selector fails visibly', () => {
  const f = fixture(); const m = metadata(); m.groups.push({ ...m.groups[0] }); f.design = fenced(m);
  assert.throws(() => buildReport(f), /중복.*메타데이터/);
});
t('unmatched selectors do not attach by TC number', () => {
  const f = fixture(); const m = metadata(); m.groups[0].path[2] = '다른 소분류'; f.design = fenced(m);
  const r = buildReport(f); assert.equal(r.execution[0].priority, '미기록'); assert(r.warnings.some(x => x.includes('매칭')));
});
t('review findings and applied patches are separate counts', () => {
  const f = fixture(); f.lenses.quality = { findings: [{ tc_id: '001', severity: 'HIGH', issue: '누락', suggested_fix: '추가' }] };
  f.patches = { applied: ['abc'] }; f.labels = { 기획확인: ['[규칙 없음] 재가입 정책?'] };
  const r = buildReport(f); assert.equal(r.review.findings.length, 1); assert.equal(r.review.applied_patch_count, 1); assert.equal(r.review.questions.length, 1);
});
t('renderers escape hostile source content', () => {
  const f = fixture(); f.rows[0][5] = '<img src=x onerror=alert(1)> | injected\nrow'; const r = buildReport(f);
  const html = renderHtml(r); assert(!html.includes('<img src=x')); assert(html.includes('&lt;img')); assert(renderMarkdown(r).includes('&#124;'));
});
t('markdown table headers and separators are adjacent', () => {
  assert(renderMarkdown(buildReport(fixture())).includes('| 지표 | 분자/분모 | 비율 |\n| --- | --- | --- |'));
});
t('generation to separate output leaves all inputs byte-identical', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-quality-')); const out = path.join(dir, '_no_sync'); const f = fixture();
  try {
    const files = { 'tcteam_tc_final.json': { rows: f.rows }, 'slices.json': f.slices, 'coverage.json': f.coverage, 'exclusions.json': f.exclusions };
    for (const [n, j] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), JSON.stringify(j));
    fs.writeFileSync(path.join(dir, 'confluence_raw.md'), f.source); fs.writeFileSync(path.join(dir, 'tc_design.md'), '기존 설계');
    const before = Object.fromEntries(fs.readdirSync(dir).map(n => [n, fs.readFileSync(path.join(dir, n), 'hex')]));
    generate(dir, out);
    for (const [n, bytes] of Object.entries(before)) assert.equal(fs.readFileSync(path.join(dir, n), 'hex'), bytes);
    for (const ext of ['json', 'md', 'html']) assert(fs.statSync(path.join(out, 'quality_report.' + ext)).size > 0);
    fs.writeFileSync(path.join(dir, 'coverage.json'), '{bad}'); assert.throws(() => generate(dir, out), /coverage.json/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
console.log(`결과: ${pass} PASS / ${fail} FAIL`); process.exit(fail ? 1 : 0);
