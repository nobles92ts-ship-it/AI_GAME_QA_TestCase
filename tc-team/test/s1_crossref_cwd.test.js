'use strict';
// s1_crossref_cwd — S1 본 대조(STEP 2-대조) 에이전트는 호출 폴더와 무관하게 프로젝트 루트에서 돈다
//
// 2026-09-11 실측(기능A 사본 · 같은 입력 · 에이전트 작업 폴더만 바꿈): 체인을 프로젝트 밖에서 띄우면
// CLAUDE_PROJECT_DIR·CONTEXT_MODE_PROJECT_DIR 을 박아도 에이전트의 context-mode 가 **자기 작업 폴더의 KB** 를 골랐다
// (그 폴더 해시로 새 빈 KB 생성 → "Knowledge base is empty" → 전량 keep). 바로 앞 색인 게이트는
// --project-dir 로 PROJECT_ROOT KB 를 보므로 초록이다 — 게이트가 본 KB 와 에이전트가 뒤지는 KB 가 갈린다.
// → 델타 대조(crossref_delta.sh)와 같은 고정: 서브셸에서 프로젝트 루트로 cd 한 뒤 에이전트를 띄운다.
//
// 모양 검사(정규식)가 아니라 run_pipeline_s1only.sh 를 LLM·시트·Slack 없이 스텁으로 **실제로 돌려**
// 대조 에이전트가 기록한 작업 폴더를 본다. 샌드박스 = TCTEAM_PROJECT_ROOT (UTIL·team·specs 전부 그 밑).
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

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'xs1-'));
const W = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof o === 'string' ? o : JSON.stringify(o, null, 2), 'utf8'); };
const copyFx = (from, to) => W(to, fs.readFileSync(path.join(FX, from), 'utf8'));
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

console.log('s1_crossref_cwd 테스트 (S1 본 대조 에이전트 작업 폴더 고정)');

// 에이전트 3종 = fixtures/s1_crossref/stub_agent.js · transition = 무동작 스텁 · guard/retry = 명령 통과 스텁
function sandbox() {
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
  return { root, spec, feat };
}

const BASH_OK = spawnSync('bash', ['--version'], { encoding: 'utf8' }).status === 0;
if (!BASH_OK) {
  // 스킵하지 않는다 — 파이프라인 자체가 bash 로 도므로, 여기서 못 돌면 배선을 검증한 적이 없는 것이다.
  fail++; console.log('  FAIL bash 없음 — run_pipeline_s1only.sh 배선 테스트를 돌릴 수 없다');
} else {
  const sb = sandbox();
  // 일부러 프로젝트 루트가 아닌 폴더에서 띄운다 — 세션 드라이버·Loki·수동 실행은 아무 폴더에서나 돈다
  const caller = tmp();
  const env = { ...process.env, TCTEAM_PROJECT_ROOT: fwd(sb.root), TCTEAM_NODE: NODE,
    TCTEAM_HANDOFF_GATE: fwd(path.join(sb.root, 'no_handoff_gate.py')) };   // 인수게이트는 볼 대상이 아니다(없으면 건너뜀)
  const r = spawnSync('bash', [fwd(S1), '--feature', sb.feat, '--sheet-id', 'TEST'], { encoding: 'utf8', env, cwd: caller });
  const out = (r.stdout || '') + (r.stderr || '');
  const chainLog = () => { try { return fs.readFileSync(path.join(sb.spec, 'chain.log'), 'utf8'); } catch { return ''; } };
  const cwdFile = path.join(sb.spec, 'dxr_crossref.json.cwd');

  t('스텁 체인이 S1 끝까지 완주한다 (exit 0 · 대조 에이전트 호출됨)', () => {
    assert.strictEqual(r.status, 0, (out + chainLog()).slice(-1500));
    assert.ok(fs.existsSync(cwdFile), '대조 에이전트가 호출되지 않았다\n' + chainLog().slice(-1500));
  });

  t('대조 에이전트는 호출 폴더가 아니라 프로젝트 루트에서 돈다 (다른 폴더면 KB 가 비어 전량 keep)', () => {
    assert.ok(!same(caller, sb.root), '대조군 붕괴 — 호출 폴더가 프로젝트 루트와 같다');
    const cwd = fs.readFileSync(cwdFile, 'utf8');
    assert.ok(same(cwd, sb.root), `에이전트 작업 폴더 = ${cwd} (기대: ${fwd(sb.root)})`);
  });

  t('작업 폴더를 옮겨도 산출은 원래 자리에서 소비된다 (STEP 2-대조 완료 줄에 스텁 집계)', () => {
    assert.ok(/\[STEP 2-대조\] 완료 — apply=0 locate=0 discover=0 keep=1/.test(chainLog()), chainLog().slice(-1500));
  });
}

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
