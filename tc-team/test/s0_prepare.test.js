'use strict';
// s0_prepare — Codex 경로 S0(claude 없이): 기능명 규칙 · _vN · 입력 사전검사 (2026-10-01 Loki Codex 이식)
// 네트워크 0 — 순수 함수와 --preflight 만 본다(라이브 Confluence·시트는 _no_sync 실측 기록 참조).
const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const S0 = path.join(__dirname, '..', 'scripts', 's0_prepare.py');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  PASS ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' — ' + e.message); } }
const py = (code) => spawnSync('python', ['-c', code], {
  encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } });
const call = (expr) => {
  const r = py(`import sys,json;sys.path.insert(0,${JSON.stringify(path.dirname(S0))});import s0_prepare as s;print(json.dumps(${expr},ensure_ascii=False))`);
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout.trim());
};

console.log('s0_prepare 테스트 (Codex 경로 S0)');

t('제목 → 스네이크케이스 (Claude S0 규칙과 같은 예)', () => {
  assert.strictEqual(call("s.feature_name('인벤토리 1차 개선')"), '인벤토리_1차_개선');
  assert.strictEqual(call("s.feature_name('  A/B: 테스트 [초안] ')"), 'A_B_테스트_초안');
});

t('탭이 있으면 _v2, _v2 도 있으면 _v3', () => {
  assert.strictEqual(call("s.pick_versioned('X', ['Y'])"), 'X');
  assert.strictEqual(call("s.pick_versioned('X', ['X'])"), 'X_v2');
  assert.strictEqual(call("s.pick_versioned('X', ['X', 'X_v2'])"), 'X_v3');
});

t('--preflight: 올바른 URL 은 ok, 깨진 URL 은 실패', () => {
  const env = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
  const ok = spawnSync('python', [S0, '--preflight', '--sheet-url', 'https://docs.google.com/spreadsheets/d/abcDEF_123/edit',
    '--conf-url', 'https://x.atlassian.net/wiki/spaces/DX/pages/123456/T'], { encoding: 'utf8', env });
  assert.strictEqual(ok.status, 0, ok.stdout + ok.stderr);
  const bad = spawnSync('python', [S0, '--preflight', '--sheet-url', 'nope', '--conf-url', 'nope'], { encoding: 'utf8', env });
  assert.strictEqual(bad.status, 1);
  assert.ok(JSON.parse(bad.stdout).problems.length >= 2);
});

t('S0 스크립트 안에 claude 호출이 없다', () => {
  const src = require('fs').readFileSync(S0, 'utf8');
  // 실행 인자로 쓰인 claude(따옴표 안 명령 이름)만 본다 — 설명 주석은 허용
  assert.ok(!/["']claude(\.cmd|\.exe)?["']/i.test(src), 'claude 실행 인자 발견');
  for (const lib of ['confluence_fetch.py', 'list_tabs.js']) {
    const s = require('fs').readFileSync(path.join(__dirname, '..', 'lib', lib), 'utf8');
    assert.ok(!/["']claude(\.cmd|\.exe)?["']/i.test(s), lib);
  }
});

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
