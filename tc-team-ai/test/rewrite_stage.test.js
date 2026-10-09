'use strict';
// rewrite_stage — 다시 쓰기 팬아웃. LLM 자리에 가짜 실행기를 꽂아 청크·재시도·폴백·중단을 결정론으로 잠근다.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { rewriteStage, buildPrompt } = require('../lib/rewrite_stage');
const { readFinal } = require('../lib/tc_rows');
const copyFlat = require('./copy_fixture');

const FIX = path.join(__dirname, 'fixtures', 'sample_run');
let pass = 0, fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const copyFix = (tag) => copyFlat(FIX, fs.mkdtempSync(path.join(os.tmpdir(), `airw-${tag}-`)));

const faithful = (row) => ({ id: row.id, 전제: [], 조작: [row.재현스탭], 기대: [row.재현스탭], 관측: ['화면'] });
// 가짜 실행기: meta.inFile 을 읽고 meta.outFile 에 쓴다. plan(row, attempt) 가 null 이면 그 행을 빼먹는다.
function fakeAgent(plan, calls) {
  return async (prompt, meta) => {
    const input = JSON.parse(fs.readFileSync(meta.inFile, 'utf8'));
    calls.push({ attempt: meta.attempt, ids: input.rows.map((r) => r.id), prompt });
    const rows = input.rows.map((r) => plan(r, meta.attempt)).filter(Boolean);
    fs.writeFileSync(meta.outFile, JSON.stringify({ rows }), 'utf8');
    return 0;
  };
}
const run = (spec, invoke, extra = {}) => rewriteStage({ spec, records: readFinal(spec).records, rulesText: '규칙 본문', invoke, ...extra });

t('충실한 실행기 → 추후 구현만 빼고 전부 구조화', async () => {
  const calls = [];
  const r = await run(copyFix('ok'), fakeAgent(faithful, calls));
  assert.ok(r.ok);
  assert.deepStrictEqual(Object.keys(r.data.rows).sort(), ['001', '002', '003', '004', '005', '006', '008', '009', '010']);
  assert.deepStrictEqual(Object.keys(r.data.skipped), ['007']);
  assert.strictEqual(Object.keys(r.data.fallback).length, 0);
  assert.ok(!calls.some((c) => c.ids.includes('007')), '추후 구현 행을 LLM 에 보냈다');
  const bad = readFinal(FIX).records.filter((x) => r.data.rows[x.id] && r.data.rows[x.id]['원문'] !== x.f);
  assert.deepStrictEqual(bad.map((x) => x.id), [], '다시 쓴 칸에 그때의 원문이 같이 안 적혔다');
});
t('게이트에 걸린 행만 2회차에 다시 보낸다', async () => {
  const calls = [];
  const plan = (row, a) => (row.id === '004' && a === 1 ? { ...faithful(row), 조작: ['새 우편이 있는 상태에서 우편함을 연다'], 기대: ['배너 문구가 출력된다'] } : faithful(row));
  const r = await run(copyFix('retry'), fakeAgent(plan, calls));
  assert.ok(r.data.rows['004'], '2회차 결과를 받지 않았다');
  assert.deepStrictEqual(calls.filter((c) => c.attempt === 2).map((c) => c.ids), [['004']]);
  assert.match(calls.find((c) => c.attempt === 2).prompt, /TC-004/);
});
t('끝까지 걸리면 원문으로(폴백) — 사유를 남긴다', async () => {
  const plan = (row) => (row.id === '006' ? { ...faithful(row), 기대: ['보상이 지급된다'] } : faithful(row));
  const r = await run(copyFix('fb'), fakeAgent(plan, []));
  assert.ok(!r.data.rows['006']);
  assert.ok(r.data.fallback['006'].includes('polarity_lost'), JSON.stringify(r.data.fallback['006']));
  assert.strictEqual(r.data.stats.fallback, 1);
});
t('빠뜨린 행은 다시 보내고, 끝까지 없으면 no_output', async () => {
  const calls = [];
  const plan = (row, a) => (row.id === '003' && a === 1 ? null : row.id === '010' ? null : faithful(row));
  const r = await run(copyFix('miss'), fakeAgent(plan, calls));
  assert.ok(r.data.rows['003']);
  assert.deepStrictEqual(r.data.fallback['010'], ['no_output']);
});
t('같은 id 를 두 번 내면 그 행은 받지 않는다', async () => {
  const plan = (row) => faithful(row);
  const dupAgent = async (prompt, meta) => {
    const input = JSON.parse(fs.readFileSync(meta.inFile, 'utf8'));
    const rows = input.rows.map(plan);
    if (meta.attempt === 1) rows.push(plan(input.rows.find((x) => x.id === '005')));
    fs.writeFileSync(meta.outFile, JSON.stringify({ rows }), 'utf8');
    return 0;
  };
  const r = await run(copyFix('dup'), dupAgent);
  assert.ok(r.data.rows['005'], '2회차에서 받았어야 한다');
});
t('JSON 이 깨져도 다음 시도로 넘어간다', async () => {
  const agent = async (prompt, meta) => {
    if (meta.attempt === 1) { fs.writeFileSync(meta.outFile, '{ 깨진', 'utf8'); return 0; }
    const input = JSON.parse(fs.readFileSync(meta.inFile, 'utf8'));
    fs.writeFileSync(meta.outFile, JSON.stringify({ rows: input.rows.map(faithful) }), 'utf8');
    return 0;
  };
  const r = await run(copyFix('broken'), agent);
  assert.strictEqual(Object.keys(r.data.rows).length, 9);
});
t('인증(10)·한도(11)는 남은 청크를 띄우지 않고 멈춘다', async () => {
  for (const rc of [10, 11]) {
    const calls = [];
    const agent = async (prompt, meta) => { calls.push(meta); return rc; };
    const r = await run(copyFix('abort'), agent, { chunkSize: 2, par: 1 });
    assert.ok(!r.ok); assert.strictEqual(r.abort, rc);
    assert.strictEqual(calls.length, 1, `rc=${rc} 뒤에도 ${calls.length - 1}개를 더 띄웠다`);
  }
});
t('청크 병렬: 청크마다 한 번씩, 동시 한도 안에서', async () => {
  let live = 0, peak = 0;
  const calls = [];
  const inner = fakeAgent(faithful, calls);
  const agent = async (p, m) => { live++; peak = Math.max(peak, live); await new Promise((res) => setTimeout(res, 20)); const rc = await inner(p, m); live--; return rc; };
  const r = await run(copyFix('par'), agent, { chunkSize: 3, par: 2 });
  assert.strictEqual(calls.length, 3);   // 대상 9행 / 3행 청크
  assert.ok(peak <= 2, `동시 ${peak}`);
  assert.strictEqual(Object.keys(r.data.rows).length, 9);
});
t('프롬프트: 규칙 본문·입출력 경로·행 수를 싣는다', () => {
  const p = buildPrompt({ rulesText: '규칙 본문', inFile: 'C:/x/in.json', outFile: 'C:/x/out.json', count: 7, retryNote: '' });
  assert.match(p, /규칙 본문/); assert.match(p, /"C:\/x\/in\.json"/); assert.match(p, /"C:\/x\/out\.json"/); assert.match(p, /정확히 7개/);
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); pass++; console.log('  PASS ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' — ' + e.message); }
  }
  console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})();
