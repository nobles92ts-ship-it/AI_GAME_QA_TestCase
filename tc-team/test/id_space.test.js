'use strict';
// id_space — S5 뒤 커버리지 원장 번호 맞추기 (2026-11-06)
//
// 결함: S4 원장은 스냅샷 번호인데 S5 가 행을 끼우거나 지우고 regroup 이 A열을 다시 매긴다.
//   원장을 고치지 않아 연결이 다른 TC 를 가리킨 채 traceability·quality_report 를 통과했다
//   (8런 중 6런 — 기능BP 166 중 55 · 캐시샵 1,715 중 1,065). 이 시험은 «같은 TC 를 가리키는지»를 문장으로 본다.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { applyFixPlan } = require('../lib/apply_fix_plan.js');
const { regroupRows } = require('../lib/regroup.js');
const { rowsDigest, remapCoverage } = require('../lib/id_space.js');
const { buildReport } = require('../lib/quality_report.js');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  PASS ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' — ' + e.message); } }

const R = (id, b, c, d, e, f) => [id, b, c, d, e, f, 'PC', '미진행', 'N/A', ''];
const snap = () => ({ rows: [
  R('001', 'QA', '진입', '버튼', '정상', 'A 버튼을 누르면 창이 열리는지 확인'),
  R('002', '', '', '', '예외', 'A 버튼 연타 시 창이 하나만 열리는지 확인'),
  R('003', 'QA', '보상', '수령', '정상', '보상 수령 버튼으로 보상이 지급되는지 확인'),
  R('004', '', '', '', '부정', '수령한 보상을 다시 받을 수 없는지 확인'),
  R('005', 'QA', '닫기', '버튼', '정상', '닫기 버튼으로 창이 닫히는지 확인'),
] });
const F = (rows) => new Map(rows.map(r => [r[0], r[5]]));
// 원장: 규칙마다 «이 문장의 TC» 를 스냅샷 번호로 가리킨다
const cov = () => [
  { rule_id: 'R-1', tc_ids: ['001', '002'] },
  { rule_id: 'R-2', tc_ids: ['003'] },
  { rule_id: 'R-3', tc_ids: [4] },            // 숫자 번호도 받는다(형식 계약)
  { rule_id: 'R-4', tc_ids: ['005'] },
];
// 체인과 같은 순서: apply → regroup(CLI 와 같은 함수) → remap
function runS5(s, plan) {
  const res = applyFixPlan(s, plan, null);
  const fin = regroupRows(res.rows);
  return { res, fin };
}
const sameText = (c0, s, c1, fin) => {
  const a = F(s.rows), b = F(fin);
  for (let i = 0; i < c0.length; i++) {
    const before = c0[i].tc_ids.map(x => a.get(String(x).padStart(3, '0')));
    const after = c1[i].tc_ids.map(x => b.get(String(x).padStart(3, '0')));
    assert.deepStrictEqual(after, before, c0[i].rule_id + ' 가 다른 문장을 가리킨다');
  }
};

console.log('id_space 테스트 (S5 원장 번호 맞추기)');

t('중간 끼우기 — 뒤 번호가 밀려도 같은 문장을 가리킨다', () => {
  const s = snap();
  const { res, fin } = runS5(s, { patches: [{ op: 'add_row', after_tc_id: '001', row: { b: 'QA', c: '진입', d: '버튼', e: '부정', f: '잠긴 상태에서 A 버튼이 눌리지 않는지 확인', g: 'PC' } }] });
  assert.strictEqual(res.idmap.map['003'], '004');            // 실제로 밀렸다(시험이 헛돌지 않는지)
  const r = remapCoverage(cov(), res.idmap);
  assert.deepStrictEqual(r.unknown, []);
  sameText(cov(), s, r.coverage, fin);
  assert.deepStrictEqual(res.idmap.added, ['002']);
});

t('양성 대조 — 고치지 않은 원장은 이 시험에 걸린다', () => {
  const s = snap();
  const { fin } = runS5(s, { patches: [{ op: 'add_row', after_tc_id: '001', row: { b: 'QA', c: '진입', d: '버튼', e: '부정', f: '잠긴 상태에서 A 버튼이 눌리지 않는지 확인', g: 'PC' } }] });
  assert.throws(() => sameText(cov(), s, cov(), fin), /다른 문장/);
});

t('regroup 재배치 — 다른 그룹 뒤에 끼운 행이 제 그룹으로 옮겨져도 맞는다(산술 +N 로는 틀림)', () => {
  const s = snap();
  // 앵커가 '보상' 그룹 끝(004)인데 행은 '진입' 그룹 → regroup 이 001·002 뒤로 끌어온다
  const { res, fin } = runS5(s, { patches: [{ op: 'add_row', after_tc_id: '004', row: { b: 'QA', c: '진입', d: '버튼', e: '부정', f: '잠긴 상태에서 A 버튼이 눌리지 않는지 확인', g: 'PC' } }] });
  assert.strictEqual(fin[2][5], '잠긴 상태에서 A 버튼이 눌리지 않는지 확인');
  const r = remapCoverage(cov(), res.idmap);
  sameText(cov(), s, r.coverage, fin);
  assert.strictEqual(r.coverage[2].tc_ids[0], 5);             // 숫자로 받으면 숫자로 돌려준다
});

t('지우기 — 지운 TC 는 빠지고, 그것만으로 덮이던 규칙은 비어 봉합 대상이 된다', () => {
  const s = snap();
  const { res, fin } = runS5(s, { patches: [{ op: 'delete_row', tc_id: '003' }] });
  const r = remapCoverage(cov(), res.idmap);
  assert.deepStrictEqual(r.emptied, ['R-2']);
  assert.deepStrictEqual(r.coverage[1].tc_ids, []);
  assert.deepStrictEqual(r.dropped, [{ rule_id: 'R-2', tc_id: '003' }]);
  assert.strictEqual(F(fin).get(String(r.coverage[2].tc_ids[0]).padStart(3, '0')), '수령한 보상을 다시 받을 수 없는지 확인');
});

t('모르는 번호 — 표에도 삭제 목록에도 없으면 unknown 으로 돌려준다(호출자가 멈춤)', () => {
  const { res } = runS5(snap(), { patches: [] });
  const r = remapCoverage([{ rule_id: 'R-9', tc_ids: ['077'] }], res.idmap);
  assert.deepStrictEqual(r.unknown, [{ rule_id: 'R-9', tc_id: '077' }]);
});

t('지문 — 표의 예상 최종본 지문 = regroup 실제 결과 지문', () => {
  const { res, fin } = runS5(snap(), { patches: [{ op: 'add_row', after_tc_id: '004', row: { b: 'QA', c: '진입', d: '버튼', e: '부정', f: 'x 확인', g: 'PC' } }] });
  assert.strictEqual(res.idmap.final_digest, rowsDigest(fin));
  assert.strictEqual(res.idmap.final_rows, fin.length);
});

// ── CLI: chain_helpers remap-coverage ──
const HELP = path.join(__dirname, '..', 'scripts', 'chain_helpers.js');
const APPLY = path.join(__dirname, '..', 'lib', 'apply_fix_plan.js');
const REGROUP = path.join(__dirname, '..', 'lib', 'regroup.js');
const node = (args) => spawnSync(process.execPath, args, { encoding: 'utf8' });
function workdir(plan) {
  const w = fs.mkdtempSync(path.join(os.tmpdir(), 'idsp-'));
  fs.writeFileSync(path.join(w, 'tcteam_snapshot.json'), JSON.stringify(snap()));
  fs.writeFileSync(path.join(w, 'fix_plan.json'), JSON.stringify(plan));
  fs.writeFileSync(path.join(w, 'coverage.json'), JSON.stringify(cov()));
  const fin = path.join(w, 'tcteam_tc_final.json'), map = path.join(w, 'idmap_s5.json');
  assert.strictEqual(node([APPLY, path.join(w, 'tcteam_snapshot.json'), path.join(w, 'fix_plan.json'), fin, '--idmap', map]).status, 0);
  assert.strictEqual(node([REGROUP, fin, fin]).status, 0);
  return { w, fin, map };
}
const ADD = { patches: [{ op: 'add_row', after_tc_id: '001', row: { b: 'QA', c: '진입', d: '버튼', e: '부정', f: '잠긴 상태에서 A 버튼이 눌리지 않는지 확인', g: 'PC' } }] };

t('CLI — apply(--idmap) → regroup → remap-coverage 가 원장을 고치고 번호 기준을 남긴다', () => {
  const { w, fin, map } = workdir(ADD);
  const r = node([HELP, 'remap-coverage', w, map]);
  assert.strictEqual(r.status, 0, r.stderr);
  const c1 = JSON.parse(fs.readFileSync(path.join(w, 'coverage.json'), 'utf8'));
  const rows = JSON.parse(fs.readFileSync(fin, 'utf8')).rows;
  sameText(cov(), snap(), c1, rows);
  const sp = JSON.parse(fs.readFileSync(path.join(w, 'coverage_idspace.json'), 'utf8'));
  assert.strictEqual(sp.final_digest, rowsDigest(rows));
});

t('CLI — 최종본이 표와 다르면 멈추고 원장을 건드리지 않는다(fail-closed)', () => {
  const { w, fin, map } = workdir(ADD);
  const f = JSON.parse(fs.readFileSync(fin, 'utf8')); f.rows[0][5] = '누가 손댐 확인'; fs.writeFileSync(fin, JSON.stringify(f));
  const before = fs.readFileSync(path.join(w, 'coverage.json'), 'utf8');
  const r = node([HELP, 'remap-coverage', w, map]);
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /지문 불일치/);
  assert.strictEqual(fs.readFileSync(path.join(w, 'coverage.json'), 'utf8'), before);
  assert.ok(!fs.existsSync(path.join(w, 'coverage_idspace.json')));
});

t('CLI — 모르는 번호가 있으면 멈추고 원장을 건드리지 않는다', () => {
  const { w, map } = workdir(ADD);
  fs.writeFileSync(path.join(w, 'coverage.json'), JSON.stringify([{ rule_id: 'R-9', tc_ids: ['077'] }]));
  const r = node([HELP, 'remap-coverage', w, map]);
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /번호 표에 없는/);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(w, 'coverage.json'), 'utf8'))[0].tc_ids[0], '077');
});

// ── quality_report: 번호 기준 대조 ──
const qInput = (rows, idspace) => ({ feature: 'x', rows, slices: { rules: [{ rule_id: 'R-1', sec_id: 's', text: 't' }] },
  coverage: [{ rule_id: 'R-1', tc_ids: ['001'] }], exclusions: [], design: '', source: '', lenses: {}, idspace });
const hasWarn = (rep, re) => (rep.warnings || []).some(w => re.test(w));

t('quality_report — 번호 기준이 최종본과 같으면 경고 없음', () => {
  const rows = snap().rows;
  assert.ok(!hasWarn(buildReport(qInput(rows, { final_digest: rowsDigest(rows), final_rows: rows.length })), /연결표 번호 기준/));
});
t('quality_report — S5 뒤 최종본이 바뀌면 경고', () => {
  const rows = snap().rows, d = rowsDigest(rows);
  const moved = rows.slice(); moved.splice(1, 0, R('002', '', '', '', '부정', '끼운 행 확인'));
  assert.ok(hasWarn(buildReport(qInput(moved.map((r, i) => [String(i + 1).padStart(3, '0'), ...r.slice(1)]), { final_digest: d, final_rows: 5 })), /최종 TC와 다름/));
});
t('quality_report — 번호 기준 기록이 없으면 경고(옛 런·수동 런)', () => {
  assert.ok(hasWarn(buildReport(qInput(snap().rows, null)), /기록 없음/));
});

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
