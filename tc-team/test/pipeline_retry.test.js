'use strict';
// Real retry/guard processes, synthetic CLI replies only; no models or business specs.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const BASH = process.env.TCTEAM_BASH || (process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash');
const UTIL = path.resolve(__dirname, '../../scripts/util');
const RETRY = process.env.TCTEAM_TEST_RETRY || path.join(UTIL, 'pipeline_retry.sh');
const forward = s => s.replace(/\\/g, '/');
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + e.message); } }

function run(replies, guarded = false) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-retry-'));
  try {
    const counter = path.join(tmp, 'count');
    // Bash on Windows normalizes PATH; BASH_ENV makes timer mocking unambiguous.
    const timers = path.join(tmp, 'test-timers.sh');
    fs.writeFileSync(timers, 'sleep() { return 0; }\n');
    const cli = path.join(tmp, 'fake.js');
    fs.writeFileSync(cli, `const fs=require('fs');const f=process.env.FAKE_COUNTER;
const n=fs.existsSync(f)?+fs.readFileSync(f,'utf8'):0;fs.writeFileSync(f,String(n+1));
const r=JSON.parse(process.env.FAKE_REPLIES)[n]||{rc:0};
if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);process.exit(r.rc);`);
    const result = path.join(tmp, 'step_result.json');
    fs.writeFileSync(result, '{"status":"old-success"}');
    const retryArgs = [forward(RETRY), forward(path.join(tmp, 'error.log')), '--', forward(process.execPath), forward(cli)];
    const args = guarded ? [forward(path.join(UTIL, 'silent_exit_guard.sh')), forward(result), '--', BASH, ...retryArgs] : retryArgs;
    const out = spawnSync(BASH, args, { encoding: 'utf8', timeout: 12000, env: {
      ...process.env, BASH_ENV: forward(timers),
      SILENT_GUARD_BACKOFFS: '0 0 0', FAKE_COUNTER: counter, FAKE_REPLIES: JSON.stringify(replies),
    } });
    assert.ifError(out.error);
    return { status: out.status, calls: +fs.readFileSync(counter, 'utf8'), log: out.stdout + out.stderr };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
const capacity = { rc: 1, stderr: 'codex error: Selected model is at capacity\n' };
test('capacity stderr is terminal availability, one call', () => {
  const r = run([capacity]); assert.strictEqual(r.status, 11); assert.strictEqual(r.calls, 1); assert.match(r.log, /type=capacity/);
});
test('capacity stdout is also classified', () => {
  const r = run([{ rc: 1, stdout: 'Selected model is at capacity\n' }]); assert.strictEqual(r.status, 11); assert.strictEqual(r.calls, 1);
});
test('outer guard never retries capacity with an old success file', () => {
  const r = run([capacity], true); assert.strictEqual(r.status, 11); assert.strictEqual(r.calls, 1); assert.doesNotMatch(r.log, /silent exit|미갱신 감지/);
});
for (const [first, second, code] of [
  ['ECONNRESET', 'invalid_grant OAuth error', 10],
  ['ECONNRESET', "You've hit your session limit", 11],
  ['HTTP 429', 'Selected model is at capacity', 11],
  ['generic failure', 'invalid_grant OAuth error', 10],
]) test('retry reclassifies ' + first + ' -> ' + second, () => {
  const r = run([{ rc: 1, stderr: first }, { rc: 1, stderr: second }]);
  assert.strictEqual(r.status, code); assert.strictEqual(r.calls, 2);
});
test('ordinary error still retries once and can succeed', () => {
  const r = run([{ rc: 1, stderr: 'generic failure' }, { rc: 0, stdout: 'ok' }]); assert.strictEqual(r.status, 0); assert.strictEqual(r.calls, 2);
});
test('successful explanatory text is not classified as an error', () => {
  const r = run([{ rc: 0, stdout: 'The log previously said: Selected model is at capacity.' }]); assert.strictEqual(r.status, 0); assert.strictEqual(r.calls, 1);
});
console.log(`\n결과: ${passed} PASS / ${failed} FAIL`);
process.exit(failed ? 1 : 0);
