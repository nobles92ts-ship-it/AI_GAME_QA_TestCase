#!/usr/bin/env node
'use strict';
// runagent_isolate.js — run-agent.sh 격리 모드(TCTEAM_ISOLATE=1)의 claude 인자를 만든다 (2026-09-25, 감사 P2-a·b)
//
// 왜: 자식 `claude -p` 가 사용자 설정을 통째로 실었다 — 플러그인·MCP 커넥터·훅(부팅 72~84K/호출), SessionStart 훅이
//   「직전에 끝난 아무 세션의 요약」을 주입(교차 오염), 에이전트 md 의 tools: 는 버려져 목록 밖 도구(Drive MCP·중첩 Agent)를 썼다.
// 무엇을: 설정 출처를 project,local 로 좁히고(사용자 설정 제외) 자동 기억을 끄고, MCP 는 에이전트가 요구한 플러그인 서버만, 도구는 목록대로.
//   단 안전 레일(사용자 deny 규칙 전부 + RAIL_HOOKS)은 --settings 로 자식에 그대로 싣는다 — 격리는 편의를 끊지 레일을 끊지 않는다.
// 입력: argv[2] = 에이전트 md 경로(없으면 빈 문자열) · env RUNAGENT_TOOLS = 에이전트 없는 호출의 도구 목록
// 출력: claude 인자를 한 줄에 하나(run-agent.sh 가 mapfile 로 받는다). 가변 인자(--tools·--mcp-config) 뒤에는 늘 플래그가 온다.
// 종료코드 3 = 이 호출은 격리할 수 없다(요구한 MCP 서버를 못 찾음) — 도구 없이 조용히 도느니 사용자 환경 그대로 돈다.
// 실측 근거(2.1.282): 인라인 JSON --mcp-config 로 서버 연결·도구 이름 유지 · ToolSearch 로 지연 로딩 · --settings 훅·deny 작동
//   → 사내 측정 기록(공개 배포본 미포함) · 테스트 tc-team/test/runagent_isolate.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');

const CFG = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const DEFAULT_TOOLS = 'Read,Write,Edit,Bash,Grep,Glob'; // 433세션 실측: 에이전트 없는 단계는 이 6종의 부분집합만 썼다
const RAIL_HOOKS = ['tcteam-running-edit-guard']; // 런 중 tc-team .sh 편집 차단 — 자식이 도는 동안이 바로 런 중이다
const fwd = (p) => p.replace(/\\/g, '/');
// 뇌 색인(KB)은 서버의 작업 폴더를 탄다 — 서버 env 로 못박아 cwd 를 안 박는 호출(설계자)도 게이트가 검사한 프로젝트 KB 를 보게 한다.
// 값 = 이 파일이 사는 프로젝트 루트(scripts/util/../..) = 체인의 PROJECT_ROOT(체인 3종 모두 RUNAGENT=$PROJECT_ROOT/scripts/util/run-agent.sh).
// 환경변수는 읽지 않는다 — 바깥 셸이 다른 프로젝트 값을 export 해 둔 채 체인을 띄우면 그대로 샌다(리뷰 2026-09-25). 대조 호출이 넘기던 값도 같은 루트다.
// (2026-09-25 실측: 프로젝트 밖 cwd 에서 env 있음 → brain-corpus-D 적중 · 없음 → Knowledge base is empty)
const PROJ = fwd(path.resolve(__dirname, '..', '..'));
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const csv = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);

function agentTools(file) {
  if (!file) return null;
  const fm = fs.readFileSync(file, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const m = fm && fm[1].match(/^tools:\s*(.+)$/m);
  if (!m) return null;
  const v = m[1].trim();
  return v.startsWith('[') ? JSON.parse(v) : csv(v);
}

// 서버 키 plugin_<플러그인>_<서버> → 설치된 플러그인의 서버 정의 (Claude Code 가 플러그인 서버에 붙이는 이름 그대로 — 도구 이름이 안 바뀐다)
function pluginServer(key) {
  const ip = readJson(path.join(CFG, 'plugins', 'installed_plugins.json'));
  for (const [id, entries] of Object.entries((ip && ip.plugins) || {})) {
    const pre = 'plugin_' + id.split('@')[0] + '_';
    if (!key.startsWith(pre)) continue;
    for (const e of [].concat(entries)) {
      const root = fwd(e.installPath || '');
      let servers = (readJson(path.join(root, '.claude-plugin', 'plugin.json')) || {}).mcpServers;
      if (typeof servers === 'string') servers = (readJson(path.join(root, servers)) || {}).mcpServers;
      if (!servers) servers = (readJson(path.join(root, '.mcp.json')) || {}).mcpServers;
      const s = servers && servers[key.slice(pre.length)];
      if (!s) continue;
      const sub = (x) => (typeof x === 'string' ? x.split('${CLAUDE_PLUGIN_ROOT}').join(root) : x);
      const env = Object.fromEntries(Object.entries(s.env || {}).map(([k, v]) => [k, sub(v)]));
      return { ...s, command: sub(s.command), args: (s.args || []).map(sub), env: { ...env, CLAUDE_PLUGIN_ROOT: root, CLAUDE_PROJECT_DIR: PROJ, CONTEXT_MODE_PROJECT_DIR: PROJ } };
    }
  }
  return null;
}

const tools = agentTools(process.argv[2]) || csv(process.env.RUNAGENT_TOOLS || DEFAULT_TOOLS);
const builtins = tools.filter((t) => !t.startsWith('mcp__'));
const servers = {};
for (const t of tools.filter((x) => x.startsWith('mcp__'))) {
  const key = t.slice('mcp__'.length).split('__')[0];
  if (servers[key]) continue;
  const s = key.startsWith('plugin_') ? pluginServer(key) : null;
  if (!s) {
    process.stderr.write(`[run-agent] 경고: 이 호출은 격리하지 않는다 — ${t} 의 MCP 서버(${key})를 설치된 플러그인에서 못 찾음. 사용자 환경 그대로 실행\n`);
    process.exit(3);
  }
  servers[key] = s;
}

const out = [];
const hasMcp = Object.keys(servers).length > 0;
// MCP 도구는 지연 로딩된다 — ToolSearch 가 없으면 스키마를 못 불러 호출을 못 한다(대조 실측 23/23 이 ToolSearch 로 ctx_search 를 불렀다)
out.push('--tools', (hasMcp && !builtins.includes('ToolSearch') ? [...builtins, 'ToolSearch'] : builtins).join(','));
if (hasMcp) out.push('--mcp-config', JSON.stringify({ mcpServers: servers }));

// 자동 기억(projects/<cwd>/memory/MEMORY.md)은 설정 출처와 무관하게 실린다 — 끄지 않으면 자식이 개인 메모·옛 TC 규칙을 읽고
// 기억을 쓸 수도 있다(2026-09-25 실측: 격리만으로는 적재 YES · 끄면 NO, 첫 요청 20.5K → 14.4K, 프로젝트 CLAUDE.md 는 유지)
const settings = { autoMemoryEnabled: false };
// 파일이 없으면 레일이 없는 것(막을 규칙 없음)이지만, 있는데 못 읽으면 레일을 모르는 것이다 — 레일 없이 격리하지 않는다
const US_PATH = path.join(CFG, 'settings.json');
const us = fs.existsSync(US_PATH) ? readJson(US_PATH) : {};
if (!us) {
  process.stderr.write(`[run-agent] 경고: 이 호출은 격리하지 않는다 — 사용자 settings.json 을 못 읽어(쓰는 중·손상) 안전 레일(deny·가드 훅)을 모른다. 사용자 환경 그대로 실행\n`);
  process.exit(3);
}
const deny = (us.permissions && us.permissions.deny) || [];
if (deny.length) settings.permissions = { deny };
for (const [ev, arr] of Object.entries(us.hooks || {})) {
  const keep = [].concat(arr)
    .map((h) => ({ ...h, hooks: (h.hooks || []).filter((x) => RAIL_HOOKS.some((r) => String(x.command || '').includes(r))) }))
    .filter((h) => h.hooks.length);
  if (keep.length) (settings.hooks = settings.hooks || {})[ev] = keep;
}
out.push('--settings', JSON.stringify(settings));

out.push('--setting-sources', 'project,local', '--strict-mcp-config');
process.stdout.write(out.join('\n') + '\n');
