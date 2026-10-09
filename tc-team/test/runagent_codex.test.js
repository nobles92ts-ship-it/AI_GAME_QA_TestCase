'use strict';
// runagent_codex — TCTEAM_ENGINE=codex 경로: 체인의 LLM 단계가 claude 없이 codex exec 로 돈다 (2026-10-01 Loki Codex 이식)
//
// 가짜 codex(받은 인자·프롬프트를 JSON 으로 적고 -o 파일에 답을 쓴다)와 가짜 claude(불리면 표식)를 PATH 에 두고
// 실제 run-agent-codex.sh 를 돌린다. LLM 호출 0. 확인하는 것:
//   ① 체인 3종이 엔진 분기를 갖고 기본값은 claude 그대로  ② 에이전트 본문·도구 이름 대응표가 프롬프트에 실린다
//   ③ ctx_search 를 요구한 에이전트에만 MCP 서버 하나 + 미리 승인  ④ 격리 플래그(사용자 설정·앱 커넥터 끔, workspace-write)
//   ⑤ 실패 문구가 pipeline_retry.sh 분류(10=인증, 11=한도)로 이어진다  ⑥ 어떤 경우에도 claude 를 부르지 않는다
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const BASH = process.platform === 'win32'
  ? (process.env.GIT_BASH || 'C:\\Program Files\\Git\\bin\\bash.exe')
  : 'bash';

const ROOT = path.join(__dirname, '..', '..');
const WRAP = path.join(ROOT, 'scripts', 'util', 'run-agent-codex.sh');
const RETRY = path.join(ROOT, 'scripts', 'util', 'pipeline_retry.sh');
const fwd = (p) => p.replace(/\\/g, '/');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  PASS ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' — ' + e.message); } }
const W = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s, 'utf8'); };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'xrc-'));

console.log('runagent_codex 테스트 (run-agent-codex.sh — Codex 엔진)');

// ① 엔진 분기 — 정적 확인 (체인 실행 없이)
t('체인 3종 모두 RUNAGENT 바로 뒤에 엔진 분기 1회, 기본은 run-agent.sh', () => {
  for (const f of ['run_pipeline_full.sh', 'run_pipeline_s1only.sh', 'finalize.sh']) {
    const s = fs.readFileSync(path.join(__dirname, '..', 'scripts', f), 'utf8');
    assert.strictEqual((s.match(/RUNAGENT="\$UTIL\/run-agent-codex\.sh"/g) || []).length, 1, f);
    assert.ok(/RUNAGENT="\$UTIL\/run-agent\.sh"\r?\n# 엔진 선택[^\n]*\r?\nif \[\[ "\$\{TCTEAM_ENGINE:-claude\}" == "codex" \]\]/.test(s), f + ' 분기 위치');
  }
});

// 가짜 바이너리
const BIN = tmp();
const FAKE_JS_BODY = `
const fs = require('fs');
const argv = process.argv.slice(2);
let stdin = ''; try { stdin = fs.readFileSync(0, 'utf8'); } catch {}
fs.writeFileSync(__FAKE_OUT__, JSON.stringify({ argv, stdin, env: process.env }));
const o = argv[argv.indexOf('-o') + 1];
const mode = __FAKE_MODE__;
const ev = (x) => process.stdout.write(JSON.stringify(x) + '\\n');
ev({ type: 'thread.started', thread_id: 't1' });
if (mode === 'reauth') { ev({ type: 'turn.failed', error: { message: 'Your access token could not be refreshed. Please log out and sign in again.' } }); process.exit(1); }
if (mode === 'credits') { ev({ type: 'turn.failed', error: { message: 'Your workspace is out of credits. Ask your workspace owner to refill in order to continue.' } }); process.exit(1); }
if (mode === 'limit') { ev({ type: 'turn.failed', error: { message: "You've hit your usage limit. Try again later." } }); process.exit(1); }
if (mode === 'partial') { fs.writeFileSync(o, 'PARTIAL'); process.exit(1); }
fs.writeFileSync(o, 'FAKE-ANSWER');
ev({ type: 'turn.completed' });
`;
const CLAUDE_MARK = path.join(BIN, 'claude_called.txt');
W(path.join(BIN, 'claude'), `#!/usr/bin/env bash\necho "$@" >> "${fwd(CLAUDE_MARK)}"\nexit 99\n`);
fs.chmodSync(path.join(BIN, 'claude'), 0o755);
W(path.join(BIN, 'claude.cmd'), `@echo off\r\necho %* >> "${CLAUDE_MARK}"\r\nexit /b 99\r\n`);

// 가짜 에이전트 서랍 (CLAUDE_CONFIG_DIR/agents) — 실제 사용자 에이전트는 읽지 않는다
const CFG = tmp();
W(path.join(CFG, 'agents', 'probe-ctx.md'), '---\nname: probe-ctx\ntools: ["Read", "Write", "mcp__plugin_context-mode_context-mode__ctx_search"]\nmodel: sonnet\n---\n역할 본문 PROBE-BODY-42\n');
W(path.join(CFG, 'agents', 'probe-plain.md'), '---\nname: probe-plain\ntools: Read, Write\n---\n평범한 본문\n');
W(path.join(CFG, 'agents', 'probe-empty.md'), '---\nname: probe-empty\n---\n\n');

function run(args, extra = {}, viaRetry = false) {
  const runDir = tmp();
  const out = path.join(runDir, 'call.json');
  const fakeJs = path.join(runDir, 'fake_codex.js');
  W(fakeJs, FAKE_JS_BODY.replace('__FAKE_OUT__', JSON.stringify(out))
                         .replace('__FAKE_MODE__', JSON.stringify(extra.FAKE_MODE || 'ok')));
  const fakeCmd = path.join(runDir, os.platform() === 'win32' ? 'codex.cmd' : 'codex');
  W(fakeCmd, os.platform() === 'win32'
    ? `@echo off\r\nnode "${fakeJs}" %*\r\n`
    : `#!/usr/bin/env bash\nexec node "${fwd(fakeJs)}" "$@"\n`);
  if (os.platform() !== 'win32') fs.chmodSync(fakeCmd, 0o755);
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.toUpperCase() === 'PATH' || /^(CODEX_CMD|TCTEAM_CODEX_MODEL|RUNAGENT_DEBUG_FILE)$/.test(k)) delete env[k];
  env.PATH = BIN + path.delimiter + (process.env.PATH || '');
  Object.assign(env, { CLAUDE_CONFIG_DIR: CFG, CODEX_CMD: fakeCmd }, extra);
  const cmd = viaRetry ? [BASH, [fwd(RETRY), fwd(path.join(tmp(), 'e.log')), '--', BASH, fwd(WRAP), ...args]]
                       : [BASH, [fwd(WRAP), ...args]];
  const r = spawnSync(cmd[0], cmd[1], { encoding: 'utf8', env });
  let call = null; try { call = JSON.parse(fs.readFileSync(out, 'utf8')); } catch { /* codex 미호출 */ }
  return { r, call };
}
const BASE = ['-p', '--permission-mode', 'bypassPermissions', '--model', 'sonnet'];
const has = (argv, s) => argv.some((a) => a.includes(s));
const after = (argv, flag) => argv[argv.indexOf(flag) + 1];

t('에이전트 없는 호출 — 격리 플래그·모델 고정·답이 stdout', () => {
  const { r, call } = run([...BASE, '작업 지시 TASK-7']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout.trim(), 'FAKE-ANSWER');
  const a = call.argv;
  assert.strictEqual(a[0], 'exec');
  for (const f of ['--ignore-user-config', '--ignore-rules']) assert.ok(a.includes(f), f);
  assert.strictEqual(after(a, '-m'), 'gpt-5.6-sol');
  assert.strictEqual(after(a, '-s'), 'workspace-write');
  assert.ok(has(a, 'windows.sandbox="elevated"'));
  const disabled = a.filter((x, i) => a[i - 1] === '--disable');
  for (const f of ['apps', 'plugins', 'memories', 'hooks', 'multi_agent']) assert.ok(disabled.includes(f), f);
  assert.ok(!a.includes('--dangerously-bypass-approvals-and-sandbox'));
  assert.ok(!has(a, 'mcp_servers'), '에이전트 없는 호출엔 MCP 없음');
  assert.ok(call.stdin.includes('TASK-7') && call.stdin.includes('[실행 환경 — Codex]'));
});

t('ctx_search 에이전트 — 본문 주입 + MCP 서버 하나 + 미리 승인', () => {
  const { r, call } = run([...BASE, '--agent', 'probe-ctx', 'HANDOFF-X']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(call.stdin.includes('PROBE-BODY-42') && call.stdin.includes('HANDOFF-X'));
  assert.ok(!call.stdin.includes('tools:'), 'frontmatter 는 떼어낸다');
  assert.ok(has(call.argv, 'mcp_servers.ctx.command'));
  assert.ok(has(call.argv, 'mcp_servers.ctx.default_tools_approval_mode="approve"'));
});

t('ctx 를 안 쓰는 에이전트엔 MCP 를 붙이지 않는다', () => {
  const { call } = run([...BASE, '--agent', 'probe-plain', 'H']);
  assert.ok(!has(call.argv, 'mcp_servers'));
});

t('Codex 자식 프로세스에는 봇 자격 환경변수가 전달되지 않는다', () => {
  const { r, call } = run([...BASE, 'H'], {
    SLACK_BOT_TOKEN: '__canary-slack', JIRA_API_TOKEN: '__canary-jira',
    GOOGLE_APPLICATION_CREDENTIALS: '__canary-google', OPENAI_API_KEY: '__canary-openai',
  });
  assert.strictEqual(r.status, 0, r.stderr);
  for (const key of ['SLACK_BOT_TOKEN', 'JIRA_API_TOKEN',
                     'GOOGLE_APPLICATION_CREDENTIALS', 'OPENAI_API_KEY',
                     'CLAUDE_CONFIG_DIR']) {
    assert.ok(!(key in call.env), `${key} leaked`);
  }
});

t('effort max → xhigh, 모델은 env 로만 바뀐다', () => {
  const { call } = run([...BASE, '--effort', 'max', 'H'], { TCTEAM_CODEX_MODEL: 'gpt-x' });
  assert.ok(has(call.argv, 'model_reasoning_effort="xhigh"'));
  assert.strictEqual(after(call.argv, '-m'), 'gpt-x');
});

t('빈 에이전트 본문·없는 에이전트·모르는 인자 = codex 호출 전 실패', () => {
  for (const args of [[...BASE, '--agent', 'probe-empty', 'H'], [...BASE, '--agent', 'nope', 'H'], [...BASE, '--weird', 'H']]) {
    const { r, call } = run(args);
    assert.notStrictEqual(r.status, 0); assert.strictEqual(call, null);
  }
});

t('재인증 실패 → pipeline_retry rc 10', () => {
  const { r } = run([...BASE, 'H'], { FAKE_MODE: 'reauth' }, true);
  assert.strictEqual(r.status, 10, r.stderr);
});

t('사용 한도 → pipeline_retry rc 11', () => {
  const { r } = run([...BASE, 'H'], { FAKE_MODE: 'limit' }, true);
  assert.strictEqual(r.status, 11, r.stderr);
});

t('크레딧 소진(실측 문구) → pipeline_retry rc 11 (재시도 안 함)', () => {
  const { r } = run([...BASE, 'H'], { FAKE_MODE: 'credits' }, true);
  assert.strictEqual(r.status, 11, r.stderr);
});

t('부분 답변이 있어도 비정상 종료는 성공으로 처리하지 않는다', () => {
  const { r } = run([...BASE, 'H'], { FAKE_MODE: 'partial' });
  assert.notStrictEqual(r.status, 0);
  assert.ok(r.stderr.includes('codex error'));
});

t('어떤 호출에서도 claude 는 불리지 않았다', () => {
  assert.ok(!fs.existsSync(CLAUDE_MARK), 'claude 호출 표식 발견');
});

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
