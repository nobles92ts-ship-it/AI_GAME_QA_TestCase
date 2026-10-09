'use strict';
// tc-team-ai 테스트 종합 — tc-team/test/run_all.js 와 같은 모양. 스위트는 각자 「결과: N PASS / M FAIL」을 찍고 실패면 exit 1.
const { spawnSync } = require('child_process');
const path = require('path');

const suites = [
  'rewrite_gate.test.js',
  'rewrite_stage.test.js',
  'confidence_local.test.js',
  'md_export.test.js',
  'engine_nosheet.test.js',
  'run_ai.test.js',
];
let allPass = true;
const summary = [];
for (const s of suites) {
  const r = spawnSync(process.execPath, [path.join(__dirname, s)], { encoding: 'utf8' });
  const ok = r.status === 0;
  allPass = allPass && ok;
  const m = (r.stdout || '').match(/결과: (\d+) PASS \/ (\d+) FAIL/);
  summary.push({ suite: s, ok, line: m ? m[0] : (ok ? 'OK' : `FAIL (rc=${r.status})`) });
  if (!ok) process.stdout.write(`\n─── ${s} 상세 ───\n` + (r.stdout || '') + (r.stderr || ''));
}
console.log('\n════════ tc-team-ai 테스트 종합 ════════');
for (const s of summary) console.log(`  ${s.ok ? 'GREEN' : 'RED  '}  ${s.suite.padEnd(26)} ${s.line}`);
console.log('════════════════════════════════════════');
console.log(allPass ? 'ALL GREEN' : 'RED — 실패 스위트 있음');
process.exit(allPass ? 0 : 1);
