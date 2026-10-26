'use strict';
// The real S1 shell with fixed local stub replies, isolated team/specs and no external calls.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const BASH = process.env.TCTEAM_BASH || (process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash');
const S1 = path.resolve(__dirname, '../scripts/run_pipeline_s1only.sh');
const FX = path.join(__dirname, 'fixtures/s1_crossref');
const fwd = s => s.replace(/\\/g, '/');
let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('PASS ' + name); } catch (e) { fail++; console.log('FAIL ' + name + ': ' + e.message); } }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); }

function fixture(engine, repair = true, failAfterResult = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-s1-evidence-'));
  const spec = path.join(root, 'team/specs/F'), util = path.join(root, 'scripts/util');
  write(path.join(root, 'team/tc_config.json'), JSON.stringify({ crossref_brain: 'off', item_dict: 'off' }));
  write(path.join(spec, 'confluence_raw.md'), '# fixture\n' + '본문 '.repeat(200));
  for (const name of ['run-agent.sh', 'run-agent-codex.sh', 'transition.sh', 'silent_exit_guard.sh', 'pipeline_retry.sh']) {
    const source = name.startsWith('run-agent') ? 'run-agent.sh' : name === 'transition.sh' ? name : 'passthrough.sh';
    write(path.join(util, name), fs.readFileSync(path.join(FX, source)));
  }
  write(path.join(util, 'stub_agent.js'), `
const fs=require('fs'),path=require('path');const [agent,prompt='']=process.argv.slice(2);
const spec=process.env.FIX_SPEC;const w=(n,v)=>fs.writeFileSync(path.join(spec,n),typeof v==='string'?v:JSON.stringify(v));
const step=Number((prompt.match(/- STEP: (\\d+)/)||[])[1]);
fs.appendFileSync(path.join(spec,'calls.jsonl'),JSON.stringify({agent,step,prompt})+'\\n');
if(agent==='tc-team-designer'){
 w('analysis.md','### A-5. GlobalDefine 키 목록\\n| 키 | 초기값 |\\n|---|---|\\n| MinLevel | 20 |\\n');
 const value=step===3&&process.env.FIX_REPAIR==='1'?20:30;
 w('tc_design.md','## GlobalDefine 키 목록\\n| 키 | 초기값 |\\n|---|---|\\n| MinLevel | '+value+' |\\n');
 w('step_result.json',{step,status:'success'});
 if(step===1&&process.env.FIX_FAIL==='1')process.exit(7);
}else if(agent==='tc-team-설계검수'){
 w('audit_seen_by_reviewer.json',{exists:fs.existsSync(path.join(spec,'design_evidence_audit.json')),handoff:prompt.includes('design_evidence_audit.json')});
 w('step_result.json',{step:2,status:'success',needs_fix:false,analysis_gap:0});
}else process.exit(3);
`);
  const result = spawnSync(BASH, [fwd(S1), '--feature', 'F', '--local'], {
    encoding: 'utf8', timeout: 45000, env: { ...process.env, TCTEAM_PROJECT_ROOT: fwd(root), TCTEAM_NODE: fwd(process.execPath),
      TCTEAM_ENGINE: engine, TCTEAM_HANDOFF_GATE: fwd(path.join(root, 'no-gate.py')),
      FIX_SPEC: spec, FIX_REPAIR: repair ? '1' : '0', FIX_FAIL: failAfterResult ? '1' : '0' },
  });
  const calls = fs.existsSync(path.join(spec, 'calls.jsonl')) ? fs.readFileSync(path.join(spec, 'calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse) : [];
  return { root, spec, result, calls, read: name => JSON.parse(fs.readFileSync(path.join(spec, name), 'utf8')) };
}

for (const engine of ['claude', 'codex']) test(engine + ': audit reaches reviewer and forces existing STEP3 despite needs_fix:false', () => {
  const f = fixture(engine);
  try {
    assert.ifError(f.result.error);
    assert.strictEqual(f.result.status, 0, f.result.stdout + f.result.stderr);
    assert.deepStrictEqual(f.read('audit_seen_by_reviewer.json'), { exists: true, handoff: true });
    assert.deepStrictEqual(f.calls.map(x => x.step || 2), [1, 2, 3]);
    assert.strictEqual(f.read('design_evidence_audit.json').summary.high, 0);
    assert.ok(f.calls.find(x => x.step === 3).prompt.includes('design_evidence_audit.json'));
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});
test('unchanged mismatch after STEP3 stops the chain before S2', () => {
  const f = fixture('claude', false);
  try { assert.strictEqual(f.result.status, 14, f.result.stdout + f.result.stderr); assert.ok(f.read('design_evidence_audit.json').summary.high > 0); }
  finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});
test('nonzero child result cannot be overridden by success JSON', () => {
  const f = fixture('claude', true, true);
  try { assert.strictEqual(f.result.status, 7, f.result.stdout + f.result.stderr); assert.strictEqual(f.calls.length, 1); }
  finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});
console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
