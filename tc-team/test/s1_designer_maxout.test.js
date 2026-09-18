'use strict';
// s1_designer_maxout — S1 설계자(tc-team-designer) 호출에만 CLI 출력 상한 기본값 128000 을 싣는다
//
// 2026-09-11 스킬_강화_시스템(508행): 설계자(opus·effort max)가 한 턴 사고만으로 CLI 기본 상한 64000 을 넘겨
// 5회 절단(stop_reason=max_tokens) 뒤 API Error 로 죽었다. 128000 재기동 시 최대 응답 85,077 로 통과.
// 2026-09-12 오너 결정(a): opus-5 유지 + 설계자 호출 두 곳(STEP 1·STEP 3)에만 기본값. 명시 env 가 이긴다.
// 검수·대조 호출과 v2 엔진(run-agent.sh 공유)은 CLI 기본 그대로 둔다.
//
// run_pipeline_s1only.sh 를 s1_crossref 스텁으로 실제로 돌려, 스텁 에이전트가 받은 env 를 호출별로 본다.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const S1 = path.join(__dirname, '..', 'scripts', 'run_pipeline_s1only.sh');
const FX = path.join(__dirname, 'fixtures', 's1_crossref');
const fwd = p => p.replace(/\\/g, '/');
const NODE = fwd(process.execPath);

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  PASS ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' — ' + e.message); } }

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'xs1m-'));
const W = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof o === 'string' ? o : JSON.stringify(o, null, 2), 'utf8'); };
const copyFx = (from, to) => W(to, fs.readFileSync(path.join(FX, from), 'utf8'));
const read = p => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };

console.log('s1_designer_maxout 테스트 (S1 설계자 출력 상한 기본값)');

// 샌드박스는 s1_crossref_cwd.test.js 와 같다. 부모 env 의 상한 변수는 지운다 — 셸에 값이 남아 있으면 기본값 검사가 무의미해진다.
function runChain(extraEnv) {
  const root = tmp(), feat = 'F';
  const spec = path.join(root, 'team', 'specs', feat);
  const util = path.join(root, 'scripts', 'util');
  W(path.join(root, 'team', 'tc_config.json'), { crossref_brain: 'on', crossref_source: 'brain-corpus', item_dict: 'off' });
  W(path.join(spec, 'confluence_raw.md'), '# 기획서 스텁\n' + '본문 '.repeat(200));   // 체인의 500B 하한 통과용
  copyFx('run-agent.sh', path.join(util, 'run-agent.sh'));
  copyFx('stub_agent.js', path.join(util, 'stub_agent.js'));
  copyFx('transition.sh', path.join(util, 'transition.sh'));
  copyFx('passthrough.sh', path.join(util, 'silent_exit_guard.sh'));
  copyFx('passthrough.sh', path.join(util, 'pipeline_retry.sh'));
  const { CLAUDE_CODE_MAX_OUTPUT_TOKENS: _parent, ...base } = process.env;
  const env = { ...base, TCTEAM_PROJECT_ROOT: fwd(root), TCTEAM_NODE: NODE,
    TCTEAM_HANDOFF_GATE: fwd(path.join(root, 'no_handoff_gate.py')), ...extraEnv };   // 인수게이트는 볼 대상이 아니다(없으면 건너뜀)
  const r = spawnSync('bash', [fwd(S1), '--feature', feat, '--sheet-id', 'TEST'], { encoding: 'utf8', env, cwd: root });
  const calls = read(path.join(util, 'calls.tsv')).split('\n').filter(Boolean)
    .map(l => { const [agent, maxOut] = l.split('\t'); return { agent, maxOut }; });
  const chainLog = read(path.join(spec, 'chain.log'));
  return { r, calls, chainLog, tail: ((r.stdout || '') + (r.stderr || '') + chainLog).slice(-1500) };
}

const BASH_OK = spawnSync('bash', ['--version'], { encoding: 'utf8' }).status === 0;
if (!BASH_OK) {
  // 스킵하지 않는다 — 파이프라인 자체가 bash 로 도므로, 여기서 못 돌면 배선을 검증한 적이 없는 것이다.
  fail++; console.log('  FAIL bash 없음 — run_pipeline_s1only.sh 배선 테스트를 돌릴 수 없다');
} else {
  // 기본 런 — 검수 스텁이 needs_fix 를 내게 해 STEP 3(설계수정)의 설계자 호출까지 탄다
  const a = runChain({ STUB_NEEDS_FIX: '1' });
  const designer = a.calls.filter(c => c.agent === 'tc-team-designer');
  const others = a.calls.filter(c => c.agent !== 'tc-team-designer');

  // 호출 수부터 못 박는다 — 설계자 호출이 0건이면 아래 상한 검사가 빈 배열끼리 비교돼 진공 통과한다
  t('스텁 체인이 STEP 3 까지 완주한다 (exit 0 · 설계자 2회 · 검수·대조 2회)', () => {
    assert.strictEqual(a.r.status, 0, a.tail);
    assert.strictEqual(designer.length, 2, JSON.stringify(a.calls));
    assert.strictEqual(others.length, 2, JSON.stringify(a.calls));
  });

  t('설계자 호출(STEP 1·STEP 3)은 env 가 없어도 출력 상한 128000 을 받는다', () => {
    assert.deepStrictEqual(designer.map(c => c.maxOut), ['128000', '128000'], JSON.stringify(a.calls));
  });

  t('검수·대조 호출은 상한을 받지 않는다 (CLI 기본 그대로 — 배선은 설계자 호출에만)', () => {
    assert.deepStrictEqual(others.map(c => c.maxOut), ['unset', 'unset'], JSON.stringify(a.calls));
  });

  t('chain.log 에 설계자 실효 상한이 찍힌다 (다음 실런에서 적용 여부를 이 줄로 가른다)', () => {
    assert.ok(/\[STEP 1\] 설계 시작 \(출력 상한 128000\)/.test(a.chainLog), a.tail);
    assert.ok(/\[STEP 3\] 설계수정 시작 \(.*출력 상한 128000\)/.test(a.chainLog), a.tail);
  });

  // 명시 env 런 — 운영자가 준 값이 기본값을 이긴다(128000 을 하드코딩하면 여기서 걸린다)
  const b = runChain({ CLAUDE_CODE_MAX_OUTPUT_TOKENS: '64000' });
  t('명시 env 가 기본값을 이긴다 (CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000 → 설계자도 64000)', () => {
    assert.strictEqual(b.r.status, 0, b.tail);
    const d = b.calls.filter(c => c.agent === 'tc-team-designer').map(c => c.maxOut);
    assert.deepStrictEqual(d, ['64000'], JSON.stringify(b.calls));
  });
}

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
