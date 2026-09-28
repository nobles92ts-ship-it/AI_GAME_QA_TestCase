'use strict';
// runagent_isolate — run-agent.sh 격리 모드(TCTEAM_ISOLATE=1): 자식 claude 가 개인 환경을 싣지 않는다 (2026-09-24 감사 P2-a·b)
//
// 결함: 모든 자식 `claude -p` 가 사용자 설정(플러그인·훅·MCP 커넥터·effortLevel)을 통째로 실었다 — 부팅 74K/호출,
//   SessionStart 훅이 「직전 아무 세션의 요약」을 주입(교차 오염), 에이전트 md 의 tools: 는 버려져 목록 밖 도구
//   (Drive MCP trash 110건 · 중첩 Agent)를 썼다. 격리 모드는 설정 출처·MCP·도구를 코드가 정한다.
// 가짜 claude(인자만 JSON 으로 적는다)로 실제 run-agent.sh 를 돌려 claude 에 넘어가는 인자를 본다. LLM 호출 0.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RUNAGENT = path.join(__dirname, '..', '..', 'scripts', 'util', 'run-agent.sh');
const fwd = (p) => p.replace(/\\/g, '/');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  PASS ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' — ' + e.message); } }
const W = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof o === 'string' ? o : JSON.stringify(o, null, 1), 'utf8'); };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'xri-'));

console.log('runagent_isolate 테스트 (run-agent.sh 격리 모드)');

// 가짜 claude — 받은 인자를 JSON 배열로 적는다(시스템 프롬프트의 개행도 보존)
const BIN = tmp();
W(path.join(BIN, 'claude'), '#!/usr/bin/env bash\nnode -e \'require("fs").writeFileSync(process.env.FAKE_OUT, JSON.stringify(process.argv.slice(1)))\' -- "$@"\n');
fs.chmodSync(path.join(BIN, 'claude'), 0o755);

function run(args, extraEnv = {}) {
  const out = path.join(tmp(), 'argv.json');
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.toUpperCase() === 'PATH' || /^(TCTEAM_ISOLATE|RUNAGENT_TOOLS|RUNAGENT_DEBUG_FILE|CLAUDE_PROJECT_DIR|CONTEXT_MODE_PROJECT_DIR)$/.test(k)) delete env[k];
  env.PATH = BIN + path.delimiter + (process.env.PATH || '');
  Object.assign(env, { FAKE_OUT: fwd(out) }, extraEnv);
  const r = spawnSync('bash', [fwd(RUNAGENT), ...args], { encoding: 'utf8', env });
  let argv = null; try { argv = JSON.parse(fs.readFileSync(out, 'utf8')); } catch { /* claude 미호출 */ }
  return { r, argv, err: (r.stderr || '') + (r.stdout || '') };
}
const after = (argv, flag) => { const i = argv.indexOf(flag); return i < 0 ? undefined : argv[i + 1]; };
const count = (argv, flag) => argv.filter((a) => a === flag).length;
const BASE = ['-p', '--permission-mode', 'bypassPermissions', '--model', 'sonnet'];

// 에이전트·플러그인 픽스처 — CLAUDE_CONFIG_DIR 로 가리킨다
const CFG = tmp();
const PLUG = path.join(CFG, 'plugcache', 'fakeplug', '1.0.0');
W(path.join(CFG, 'plugins', 'installed_plugins.json'), { version: 2, plugins: { 'fakeplug@mk': [{ scope: 'user', installPath: PLUG, version: '1.0.0' }] } });
W(path.join(PLUG, '.claude-plugin', 'plugin.json'), { name: 'fakeplug', mcpServers: { fakesrv: { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/s.mjs'] } } });
W(path.join(CFG, 'agents', 'ag-mcp.md'), '---\nname: ag-mcp\ntools: ["Read", "Write", "mcp__plugin_fakeplug_fakesrv__search"]\n---\n본문\n');
W(path.join(CFG, 'agents', 'ag-plain.md'), '---\nname: ag-plain\ntools: ["Read", "Write", "Edit", "Bash"]\n---\n본문\n');
W(path.join(CFG, 'agents', 'ag-missing.md'), '---\nname: ag-missing\ntools: ["Read", "mcp__plugin_nope_srv__x"]\n---\n본문\n');
// 사용자 설정 — 레일(deny 전부 + 가드 훅)만 자식에 가고, 나머지 훅(요약 주입·압축 제안)은 안 간다
const GUARD_CMD = 'node "C:/x/hooks/tcteam-running-edit-guard.js"';
W(path.join(CFG, 'settings.json'), {
  permissions: { deny: ['Read(C:/secret/.env)'], allow: ['Bash(*)'] },
  effortLevel: 'high',
  hooks: {
    PreToolUse: [
      { matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'node "C:/x/hooks/suggest-compact.js"' }] },
      { matcher: 'Edit|Write|NotebookEdit', hooks: [{ type: 'command', command: GUARD_CMD }, { type: 'command', command: 'node "C:/x/hooks/other.js"' }] },
    ],
    SessionStart: [{ matcher: '*', hooks: [{ type: 'command', command: 'node "C:/x/hooks/session-start.js"' }] }],
  },
});

const BASH_OK = spawnSync('bash', ['--version'], { encoding: 'utf8' }).status === 0;
if (!BASH_OK) {
  fail++; console.log('  FAIL bash 없음');
} else {
  const off = run([...BASE, 'hi']);
  t('격리 끔(기본) — 인자 불변 (v2 엔진 등 다른 호출자 무영향)', () => {
    assert.ok(off.argv, off.err);
    for (const f of ['--setting-sources', '--strict-mcp-config', '--tools', '--mcp-config']) assert.strictEqual(count(off.argv, f), 0, f + ' 가 붙음: ' + JSON.stringify(off.argv));
  });

  const on = run([...BASE, 'hi'], { TCTEAM_ISOLATE: '1' });
  t('격리 켬 — 사용자 설정 제외 · MCP 없음 · 기본 도구 6종', () => {
    assert.ok(on.argv, on.err);
    assert.strictEqual(after(on.argv, '--setting-sources'), 'project,local');
    assert.strictEqual(count(on.argv, '--strict-mcp-config'), 1);
    assert.strictEqual(count(on.argv, '--mcp-config'), 0);
    assert.strictEqual(after(on.argv, '--tools'), 'Read,Write,Edit,Bash,Grep,Glob');
  });
  t('격리 켬 — 자동 기억(MEMORY.md)을 끈다: 설정 출처와 무관하게 실리므로 --settings 로 명시', () => {
    assert.strictEqual(JSON.parse(after(on.argv, '--settings')).autoMemoryEnabled, false);
  });
  t('격리 켬 — 사용자 설정 effortLevel 대신 명시 effort high (지금까지의 실효값)', () => {
    assert.strictEqual(after(on.argv, '--effort'), 'high', JSON.stringify(on.argv));
  });
  t('격리 켬 — 가변 인자(--tools)가 프롬프트를 삼키지 않는다: 프롬프트는 마지막 인자, --tools 바로 뒤는 플래그', () => {
    assert.strictEqual(on.argv[on.argv.length - 1], 'hi');
    const i = on.argv.indexOf('--tools');
    assert.ok(i >= 0, '--tools 없음');
    assert.ok(on.argv[i + 2].startsWith('--'), '--tools 뒤가 플래그가 아니다: ' + on.argv[i + 2]);
  });

  const eff = run([...BASE, '--effort', 'max', 'hi'], { TCTEAM_ISOLATE: '1' });
  t('격리 켬 + 호출자가 --effort 를 줬으면 덧붙이지 않는다', () => {
    assert.strictEqual(count(eff.argv, '--strict-mcp-config'), 1, '격리가 안 켜짐');
    assert.strictEqual(count(eff.argv, '--effort'), 1);
    assert.strictEqual(after(eff.argv, '--effort'), 'max');
  });
  const effTxt = run([...BASE, '프롬프트 본문에 --effort 라는 글자가 있다'], { TCTEAM_ISOLATE: '1' });
  t('격리 켬 + 프롬프트 글자 속 "--effort" 는 호출자 플래그로 보지 않는다', () => {
    assert.strictEqual(after(effTxt.argv, '--effort'), 'high');
  });

  const rl = run([...BASE, 'hi'], { TCTEAM_ISOLATE: '1', CLAUDE_CONFIG_DIR: fwd(CFG) });
  t('격리 켬 — 안전 레일: 사용자 deny 규칙 전부 + 가드 훅만 --settings 로 싣는다(요약 주입·다른 훅·allow 는 안 간다)', () => {
    assert.ok(rl.argv, rl.err);
    const s = JSON.parse(after(rl.argv, '--settings'));
    assert.deepStrictEqual(s.permissions, { deny: ['Read(C:/secret/.env)'] });
    assert.deepStrictEqual(Object.keys(s.hooks), ['PreToolUse']);
    assert.deepStrictEqual(s.hooks.PreToolUse, [{ matcher: 'Edit|Write|NotebookEdit', hooks: [{ type: 'command', command: GUARD_CMD }] }]);
    assert.strictEqual(s.effortLevel, undefined);
    assert.strictEqual(s.autoMemoryEnabled, false);
  });

  const ov = run([...BASE, 'hi'], { TCTEAM_ISOLATE: '1', RUNAGENT_TOOLS: 'Read,Write' });
  t('격리 켬 + RUNAGENT_TOOLS — 에이전트 없는 호출의 도구 목록을 바꾼다', () => {
    assert.strictEqual(after(ov.argv, '--tools'), 'Read,Write');
  });

  const ag = run([...BASE, '--agent', 'ag-plain', 'hi'], { TCTEAM_ISOLATE: '1', CLAUDE_CONFIG_DIR: fwd(CFG) });
  t('격리 켬 + --agent — 에이전트 md 의 tools: 가 --tools 가 된다(버려지지 않는다)', () => {
    assert.ok(ag.argv, ag.err);
    assert.strictEqual(after(ag.argv, '--tools'), 'Read,Write,Edit,Bash');
    assert.ok(after(ag.argv, '--system-prompt').includes('본문'), '--system-prompt 누락');
  });

  const am = run([...BASE, '--agent', 'ag-mcp', 'hi'], { TCTEAM_ISOLATE: '1', CLAUDE_CONFIG_DIR: fwd(CFG) });
  t('격리 켬 + 플러그인 MCP 도구 — 그 플러그인 서버만 --mcp-config 로 준다(이름 그대로 plugin_<플러그인>_<서버>)', () => {
    assert.ok(am.argv, am.err);
    const inline = after(am.argv, '--mcp-config');
    assert.ok(inline, '--mcp-config 없음: ' + JSON.stringify(am.argv));
    const cfg = JSON.parse(inline); // 파일이 아니라 인라인 JSON — 임시 파일 경쟁·청소가 없다
    const srv = cfg.mcpServers && cfg.mcpServers.plugin_fakeplug_fakesrv;
    assert.ok(srv, '서버 키가 plugin_fakeplug_fakesrv 가 아니다: ' + JSON.stringify(cfg));
    assert.strictEqual(fwd(srv.args[0]), fwd(path.join(PLUG, 's.mjs')), '${CLAUDE_PLUGIN_ROOT} 치환 안 됨');
    assert.strictEqual(fwd(srv.env.CLAUDE_PLUGIN_ROOT), fwd(PLUG));
  });
  t('격리 켬 + 플러그인 MCP 도구 — 내장 도구만 --tools 로, 지연 로딩용 ToolSearch 를 더한다', () => {
    assert.strictEqual(after(am.argv, '--tools'), 'Read,Write,ToolSearch');
  });
  // 뇌 색인(KB)은 서버의 작업 폴더를 탄다 — 설계자처럼 cwd 를 안 박는 호출도 게이트가 검사한 프로젝트 KB 를 보게 서버 env 로 못박는다
  // (2026-09-25 실측: 프로젝트 밖 cwd 에서 env 있음 → brain-corpus-D 적중 · 없음 → Knowledge base is empty)
  const ROOT = fwd(path.resolve(path.dirname(RUNAGENT), '..', '..'));
  t('격리 켬 + 플러그인 MCP — 서버 env 에 KB 프로젝트를 못박는다(기본 = run-agent.sh 의 프로젝트 루트)', () => {
    const srv = JSON.parse(after(am.argv, '--mcp-config')).mcpServers.plugin_fakeplug_fakesrv;
    assert.strictEqual(srv.env.CLAUDE_PROJECT_DIR, ROOT);
    assert.strictEqual(srv.env.CONTEXT_MODE_PROJECT_DIR, ROOT);
  });
  // 바깥 셸이 다른 프로젝트 값을 export 해 둔 채 체인을 띄워도 새지 않는다 (리뷰 MEDIUM 2026-09-25) — env 는 안 읽는다.
  //   대조 호출이 넘기던 값도 같은 PROJECT_ROOT(run-agent.sh 가 $PROJECT_ROOT/scripts/util 에 산다)라 동작은 같다
  const amp = run([...BASE, '--agent', 'ag-mcp', 'hi'], { TCTEAM_ISOLATE: '1', CLAUDE_CONFIG_DIR: fwd(CFG), CONTEXT_MODE_PROJECT_DIR: 'C:/x/other', CLAUDE_PROJECT_DIR: 'C:/x/other' });
  t('격리 켬 + 플러그인 MCP — 바깥 env(CONTEXT_MODE_PROJECT_DIR·CLAUDE_PROJECT_DIR)가 다른 프로젝트여도 루트로 못박는다', () => {
    const srv = JSON.parse(after(amp.argv, '--mcp-config')).mcpServers.plugin_fakeplug_fakesrv;
    assert.strictEqual(srv.env.CLAUDE_PROJECT_DIR, ROOT);
    assert.strictEqual(srv.env.CONTEXT_MODE_PROJECT_DIR, ROOT);
  });

  const miss = run([...BASE, '--agent', 'ag-missing', 'hi'], { TCTEAM_ISOLATE: '1', CLAUDE_CONFIG_DIR: fwd(CFG) });
  t('격리 켬 + MCP 서버를 못 찾으면 이 호출은 격리하지 않고 경고한다(도구 없이 조용히 도는 것보다 낫다)', () => {
    assert.ok(miss.argv, miss.err);
    assert.strictEqual(count(miss.argv, '--strict-mcp-config'), 0, JSON.stringify(miss.argv));
    assert.ok(/격리하지 않는다/.test(miss.err), '경고 없음: ' + miss.err);
  });

  // 사용자 settings.json 이 있는데 못 읽으면(쓰는 중·손상) 레일을 모른다 — 레일 없이 격리하지 말고 이 호출은 사용자 환경 그대로 (리뷰 MEDIUM 2026-09-25)
  const BAD = tmp();
  W(path.join(BAD, 'settings.json'), '{ "permissions": { "deny": [ "Read(C:/secret/.env)" ');
  const bad = run([...BASE, 'hi'], { TCTEAM_ISOLATE: '1', CLAUDE_CONFIG_DIR: fwd(BAD) });
  t('격리 켬 + settings.json 파싱 실패 → 레일 없이 격리하지 않는다(경고 + 사용자 환경 그대로)', () => {
    assert.ok(bad.argv, bad.err);
    assert.strictEqual(count(bad.argv, '--strict-mcp-config'), 0, JSON.stringify(bad.argv));
    assert.strictEqual(count(bad.argv, '--settings'), 0);
    assert.ok(/격리하지 않는다/.test(bad.err) && /settings\.json/.test(bad.err), '경고 없음: ' + bad.err);
  });
  const none = tmp();   // settings.json 이 아예 없으면 레일이 없는 것이지 못 읽은 게 아니다 — 격리한다
  const nos = run([...BASE, 'hi'], { TCTEAM_ISOLATE: '1', CLAUDE_CONFIG_DIR: fwd(none) });
  t('격리 켬 + settings.json 없음 → 격리한다(레일 없음 = 막을 규칙이 없음)', () => {
    assert.strictEqual(count(nos.argv, '--strict-mcp-config'), 1, nos.err);
    assert.deepStrictEqual(JSON.parse(after(nos.argv, '--settings')), { autoMemoryEnabled: false });
  });

  // 실제 에이전트 3종 — frontmatter tools 가 실사용 도구를 덮어야 격리해도 안 깨진다
  // (2026-09-10~24 운영 433세션 실측: 설계자 Edit 21/22 · 설계수정 Edit 20/20 · 검수 Edit 1/20 · 대조 ToolSearch 23/23·Edit 2/23)
  // ⚠ 설계자 ctx_search: STEP 3 설계수정이 검수의 「미대조 기획확인 → 재대조 지시」를 받아 뇌에 다시 묻는다(09-10~ 8회 = 중첩 Agent(tc-team-대조) 5 ·
  //   ctx_search 3). 격리가 둘 다 막자 09-25 샌드박스에서 「ctx_search 도구가 이 세션에는 없어」 Vault 수동 Grep → 18건 전부 keep 으로 새었다.
  //   중첩 Agent 는 격리 자식에 사용자 에이전트 정의가 안 실려 못 되살린다 → ctx_search 직접 경로를 준다.
  const AG = path.join(os.homedir(), '.claude', 'agents');
  const tools = (name) => { const c = fs.readFileSync(path.join(AG, name + '.md'), 'utf8'); const m = c.match(/^tools:\s*(.+)$/m); return m ? JSON.parse(m[1]) : []; };
  const CTX = 'mcp__plugin_context-mode_context-mode__ctx_search';
  for (const [name, need] of [['tc-team-designer', ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', CTX]], ['tc-team-설계검수', ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob']], ['tc-team-대조', ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', CTX]]]) {
    t(`실제 ${name} frontmatter tools 가 실사용 도구를 덮는다`, () => {
      const got = tools(name);
      const missing = need.filter((x) => !got.includes(x));
      assert.deepStrictEqual(missing, [], '빠진 도구: ' + missing.join(','));
    });
  }
  const real = run([...BASE, '--agent', 'tc-team-대조', 'hi'], { TCTEAM_ISOLATE: '1' });
  t('실제 tc-team-대조 — 설치된 context-mode 서버로 --mcp-config 가 만들어진다', () => {
    assert.ok(real.argv, real.err);
    const cfg = after(real.argv, '--mcp-config');
    assert.ok(cfg, '--mcp-config 없음: ' + real.err);
    const srv = JSON.parse(cfg).mcpServers['plugin_context-mode_context-mode'];
    assert.ok(srv && fs.existsSync(srv.args[srv.args.length - 1]), 'context-mode 서버 진입점이 없다: ' + JSON.stringify(srv));
  });
  t('실제 사용자 설정 — 런 중 .sh 편집 가드 훅이 격리된 자식에도 실린다', () => {
    const s = JSON.parse(after(real.argv, '--settings') || '{}');
    const cmds = ((s.hooks || {}).PreToolUse || []).flatMap((h) => h.hooks.map((x) => x.command));
    assert.ok(cmds.some((c) => c.includes('tcteam-running-edit-guard')), '가드 훅 없음: ' + JSON.stringify(s));
  });
  const rd = run([...BASE, '--agent', 'tc-team-designer', 'hi'], { TCTEAM_ISOLATE: '1' });
  t('실제 tc-team-designer — 격리되고 context-mode 서버(KB = 프로젝트 루트)와 ToolSearch 를 받는다', () => {
    assert.ok(rd.argv, rd.err);
    assert.strictEqual(count(rd.argv, '--strict-mcp-config'), 1, rd.err);
    const srv = JSON.parse(after(rd.argv, '--mcp-config')).mcpServers['plugin_context-mode_context-mode'];
    assert.ok(srv, 'context-mode 서버 없음');
    assert.strictEqual(srv.env.CONTEXT_MODE_PROJECT_DIR, ROOT);
    assert.strictEqual(after(rd.argv, '--tools'), [...tools('tc-team-designer').filter((x) => !x.startsWith('mcp__')), 'ToolSearch'].join(','));
  });
  const rv = run([...BASE, '--agent', 'tc-team-설계검수', 'hi'], { TCTEAM_ISOLATE: '1' });
  t('실제 tc-team-설계검수 — 격리된다(MCP 없음 · 도구 = frontmatter)', () => {
    assert.ok(rv.argv, rv.err);
    assert.strictEqual(count(rv.argv, '--strict-mcp-config'), 1, rv.err);
    assert.strictEqual(count(rv.argv, '--mcp-config'), 0);
    assert.strictEqual(after(rv.argv, '--tools'), tools('tc-team-설계검수').join(','));
  });
}

// 체인 3종이 격리를 켠다(명시 env 가 이긴다 — 롤백 = TCTEAM_ISOLATE=0). crossref_delta.sh 는 source 되어 호출측 값을 따른다.
const SCRIPTS = path.join(__dirname, '..', 'scripts');
for (const f of ['run_pipeline_full.sh', 'run_pipeline_s1only.sh', 'finalize.sh']) {
  t(`${f} 가 TCTEAM_ISOLATE 기본 1 을 export 한다`, () => {
    const src = fs.readFileSync(path.join(SCRIPTS, f), 'utf8');
    assert.ok(/^export TCTEAM_ISOLATE="\$\{TCTEAM_ISOLATE:-1\}"\r?$/m.test(src), f + ' 에 export 없음');
  });
}

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
