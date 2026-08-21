'use strict';
// tc-v3 전체 테스트 러너 — 결정론 유틸 유닛 + Phase 0 통합 스파이크
const { spawnSync } = require('child_process');
const path = require('path');

const suites = [
  'apply_fix_plan.test.js',
  'slicer.test.js',
  'content_gate.test.js',
  'utils_batch.test.js',
  'sheet_write.test.js',
  'snapshot_local.test.js',
  'regroup.test.js',
  'traceability.test.js',
  'dup_gate.test.js',
  'origin_gate.test.js',
  'item_dict.test.js',
  'item_cite_gate.test.js',
  'ab_compare.test.js',
  'eval_digest.test.js',
  'confidence.test.js',
  'convert_gate.test.js',
  'phase0_spike.js',
];
let allPass = true;
const summary = [];
for (const s of suites) {
  const r = spawnSync(process.execPath, [path.join(__dirname, s)], { encoding: 'utf8' });
  const ok = r.status === 0;
  allPass = allPass && ok;
  const m = (r.stdout || '').match(/결과: (\d+) PASS \/ (\d+) FAIL|결과: (\d+) 통과 \/ (\d+) 실패/);
  summary.push({ suite: s, ok, line: m ? m[0] : (ok ? 'OK' : 'FAIL'), status: r.status });
  if (!ok) { process.stdout.write(`\n─── ${s} 상세 ───\n` + (r.stdout || '') + (r.stderr || '')); }
}
console.log('\n════════ tc-v3 테스트 종합 ════════');
for (const s of summary) console.log(`  ${s.ok ? 'GREEN' : 'RED  '}  ${s.suite.padEnd(26)} ${s.line}`);
console.log('═══════════════════════════════════');
console.log(allPass ? 'ALL GREEN — 결정론 코어 QA 통과' : 'RED — 실패 스위트 있음');
process.exit(allPass ? 0 : 1);
