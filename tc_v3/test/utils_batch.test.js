'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildLedger } = require('../lib/traceability.js');
const { project } = require('../lib/state_projection.js');
const { forceClean, planDeletions } = require('../lib/force_clean.js');
const { diff } = require('../lib/golden_diff.js');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  PASS ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' — ' + e.message); } }

// ─────────── traceability ───────────
console.log('traceability.js');
const rules = [{ rule_id: 'R-1.1', sec_id: 'R-1', text: '반경 내 시작' }, { rule_id: 'R-1.2', sec_id: 'R-1', text: '우선순위' }, { rule_id: 'R-2.1', sec_id: 'R-2', text: '매너 모드' }];

t('covered+excluded 조합 = 게이트 통과', () => {
  const r = buildLedger(rules, { 'R-1.1': ['001'], 'R-1.2': ['002', '003'] }, [{ rule_id: 'R-2.1', reason: '추후구현' }]);
  assert.ok(r.gate.pass, JSON.stringify(r.gate));
  assert.strictEqual(r.summary.covered, 2);
  assert.strictEqual(r.summary.excluded, 1);
  assert.strictEqual(r.summary.coverage_rate, 1);
});

t('미커버(사유 없음) = 게이트 차단', () => {
  const r = buildLedger(rules, { 'R-1.1': ['001'] }, []);
  assert.strictEqual(r.gate.pass, false);
  assert.deepStrictEqual(r.uncovered.sort(), ['R-1.2', 'R-2.1']);
});

t('허용되지 않은 제외 사유 = 차단', () => {
  const r = buildLedger(rules, { 'R-1.1': ['1'], 'R-1.2': ['2'] }, [{ rule_id: 'R-2.1', reason: '귀찮아서' }]);
  assert.strictEqual(r.gate.pass, false);
  assert.strictEqual(r.badExclusion.length, 1);
});

t('dangling coverage(미존재 rule_id 참조) = 차단', () => {
  const r = buildLedger(rules, { 'R-1.1': ['1'], 'R-1.2': ['2'], 'R-9.9': ['x'] }, [{ rule_id: 'R-2.1', reason: '추후구현' }]);
  assert.strictEqual(r.gate.pass, false);
  assert.deepStrictEqual(r.danglingCoverage, ['R-9.9']);
});

t('coverage_rate 계산', () => {
  const r = buildLedger(rules, { 'R-1.1': ['1'] }, []);
  assert.strictEqual(r.summary.coverage_rate, +(1 / 3).toFixed(3));
});

// ─────────── state_projection ───────────
console.log('state_projection.js');

t('신규 feature upsert', () => {
  const s = project({}, 'sample_feature', 'S3', null, null);
  assert.strictEqual(s.specs[0].state, 'writing'); // S3 별칭
  assert.strictEqual(s.specs[0].review_round, 0);
});

t('기존 항목 갱신 + 타 필드 보존', () => {
  const s0 = { specs: [{ feature: 'F', state: 'writing', review_round: 0, tab_name: 'F', spreadsheet_id: 'X' }] };
  const s = project(s0, 'F', 'S4', 1);
  assert.strictEqual(s.specs[0].state, 'reviewing');
  assert.strictEqual(s.specs[0].review_round, 1);
  assert.strictEqual(s.specs[0].tab_name, 'F', '타 필드 보존');
  assert.strictEqual(s.specs[0].spreadsheet_id, 'X');
});

t('done → review_round 2 강제(무결성 불변식)', () => {
  const s = project({}, 'F', 'done', 0);
  assert.strictEqual(s.specs[0].review_round, 2);
});

t('허용되지 않은 state = throw(신규 어휘 금지)', () => {
  assert.throws(() => project({}, 'F', 'uploading', 0));
});

t('currentBatch 갱신', () => {
  const s = project({}, 'F', 'S1', 0, ['A', 'B', null, 'C']);
  assert.deepStrictEqual(s.currentBatch, ['A', 'B', 'C']); // null 정리
});

// ─────────── force_clean ───────────
console.log('force_clean.js');
const tmp = path.join(__dirname, '..', 'fixtures', '_fc_tmp');

t('삭제 계획 — 원문/설정 보존, 잔존물 삭제', () => {
  fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
  for (const f of ['confluence_raw.md', 'sheet_info.txt', 'analysis.md', 'tc_design.md', 'tc_snapshot.json',
    'tc_final.json', 'tc_final.ok', 'v3_fmap_part_0.json', 'v3_s5_attempts.txt', 'step6_result.json', 'review_F.md'])
    fs.writeFileSync(path.join(tmp, f), 'x');
  const del = planDeletions(tmp);
  assert.ok(!del.includes('confluence_raw.md'), 'confluence_raw 보존');
  assert.ok(!del.includes('sheet_info.txt'), 'sheet_info 보존');
  for (const f of ['analysis.md', 'tc_design.md', 'tc_snapshot.json', 'tc_final.json', 'tc_final.ok', 'v3_fmap_part_0.json', 'v3_s5_attempts.txt', 'step6_result.json', 'review_F.md'])
    assert.ok(del.includes(f), '삭제 대상: ' + f);
});

t('실제 삭제 후 보존 파일만 남음', () => {
  forceClean(tmp, false);
  const remain = fs.readdirSync(tmp).sort();
  assert.deepStrictEqual(remain, ['confluence_raw.md', 'sheet_info.txt']);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ─────────── golden_diff ───────────
console.log('golden_diff.js');
const snap = (rows) => ({ rows });
const base = () => snap([
  ['001', '기본기능', '진입', '버튼', '정상', '버튼 누르면 열리는지 확인', 'PC', '미진행', 'N/A', ''],
  ['002', 'QA', '타겟', '우선순위', '정상', '1순위 대상이 선택되는지 확인', 'PC/모바일', '미진행', '미진행', ''],
  ['003', '', '', '', '예외', '대상 없으면 대기하는지 확인', 'PC/모바일', '미진행', '미진행', ''],
]);

t('동일 스냅샷 = pass', () => {
  assert.strictEqual(diff(base(), base()).verdict, 'pass');
});

t('행 추가 = 구조 회귀', () => {
  const n = base(); n.rows.push(['004', 'QA', 'x', 'y', '정상', '추가된 확인', 'PC', '미진행', '미진행', '']);
  const r = diff(base(), n);
  assert.strictEqual(r.verdict, 'regression');
  assert.strictEqual(r.deltas.rowCount.delta, 1);
});

t('F 문장 리워드(고유사도) = pass', () => {
  const n = base(); n.rows[1][5] = '1순위 대상이 자동 선택되는지 확인'; // 대부분 토큰 동일
  const r = diff(base(), n, 0.5);
  assert.strictEqual(r.verdict, 'pass');
  assert.ok(r.fSim.avg_similarity < 1 && r.fSim.avg_similarity > 0.5);
});

t('F 문장 전면 교체(저유사도) = advisory_drift', () => {
  const n = base();
  n.rows[1][5] = '완전히 다른 내용의 문장입니다 재현';
  n.rows[2][5] = '또 다른 무관한 서술 텍스트 확인';
  const r = diff(base(), n, 0.7);
  assert.strictEqual(r.verdict, 'advisory_drift');
});

t('콘텐츠 위반 유입 = 회귀', () => {
  const n = base(); n.rows[1][5] = '정상적으로 동작하는지 확인'; // 추상표현
  assert.strictEqual(diff(base(), n).verdict, 'regression');
});

t('검증단계 분포 변경 = 회귀', () => {
  const n = base(); n.rows[2][4] = '부정'; // 예외 → 부정
  assert.strictEqual(diff(base(), n).verdict, 'regression');
});

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
