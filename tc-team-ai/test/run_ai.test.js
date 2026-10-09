'use strict';
// run_ai — tc-team-ai 러너 배선. 가짜 프로젝트 루트에 체인·재시도기·LLM 을 스텁(fixtures/run_ai_stubs)으로 두고 러너만 실물로 돌린다.
//   체인에 넘기는 인자 · LLM 호출 모양(모델·권한·도구·격리) · 종료코드(체인 rc 그대로 · 인증 10 · 한도 15 · 확정본 없음 14)
//   · 묶음·상태 done · 재개(--start-from rewrite|export)를 잠근다. 확신도 산식·상태 기록기는 실물 사본을 쓴다.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveRulesDir } = require('../lib/paths');
const copyFlat = require('./copy_fixture');

const AI = path.join(__dirname, '..');
const REAL_ROOT = path.join(AI, '..');
const RUN_AI = path.join(AI, 'scripts', 'run_ai.js');
const FIX = path.join(__dirname, 'fixtures', 'sample_run');
const STUBS = path.join(__dirname, 'fixtures', 'run_ai_stubs');
const RULES = resolveRulesDir();
const FEAT = '_ai_샘플_우편';
const fwd = (p) => p.replace(/\\/g, '/');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  PASS ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' — ' + e.message); } }
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
const cp = (src, dst) => { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); };

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xai-'));
  cp(path.join(REAL_ROOT, 'tc-team', 'scripts', 'confidence', 'confidence_core.js'), path.join(root, 'tc-team', 'scripts', 'confidence', 'confidence_core.js'));
  cp(path.join(REAL_ROOT, 'scripts', 'util', 'design_tree_lines.js'), path.join(root, 'scripts', 'util', 'design_tree_lines.js'));
  cp(path.join(REAL_ROOT, 'tc-team', 'lib', 'state_projection.js'), path.join(root, 'tc-team', 'lib', 'state_projection.js'));
  cp(path.join(STUBS, 'chain.sh'), path.join(root, 'tc-team', 'scripts', 'run_pipeline_full.sh'));
  cp(path.join(STUBS, 'retry.sh'), path.join(root, 'scripts', 'util', 'pipeline_retry.sh'));
  cp(path.join(STUBS, 'agent.sh'), path.join(root, 'scripts', 'util', 'run-agent.sh'));
  fs.mkdirSync(path.join(root, 'stub'), { recursive: true });
  fs.mkdirSync(path.join(root, 'team', 'specs'), { recursive: true });
  return root;
}
const specOf = (root) => path.join(root, 'team', 'specs', FEAT);
const seedSpec = (root) => copyFlat(FIX, specOf(root));   // 기능명이 한글 — fs.cpSync 금지(copy_fixture.js)

function runAi(root, args, extra = {}) {
  const env = { ...process.env };
  for (const k of ['TCTEAM_ENGINE', 'TCTEAM_AI_MODEL', 'TCTEAM_AI_PAR', 'RUNAGENT_TOOLS', 'TCTEAM_ISOLATE', 'STUB_AGENT_RC', 'STUB_AGENT_MODE', 'STUB_CHAIN_RC', 'STUB_CHAIN_FINAL']) delete env[k];
  Object.assign(env, { TCTEAM_PROJECT_ROOT: fwd(root), TCTEAM_AI_RULES_DIR: RULES, STUB_DIR: fwd(path.join(root, 'stub')), STUB_FIXTURE: fwd(FIX) }, extra);
  const r = spawnSync(process.execPath, [RUN_AI, ...args], { encoding: 'utf8', env, cwd: root });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/^AI_DONE (.+)$/m);
  return { status: r.status, out, done: m ? JSON.parse(m[1]) : null, log: read(path.join(specOf(root), 'chain.log')), tail: out.slice(-1500) };
}
const lines = (p) => read(p).split('\n').filter(Boolean);
const chainArgs = (root) => lines(path.join(root, 'stub', 'chain_args.txt'));
const agentCalls = (root) => lines(path.join(root, 'stub', 'agent_calls.txt'));
const stateOf = (root) => {
  const s = read(path.join(root, 'team', 'state.json'));
  return s ? ((JSON.parse(s).specs || []).find((x) => x.feature === FEAT) || {}).state : undefined;
};
const bundleMade = (root) => fs.existsSync(path.join(specOf(root), 'ai_bundle', 'INDEX.md'));

console.log('run_ai 테스트 (tc-team-ai 러너 배선)');
const BASH_OK = spawnSync('bash', ['--version'], { encoding: 'utf8' }).status === 0;
if (!BASH_OK) {
  fail++; console.log('  FAIL bash 없음 — 러너 배선 테스트를 돌릴 수 없다');
} else {
  {
    const root = makeRoot();
    const bad = [[[], /--feature 가 없다/], [['--feature', '샘플_우편_ai'], /_ai_ 로 시작해야/], [['--feature', '_ai_../샘플'], /경로 문자/],
      [['--feature', FEAT, '--start-from', 's6'], /잘못된 --start-from/], [['--feature', FEAT, '--sheet-id', 'X'], /알 수 없는 인자/],
      // 체인이 기능명을 셸 문자열(bash -c "…'$SPEC'…")에 그대로 넣는다 — 따옴표·공백·셸 문자는 받지 않는다
      [['--feature', "_ai_Don't_Panic"], /글자·숫자·_·- 만/], [['--feature', '_ai_우편 개선'], /글자·숫자·_·- 만/],
      [['--feature', '_ai_x;touch_y'], /글자·숫자·_·- 만/], [['--feature', '_ai_$(id)'], /글자·숫자·_·- 만/]];
    const rs = bad.map(([args]) => runAi(root, args));
    t(`사용법 오류 ${bad.length}종 → exit 1 · 체인을 띄우지 않는다`, () => {
      rs.forEach((r, i) => { assert.strictEqual(r.status, 1, r.tail); assert.match(r.out, bad[i][1]); });
      assert.deepStrictEqual(chainArgs(root), []);
    });
  }
  {
    const root = makeRoot();
    const r = runAi(root, ['--feature', FEAT, '--conf-url', 'https://example.atlassian.net/wiki/x']);
    t('끝까지: exit 0 + AI_DONE 요약', () => {
      assert.strictEqual(r.status, 0, r.tail);
      assert.ok(r.done, 'AI_DONE 줄이 없다');
      assert.deepStrictEqual([r.done.tc, r.done.rewritten, r.done.fallback, r.done.stale, r.done.flagged, r.done.confidence], [10, 9, 0, 0, 2, true]);
      assert.strictEqual(r.done.rule_links_unmapped, null);   // 스텁 체인은 원장(스냅샷·coverage_s4)을 안 남긴다
      assert.match(r.log, /\[AI\] 내보내기 — .*근거 규칙 원장 없음/);
    });
    t('체인에는 시트 없이 넘긴다 (--no-sheet · S1 부터 · conf-url 그대로)', () => {
      assert.deepStrictEqual(chainArgs(root), ['--feature', FEAT, '--no-sheet', '--start-from', 's1', '--conf-url', 'https://example.atlassian.net/wiki/x']);
    });
    t('LLM 호출 = 체인 run_llm 과 같은 모양 + 도구는 읽기·쓰기만, 격리 켬', () => {
      assert.deepStrictEqual(agentCalls(root), ['ARGS -p --permission-mode bypassPermissions --model sonnet | TOOLS=Read,Write ISO=1']);
    });
    t('묶음·다시 쓰기·확신도 산출 + 추후 구현은 다시 쓰기에서 뺀다', () => {
      assert.ok(bundleMade(root));
      const rw = JSON.parse(read(path.join(specOf(root), 'ai_rewrite.json')));
      assert.deepStrictEqual(rw.stats, { targets: 9, rewritten: 9, fallback: 0, skipped: 1, outputs: 1 });
      assert.match(read(path.join(specOf(root), 'ai_confidence.json')), /시트 없음/);
    });
    t('state.json 에 done · 러너 로그는 체인 로그(chain.log)에 같이 남는다', () => {
      assert.strictEqual(stateOf(root), 'done');
      assert.match(r.log, /\[stub chain\][\s\S]*\[AI\] 다시 쓰기 끝[\s\S]*\[AI\] 완료/);
    });
  }
  {
    const root = makeRoot();
    const r = runAi(root, ['--feature', FEAT], { STUB_CHAIN_RC: '15' });
    t('체인 rc 를 그대로 돌려주고 AI 단계로 안 간다', () => {
      assert.strictEqual(r.status, 15, r.tail);
      assert.deepStrictEqual(agentCalls(root), []);
      assert.ok(!bundleMade(root) && stateOf(root) !== 'done');
    });
  }
  {
    const root = makeRoot();
    const r = runAi(root, ['--feature', FEAT], { STUB_CHAIN_FINAL: '0' });
    t('체인은 0 인데 확정본이 없으면 무결성 정지(14)', () => {
      assert.strictEqual(r.status, 14, r.tail);
      assert.match(r.log, /\[STOP:무결성\]/);
      assert.deepStrictEqual(agentCalls(root), []);
    });
  }
  for (const [rc, want] of [['10', 10], ['11', 15]]) {
    const root = makeRoot();
    const r = runAi(root, ['--feature', FEAT], { STUB_AGENT_RC: rc });
    t(`다시 쓰기 실행기 rc ${rc} → exit ${want} · 묶음·done 없음`, () => {
      assert.strictEqual(r.status, want, r.tail);
      assert.strictEqual(agentCalls(root).length, 1, '중단 뒤에도 LLM 을 더 띄웠다');
      assert.ok(!bundleMade(root) && stateOf(root) !== 'done');
    });
  }
  {
    const root = makeRoot();
    const r = runAi(root, ['--feature', FEAT], { STUB_AGENT_RC: '1' });
    t('다시 쓰기 결과 파일이 한 번도 안 나오면(실행기 고장) exit 12 · 묶음·done 없음', () => {
      assert.strictEqual(r.status, 12, r.tail);
      assert.match(r.log, /\[STOP:다시 쓰기\]/);
      assert.strictEqual(agentCalls(root).length, 2, '청크 1개 × 2회차');
      assert.ok(!bundleMade(root) && stateOf(root) !== 'done');
    });
  }
  {
    const root = makeRoot();
    const r = runAi(root, ['--feature', FEAT], { STUB_AGENT_MODE: 'fenced' });
    t('결과 파일은 있는데 JSON 으로 안 읽히면(형식 틀림) 역시 exit 12 — 안내에 형식 확인이 들어간다', () => {
      assert.strictEqual(r.status, 12, r.tail);
      assert.match(r.log, /\[STOP:다시 쓰기\].*있으면 그 형식/);
      assert.strictEqual(agentCalls(root).length, 2, '청크 1개 × 2회차');
      assert.ok(!bundleMade(root) && stateOf(root) !== 'done');
    });
  }
  {
    const root = makeRoot();
    const r = runAi(root, ['--feature', FEAT], { STUB_AGENT_MODE: 'reject' });
    t('결과는 나왔는데 게이트가 전부 거르면 정상 경로 — 원문대로 내보내고 exit 0', () => {
      assert.strictEqual(r.status, 0, r.tail);
      assert.deepStrictEqual([r.done && r.done.rewritten, r.done && r.done.fallback], [0, 9]);
      assert.ok(bundleMade(root) && stateOf(root) === 'done');
    });
  }
  {
    const root = makeRoot();
    const sp = seedSpec(root);
    fs.writeFileSync(path.join(sp, 'ai_confidence.json'), JSON.stringify({ source: '지난 런', summary: { dist: { D: 1 }, total: 1 }, items: [{ tcid: '010', grade: 'D' }] }));
    const r = runAi(root, ['--feature', FEAT, '--start-from', 'export']);
    t('--start-from export: 체인·LLM 없이 내보내고, 확신도는 새로 잰다(지난 값 안 씀)', () => {
      assert.strictEqual(r.status, 0, r.tail);
      assert.deepStrictEqual([chainArgs(root), agentCalls(root)], [[], []]);
      assert.match(read(path.join(sp, 'ai_confidence.json')), /시트 없음/);
      const cases = fs.readdirSync(path.join(sp, 'ai_bundle', 'cases')).map((f) => read(path.join(sp, 'ai_bundle', 'cases', f))).join('\n');
      assert.ok(!/확신도: D/.test(cases), '지난 런의 확신도가 붙었다');
    });
  }
  {
    const root = makeRoot();
    const sp = seedSpec(root);
    fs.writeFileSync(path.join(sp, 'ai_confidence.json'), JSON.stringify({ source: '지난 런', summary: { dist: { D: 1 }, total: 1 }, items: [{ tcid: '010', grade: 'D' }] }));
    fs.rmSync(path.join(sp, 'tc_design.md'));   // 확신도 계산이 실패하는 모양(설계서 없음)
    const r = runAi(root, ['--feature', FEAT, '--start-from', 'export']);
    t('확신도 계산이 실패하면 경고만 남기고 내보낸다 — 지난 확신도 파일은 지운다', () => {
      assert.strictEqual(r.status, 0, r.tail);
      assert.match(r.log, /\[AI\]\[경고\] 확신도 건너뜀/);
      assert.ok(!fs.existsSync(path.join(sp, 'ai_confidence.json')), '지난 런의 확신도 파일이 남았다');
      assert.strictEqual(r.done && r.done.confidence, false);
    });
  }
  {
    const root = makeRoot();
    const r = runAi(root, ['--feature', FEAT, '--start-from', 'rewrite']);
    t('--start-from rewrite 인데 확정본이 없으면 exit 1(체인부터)', () => {
      assert.strictEqual(r.status, 1, r.tail);
      assert.match(r.out, /체인부터/);
      assert.deepStrictEqual(agentCalls(root), []);
    });
  }
  {
    const root = makeRoot();
    seedSpec(root);
    const r = runAi(root, ['--feature', FEAT, '--start-from', 'rewrite'], { TCTEAM_AI_PAR: 'abc', TCTEAM_AI_MODEL: 'haiku' });
    t('노브: 잘못된 TCTEAM_AI_PAR 는 경고 후 기본값 · TCTEAM_AI_MODEL 은 그대로 넘긴다', () => {
      assert.strictEqual(r.status, 0, r.tail);
      assert.match(r.log, /TCTEAM_AI_PAR='abc' 가 1 이상의 정수가 아니다 — 기본값 4/);
      assert.match(agentCalls(root)[0] || '', /--model haiku /);
      assert.deepStrictEqual(chainArgs(root), []);
    });
  }
}

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
