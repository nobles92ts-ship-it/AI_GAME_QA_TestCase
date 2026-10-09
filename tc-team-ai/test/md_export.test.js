'use strict';
// md_export — S5 확정본 → AI 실행용 md 묶음. 합격 조건 3·4(TC 수·ID 일치, 원문 바이트 보존)를 여기서 잠근다.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { exportBundle } = require('../lib/md_export');
const { resolveRulesDir } = require('../lib/paths');
const copyFlat = require('./copy_fixture');

const FIX = path.join(__dirname, 'fixtures', 'sample_run');
const RULES = resolveRulesDir();
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  PASS ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' — ' + e.message); } }

const copyFix = (tag) => copyFlat(FIX, fs.mkdtempSync(path.join(os.tmpdir(), `aimd-${tag}-`)));
const final = JSON.parse(fs.readFileSync(path.join(FIX, 'tcteam_tc_final.json'), 'utf8'));
const col = (n) => final.headers.indexOf(n);
const ids = final.rows.map((r) => r[col('TC ID')]);
const readCases = (out) => fs.readdirSync(path.join(out, 'cases')).sort().map((f) => fs.readFileSync(path.join(out, 'cases', f), 'utf8')).join('\n');
const blockIds = (md) => [...md.matchAll(/^#{2,3} TC-(\S+)$/gm)].map((m) => m[1]);
const resultIds = (out) => [...fs.readFileSync(path.join(out, 'results.md'), 'utf8').matchAll(/^\| (\d{3,}) \|/gm)].map((m) => m[1]);

// S4 커버리지 원장 — 체인이 남기는 모양 그대로(tcteam_snapshot.json · coverage_s4.json · fix_plan.json · coverage_seal.json).
// 공개 배포본 .gitignore 가 *_snapshot.json 을 막아 픽스처 파일로 못 싣는다 — 테스트가 만든다.
const trace = JSON.parse(fs.readFileSync(path.join(FIX, 'traceability.json'), 'utf8'));
const coveredAsIs = trace.mapped.filter((m) => m.status === 'covered').map((m) => ({ rule_id: m.rule_id, tc_ids: m.tc_ids.map((x) => String(x).padStart(3, '0')) }));
function seedLedger(spec, { snapshotRows = final.rows, coverage = coveredAsIs, patches = [], seal = null, traceOverride = null } = {}) {
  fs.writeFileSync(path.join(spec, 'tcteam_snapshot.json'), JSON.stringify({ ...final, rows: snapshotRows }));
  fs.writeFileSync(path.join(spec, 'coverage_s4.json'), JSON.stringify(coverage));
  fs.writeFileSync(path.join(spec, 'fix_plan.json'), JSON.stringify({ rationale: 'test', patches }));
  if (seal) fs.writeFileSync(path.join(spec, 'coverage_seal.json'), JSON.stringify(seal));
  if (traceOverride) fs.writeFileSync(path.join(spec, 'traceability.json'), JSON.stringify(traceOverride));
}

// ── 다시 쓰기·확신도 없이 ────────────────────────────────────────────────
const specA = copyFix('a');
seedLedger(specA);
const outA = path.join(specA, 'ai_bundle');
const sumA = exportBundle({ spec: specA, out: outA, rulesDir: RULES });
const casesA = readCases(outA);

t('TC 수·ID 집합 = 최종본 = results.md (합격 조건 3)', () => {
  assert.deepStrictEqual(blockIds(casesA).sort(), [...ids].sort());
  assert.deepStrictEqual(resultIds(outA).sort(), [...ids].sort());
  assert.strictEqual(sumA.tc, ids.length);
});
t('재현 스탭 원문 바이트 보존 (합격 조건 4)', () => {
  const got = new Map([...casesA.matchAll(/^#{2,3} TC-(\S+)\n\n(?:- .*\n)*?- 재현 스탭\(원문\): (.*)$/gm)].map((m) => [m[1], m[2]]));
  for (const r of final.rows) assert.strictEqual(got.get(r[col('TC ID')]), r[col('재현 스탭')], `TC-${r[0]} 원문이 다르다`);
});
t('판정 보류 표시 = 비고 「기획 확인 필요」 행 수', () => {
  const want = final.rows.filter((r) => r[col('비고')] === '기획 확인 필요').length;
  assert.strictEqual((casesA.match(/판정 보류 — 기획 확인 필요/g) || []).length, want);
  assert.strictEqual(sumA.flagged, want);
});
t('추후 구현 행은 N/A 표시', () => {
  assert.match(casesA, /## TC-007\n[\s\S]*?N\/A\(추후 구현\)/);
});
t('기본기능은 스모크 파일 하나로 맨 앞', () => {
  const files = fs.readdirSync(path.join(outA, 'cases')).sort();
  assert.match(files[0], /^01_기본기능_스모크\.md$/);
  assert.strictEqual(files.length, 1 + 3);   // 스모크 + 소분류 3
});
t('INDEX: 실행 규칙(규칙 파일 본문) · 질문 2건 · 재현 수단', () => {
  const idx = fs.readFileSync(path.join(outA, 'INDEX.md'), 'utf8');
  const rules = fs.readFileSync(path.join(RULES, 'ai-실행규칙.md'), 'utf8').replace(/<!--[\s\S]*?-->\s*/g, '').trim();
  assert.ok(idx.includes(rules), '규칙 파일 본문이 그대로 들어가지 않았다');
  assert.match(idx, /기획 확인 질문 \(2건\)/);
  assert.match(idx, /쿠폰 코드 길이/);
  assert.match(idx, /요청 수량을 바꿔 보내는 테스트 도구/);
  assert.match(idx, /^tc_total: 10$/m);
});
t('근거 규칙은 커버리지 원장에서', () => {
  assert.match(casesA, /## TC-010\n[\s\S]*?근거 규칙 R-2\.2: 「한 번에 최대 99개까지 요청할 수 있다」/);
});
t('spec.md = 슬라이스 절 원문', () => {
  const spec = fs.readFileSync(path.join(outA, 'spec.md'), 'utf8');
  assert.match(spec, /쿠폰 코드는 12자리다/);
});
t('구조화·확신도가 없으면 그 줄을 지어내지 않는다', () => {
  assert.ok(!/^- (전제|조작|기대|관측):/m.test(casesA));
  assert.ok(!/^- 확신도:/m.test(casesA));
  assert.strictEqual(sumA.rewritten, 0);
});
t('다시 내보내도 results.md 는 지우지 않는다', () => {
  fs.appendFileSync(path.join(outA, 'results.md'), '<!-- 실행 기록 -->\n');
  exportBundle({ spec: specA, out: outA, rulesDir: RULES });
  assert.match(fs.readFileSync(path.join(outA, 'results.md'), 'utf8'), /실행 기록/);
});

// ── 다시 쓰기 + 확신도 있을 때 ──────────────────────────────────────────
const specB = copyFix('b');
const srcOf = (id) => final.rows.find((r) => r[col('TC ID')] === id)[col('재현 스탭')];
fs.writeFileSync(path.join(specB, 'ai_rewrite.json'), JSON.stringify({
  rows: { '010': { 전제: [], 조작: ['보상 수량을 99개 초과로 요청한다'], 기대: ['요청이 차단된다'], 관측: ['요청 결과 안내'], 원문: srcOf('010') } },
  fallback: { '006': ['polarity_lost'] },
  skipped: { '007': '추후 구현' },
}));
fs.writeFileSync(path.join(specB, 'ai_confidence.json'), JSON.stringify({
  summary: { dist: { A: 1, D: 1 }, total: 2 }, items: [{ tcid: '010', grade: 'A' }, { tcid: '009', grade: 'D' }],
}));
const outB = path.join(specB, 'ai_bundle');
const sumB = exportBundle({ spec: specB, out: outB, rulesDir: RULES });
const casesB = readCases(outB);

t('다시 쓴 TC 는 네 칸을 싣고 원문도 남긴다', () => {
  assert.match(casesB, /## TC-010\n[\s\S]*?- 재현 스탭\(원문\): 보상 수량을 99개 초과로 요청하면 요청이 차단되는지 확인\n- 조작:\n  1\. 보상 수량을 99개 초과로 요청한다\n- 기대: 요청이 차단된다\n- 관측: 요청 결과 안내/);
  assert.ok(!/## TC-010\n[\s\S]*?- 전제:[\s\S]*?## TC/.test(casesB), '빈 전제 줄을 찍었다');
  assert.strictEqual(sumB.rewritten, 1);
});
t('게이트에 걸린 TC 는 «원문대로 실행» 표시', () => {
  assert.match(casesB, /## TC-006\n[\s\S]*?- 구조화: 없음 — 원문대로 실행/);
  assert.strictEqual(sumB.fallback, 1);
});
t('확신도 C·D 는 근거 약함 안내', () => {
  assert.match(casesB, /## TC-009\n[\s\S]*?- 확신도: D \(근거 약함/);
  assert.match(casesB, /## TC-010\n[\s\S]*?- 확신도: A\n/);
});

// ── 다시 쓴 뒤에 확정본이 바뀌었을 때 (체인 재실행 후 --start-from export) ──
const specC = copyFix('stale');
fs.writeFileSync(path.join(specC, 'ai_rewrite.json'), JSON.stringify({
  rows: {
    '010': { 전제: [], 조작: ['보상 수량을 99개 초과로 요청한다'], 기대: ['요청이 차단된다'], 관측: ['요청 결과 안내'], 원문: srcOf('010') },
    '004': { 전제: [], 조작: ['옛 문장의 조작'], 기대: ['옛 문장의 기대'], 관측: ['옛 화면'], 원문: '바뀌기 전의 옛 문장' },
    '005': { 전제: [], 조작: ['원문이 안 적힌 조작'], 기대: ['원문이 안 적힌 기대'], 관측: ['화면'] },
  },
  fallback: {}, skipped: {},
}));
const outC = path.join(specC, 'ai_bundle');
const sumC = exportBundle({ spec: specC, out: outC, rulesDir: RULES });
const casesC = readCases(outC);
// TC 한 건의 블록만 — 다음 제목 앞에서 끊는다(느슨한 정규식이 옆 TC 의 줄을 잡아 통과하지 않게)
const blockOf = (md, id) => (md.match(new RegExp(`^#{2,3} TC-${id}\\n[\\s\\S]*?(?=^#{1,3} |(?![\\s\\S]))`, 'm')) || [''])[0];
const STALE_LINE = '- 구조화: 없음 — 원문대로 실행 (다시 쓴 뒤에 원문이 바뀌었다)';

t('원문이 바뀐 TC 는 옛 네 칸을 버리고 «원문대로» 표시', () => {
  assert.ok(!/옛 문장의/.test(casesC), '옛 다시 쓰기가 다른 문장에 붙었다');
  assert.ok(blockOf(casesC, '004').includes(STALE_LINE), blockOf(casesC, '004'));
});
t('원문이 안 적힌 칸도 대 볼 수 없으니 버린다', () => {
  assert.ok(!/원문이 안 적힌/.test(casesC));
  assert.ok(blockOf(casesC, '005').includes(STALE_LINE), blockOf(casesC, '005'));
});
t('원문이 같은 TC 는 그대로 싣고, 합계는 버린 것을 «원문대로»로 센다', () => {
  const b = blockOf(casesC, '010');
  assert.ok(b.includes('- 기대: 요청이 차단된다') && !b.includes(STALE_LINE), b);
  assert.deepStrictEqual([sumC.rewritten, sumC.fallback, sumC.stale], [1, 2, 2]);
});
t('원장(스냅샷·coverage_s4)이 없으면 근거 규칙을 싣지 않는다 — traceability 번호만으로 잇지 않는다', () => {
  assert.ok(!/근거 규칙/.test(casesC), '원장 없이 번호로 이었다');
  assert.strictEqual(sumC.rule_links_unmapped, null);   // 0 이면 «전부 이었다»로 읽힌다 — 원장 없음은 따로 구분
});

// ── S4·S5 가 행을 지우고·고치고·봉합해 번호가 밀린 런 ─────────────────────────
// 원장 번호는 S3 스냅샷 기준이다. 확정본 번호에 그대로 대면 다른 TC 에 근거 규칙이 붙는다(SKILL.md S5 「원장 tc_ids stale」).
const row = (id) => final.rows.find((r) => r[col('TC ID')] === id);
const withF = (r, f) => r.map((v, i) => (i === col('재현 스탭') ? f : v));
const OLD_004 = '새 우편이 3건일 때 배너 문구가 「신규 우편 3건」인지 확인';
const snapRows = [row('001'), row('002'), withF(row('003'), '우편함을 닫으면 배너가 사라지는지 확인'), row('003'), withF(row('004'), OLD_004),
  ...['005', '006', '007', '008', '009', '010'].map(row)].map((r, i) => [String(i + 1).padStart(3, '0'), ...r.slice(1)]);
const ruleText = Object.fromEntries(trace.mapped.map((m) => [m.rule_id, m.text]));
const covered = (id, ids, text = ruleText[id]) => ({ rule_id: id, sec_id: id.split('.')[0], text, tc_ids: ids, status: 'covered' });
const specD = copyFix('shift');
seedLedger(specD, {
  snapshotRows: snapRows,
  coverage: [
    { rule_id: 'R-1.1', tc_ids: ['001', '004', '005'] },   // = 확정본 001·003·004
    { rule_id: 'R-1.2', tc_ids: ['006', '007'] },          // = 005·006 (스냅샷 007 은 S5 가 거부한 수정 — 옛 문장 그대로)
    { rule_id: 'R-1.3', tc_ids: ['003'] },                 // S4 가 지운 행 — 확정본에 없다
    { rule_id: 'R-2.1', tc_ids: ['002', '009', '010'] },   // = 002·008·009
    { rule_id: 'R-2.2', tc_ids: ['011'] },                 // = 010
  ],
  patches: [
    { op: 'delete_row', tc_id: '003', reason: '중복' },
    { op: 'edit_cell', tc_id: '005', col: 'F', before: OLD_004, after: srcOf('004'), reason: '구체화' },
    { op: 'edit_cell', tc_id: '007', col: 'F', before: srcOf('006'), after: 'S5 가 되돌린 수정 문장', reason: '거부될 수정' },
  ],
  seal: [{ rule_id: 'R-3.1', f_texts: [srcOf('007')] }],
  // 체인이 실제로 남기는 traceability: S4 규칙은 스냅샷 번호, 봉합 규칙은 확정본 번호가 섞여 있다
  traceOverride: { ...trace, mapped: [covered('R-1.1', [1, 4, 5]), covered('R-1.2', [6, 7]), covered('R-1.3', [3], '우편함을 닫으면 배너를 숨긴다'),
    covered('R-2.1', [2, 9, 10]), covered('R-2.2', [11]), covered('R-3.1', [7], '쿠폰 사용 이력은 추후 제공한다'),
    ...trace.mapped.filter((m) => m.status !== 'covered')] },
});
const sumD = exportBundle({ spec: specD, out: path.join(specD, 'ai_bundle'), rulesDir: RULES });
const casesD = readCases(path.join(specD, 'ai_bundle'));
const rulesIn = (md) => (id) => [...blockOf(md, id).matchAll(/근거 규칙 (R-[\d.]+)/g)].map((m) => m[1]);
const rulesOf = rulesIn(casesD);

t('번호가 밀린 런: 근거 규칙은 번호가 아니라 재현 스탭 문장으로 잇는다', () => {
  assert.deepStrictEqual(rulesOf('010'), ['R-2.2']);   // 번호로 이으면 R-2.1(스냅샷 010 = 확정본 009)
  assert.deepStrictEqual(rulesOf('008'), ['R-2.1']);
  assert.deepStrictEqual(rulesOf('003'), ['R-1.1']);   // 번호로 이으면 지워진 행의 R-1.3
  assert.deepStrictEqual(rulesOf('004'), ['R-1.1']);   // S4 가 고친 문장으로 이어진다
  assert.deepStrictEqual(rulesOf('005'), ['R-1.2']);
  assert.deepStrictEqual(rulesOf('006'), ['R-1.2']);   // S5 가 거부한 수정 — 옛 문장으로 이어진다
  assert.deepStrictEqual(rulesOf('007'), ['R-3.1']);   // 봉합 규칙은 coverage_seal 의 문장으로
});
t('지워진 행에 매핑된 규칙은 어디에도 안 붙고 rule_links_unmapped 로 센다', () => {
  assert.ok(!/R-1\.3/.test(casesD));
  assert.strictEqual(sumD.rule_links_unmapped, 1);
});

// ── 같은 문장이 기본기능 행과 QA 본문 행에 함께 있을 때 ─────────────────────────
// 기본기능은 본문을 기획자 검수용으로 다시 적은 것이라 같은 문장이 설계상 허용된다(dup 게이트도 두 범위를 따로 본다).
// 문장만으로는 어느 행인지 갈리지 않으니 원장이 가리킨 스냅샷 행의 범위(기본기능 / QA)로 고른다.
const TWIN = srcOf('003');
const twinRows = final.rows.map((r) => (r[col('TC ID')] === '001' ? withF(r, TWIN) : r));
const specE = copyFix('twin');
fs.writeFileSync(path.join(specE, 'tcteam_tc_final.json'), JSON.stringify({ ...final, rows: twinRows }));
seedLedger(specE, {
  snapshotRows: twinRows,
  coverage: [{ rule_id: 'R-1.1', tc_ids: ['003'] }, { rule_id: 'R-1.2', tc_ids: ['001'] }],
  seal: [{ rule_id: 'R-3.1', f_texts: [TWIN] }],   // 봉합 문장에는 범위가 안 적혀 있다
  traceOverride: { ...trace, mapped: [covered('R-1.1', [3]), covered('R-1.2', [1]), covered('R-3.1', [3], '배너는 화면 상단에 둔다'),
    ...trace.mapped.filter((m) => m.status !== 'covered')] },
});
const sumE = exportBundle({ spec: specE, out: path.join(specE, 'ai_bundle'), rulesDir: RULES });
const rulesOfE = rulesIn(readCases(path.join(specE, 'ai_bundle')));

t('같은 문장이 기본기능·QA 두 행에 있으면 원장이 가리킨 행의 범위로 고른다', () => {
  assert.deepStrictEqual(rulesOfE('003'), ['R-1.1']);
  assert.deepStrictEqual(rulesOfE('001'), ['R-1.2']);
});
t('범위가 없는 봉합 문장이 두 행에 맞으면 싣지 않고 센다', () => {
  assert.ok(!rulesOfE('001').includes('R-3.1') && !rulesOfE('003').includes('R-3.1'));
  assert.strictEqual(sumE.rule_links_unmapped, 1);
});

// S4 가 쌍둥이 한쪽(기본기능)의 문장만 고쳤을 때 — 고친 문장은 그 행에, 원래 문장은 QA 쪽 쌍둥이에 맞는다.
// 같은 범위의 행을 먼저 찾아야 하나로 갈린다(범위 없이 모으면 두 행이 되어 버려진다).
const EDITED = '우편함을 열면 상단 배너 영역이 표시되는지 확인';
const specF = copyFix('twin-edit');
fs.writeFileSync(path.join(specF, 'tcteam_tc_final.json'), JSON.stringify({ ...final, rows: final.rows.map((r) => (r[col('TC ID')] === '001' ? withF(r, EDITED) : r)) }));
seedLedger(specF, {
  snapshotRows: twinRows,
  coverage: [{ rule_id: 'R-1.1', tc_ids: ['003'] }, { rule_id: 'R-1.2', tc_ids: ['001'] }],
  patches: [{ op: 'edit_cell', tc_id: '001', col: 'F', before: TWIN, after: EDITED, reason: '기본기능 재기술' }],
  traceOverride: { ...trace, mapped: [covered('R-1.1', [3]), covered('R-1.2', [1]), ...trace.mapped.filter((m) => m.status !== 'covered')] },
});
const sumF = exportBundle({ spec: specF, out: path.join(specF, 'ai_bundle'), rulesDir: RULES });
const rulesOfF = rulesIn(readCases(path.join(specF, 'ai_bundle')));

t('S4 가 쌍둥이 한쪽만 고쳐도 같은 범위의 행을 먼저 찾아 잇는다', () => {
  assert.deepStrictEqual(rulesOfF('001'), ['R-1.2']);
  assert.deepStrictEqual(rulesOfF('003'), ['R-1.1']);
  assert.strictEqual(sumF.rule_links_unmapped, 0);
});

// ── 입력 없음 ───────────────────────────────────────────────────────────
t('최종본이 없으면 실패(조용히 빈 묶음 금지)', () => {
  const d = copyFix('c');
  fs.rmSync(path.join(d, 'tcteam_tc_final.json'));
  assert.throws(() => exportBundle({ spec: d, out: path.join(d, 'ai_bundle'), rulesDir: RULES }), /tcteam_tc_final\.json/);
});

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
