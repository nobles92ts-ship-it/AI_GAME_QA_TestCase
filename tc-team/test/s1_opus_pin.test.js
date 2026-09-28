'use strict';
// s1_opus_pin — S1 opus 자리(설계자 STEP 1 · 분석 공백 시 STEP 3 설계수정)만 claude-opus-5-5 를 기본값으로 쓴다
//
// 2026-09-24 오너 결정: S1 을 Opus 5.5 로 전환(effort max 유지). run-agent.sh 의 opus 핀(기본 claude-opus-5)은
// 구 v2 엔진(공개 배포본 미포함 — 거기도 --model opus)과 공유라 건드리지 않고, run_pipeline_s1only.sh 안에서만
// TCTEAM_OPUS_MODEL 기본값을 준다. 명시 env 가 이긴다(되돌리기 = TCTEAM_OPUS_MODEL=claude-opus-5).
// 근거 = 사내 감사 문서(공개 배포본 미포함) §3 · next_run_verify ㉑
//
// ① run_pipeline_s1only.sh 를 s1_crossref 스텁으로 실제로 돌려, 호출별 --model 자리와 TCTEAM_OPUS_MODEL 을 본다.
// ② 실제 run-agent.sh 를 가짜 claude 로 돌려, opus 별칭이 그 env 로 바뀌어 CLI 인자까지 가는지 본다.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const S1 = path.join(__dirname, '..', 'scripts', 'run_pipeline_s1only.sh');
const RUNAGENT = path.join(__dirname, '..', '..', 'scripts', 'util', 'run-agent.sh');
const FX = path.join(__dirname, 'fixtures', 's1_crossref');
const fwd = p => p.replace(/\\/g, '/');
const NODE = fwd(process.execPath);

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  PASS ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' — ' + e.message); } }

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'xs1o-'));
const W = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof o === 'string' ? o : JSON.stringify(o, null, 2), 'utf8'); };
const copyFx = (from, to) => W(to, fs.readFileSync(path.join(FX, from), 'utf8'));
const read = p => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
// 부모 셸에 모델 노브가 남아 있으면 기본값 검사가 무의미해진다 — 지우고 시작한다(Windows 는 PATH 키 대소문자가 섞여 따로 다룬다)
const baseEnv = () => { const e = { ...process.env }; delete e.TCTEAM_OPUS_MODEL; delete e.CLAUDE_CODE_MAX_OUTPUT_TOKENS; return e; };

console.log('s1_opus_pin 테스트 (S1 opus 자리 = claude-opus-5-5)');

// 샌드박스는 s1_designer_maxout.test.js 와 같다
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
  const env = { ...baseEnv(), TCTEAM_PROJECT_ROOT: fwd(root), TCTEAM_NODE: NODE,
    TCTEAM_HANDOFF_GATE: fwd(path.join(root, 'no_handoff_gate.py')), ...extraEnv };   // 인수게이트는 볼 대상이 아니다(없으면 건너뜀)
  const r = spawnSync('bash', [fwd(S1), '--feature', feat, '--sheet-id', 'TEST'], { encoding: 'utf8', env, cwd: root });
  const calls = read(path.join(util, 'calls.tsv')).split('\n').filter(Boolean)
    .map(l => { const [agent, maxOut, model, pin] = l.split('\t'); return { agent, maxOut, model, pin: (pin || '').trim() }; });
  const chainLog = read(path.join(spec, 'chain.log'));
  return { r, calls, chainLog, tail: ((r.stdout || '') + (r.stderr || '') + chainLog).slice(-1500) };
}

// 실제 run-agent.sh 를 돌리되 claude 자리에 인자만 적는 가짜를 둔다(LLM 호출 0)
function runAgentArgs(extraEnv, args) {
  const bin = tmp();
  const out = path.join(bin, 'argv.txt');
  W(path.join(bin, 'claude'), '#!/usr/bin/env bash\nprintf \'%s\\n\' "$@" > "$FAKE_OUT"\n');
  fs.chmodSync(path.join(bin, 'claude'), 0o755);
  const env = baseEnv();
  for (const k of Object.keys(env)) if (k.toUpperCase() === 'PATH') delete env[k];
  env.PATH = bin + path.delimiter + (process.env.PATH || '');
  Object.assign(env, { FAKE_OUT: fwd(out) }, extraEnv);
  const r = spawnSync('bash', [fwd(RUNAGENT), ...args], { encoding: 'utf8', env });
  return { r, argv: read(out).split('\n').filter(Boolean) };
}
const modelArg = argv => argv[argv.indexOf('--model') + 1];

const BASH_OK = spawnSync('bash', ['--version'], { encoding: 'utf8' }).status === 0;
if (!BASH_OK) {
  // 스킵하지 않는다 — 파이프라인 자체가 bash 로 도므로, 여기서 못 돌면 배선을 검증한 적이 없는 것이다.
  fail++; console.log('  FAIL bash 없음 — run_pipeline_s1only.sh 배선 테스트를 돌릴 수 없다');
} else {
  // ① 기본 런 — 검수 스텁이 needs_fix + analysis_gap 을 내게 해 STEP 3 설계자까지 opus 자리로 탄다
  const a = runChain({ STUB_NEEDS_FIX: '1', STUB_ANALYSIS_GAP: '1' });
  const designer = a.calls.filter(c => c.agent === 'tc-team-designer');
  const others = a.calls.filter(c => c.agent !== 'tc-team-designer');

  // 호출 수부터 못 박는다 — 설계자 호출이 0건이면 아래 검사가 빈 배열끼리 비교돼 진공 통과한다
  t('스텁 체인이 STEP 3 까지 완주한다 (exit 0 · 설계자 2회 · 검수·대조 2회)', () => {
    assert.strictEqual(a.r.status, 0, a.tail);
    assert.strictEqual(designer.length, 2, JSON.stringify(a.calls));
    assert.strictEqual(others.length, 2, JSON.stringify(a.calls));
  });

  t('설계자 호출(STEP 1 · 분석 공백 STEP 3)은 --model opus + 핀 env 기본 claude-opus-5-5', () => {
    assert.deepStrictEqual(designer.map(c => c.model), ['opus', 'opus'], JSON.stringify(a.calls));
    assert.deepStrictEqual(designer.map(c => c.pin), ['claude-opus-5-5', 'claude-opus-5-5'], JSON.stringify(a.calls));
  });

  t('검수·대조 호출은 --model sonnet 그대로 (S1 의 opus 자리만 바뀐다)', () => {
    assert.deepStrictEqual(others.map(c => c.model), ['sonnet', 'sonnet'], JSON.stringify(a.calls));
  });

  t('chain.log 에 설계자 모델 줄이 찍힌다 (다음 실런에서 적용 여부를 이 줄로 가른다)', () => {
    assert.ok(/\[STEP 1\] 설계자 모델 claude-opus-5-5 /.test(a.chainLog), a.tail);
  });

  // 명시 env 런 — 되돌리기 경로. 기본값을 하드코딩하면 여기서 걸린다
  const b = runChain({ TCTEAM_OPUS_MODEL: 'claude-opus-5' });
  t('명시 env 가 기본값을 이긴다 (TCTEAM_OPUS_MODEL=claude-opus-5 → 설계자도 claude-opus-5)', () => {
    assert.strictEqual(b.r.status, 0, b.tail);
    const d = b.calls.filter(c => c.agent === 'tc-team-designer').map(c => c.pin);
    assert.deepStrictEqual(d, ['claude-opus-5'], JSON.stringify(b.calls));
    assert.ok(/\[STEP 1\] 설계자 모델 claude-opus-5 /.test(b.chainLog), b.tail);
  });

  // ② 실제 run-agent.sh — 체인이 준 env 가 CLI 인자로 바뀌는 마지막 한 칸
  const p = runAgentArgs({ TCTEAM_OPUS_MODEL: 'claude-opus-5-5' }, ['-p', '--model', 'opus', 'hi']);
  t('실제 run-agent.sh: opus 별칭 + TCTEAM_OPUS_MODEL=claude-opus-5-5 → claude 에 --model claude-opus-5-5', () => {
    assert.strictEqual(p.r.status, 0, (p.r.stderr || '') + (p.r.stdout || ''));
    assert.strictEqual(modelArg(p.argv), 'claude-opus-5-5', JSON.stringify(p.argv));
  });

  const q = runAgentArgs({}, ['-p', '--model', 'opus', 'hi']);
  t('실제 run-agent.sh 기본값은 그대로 claude-opus-5 (v2 엔진 등 체인 밖 opus 호출은 무영향)', () => {
    assert.strictEqual(q.r.status, 0, (q.r.stderr || '') + (q.r.stdout || ''));
    assert.strictEqual(modelArg(q.argv), 'claude-opus-5', JSON.stringify(q.argv));
  });
}

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
