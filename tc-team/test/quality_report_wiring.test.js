'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { generate } = require('../lib/quality_report');
const root = path.resolve(__dirname, '..');
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; } catch (e) { fail++; console.error('FAIL ' + name + ': ' + e.stack); } }
function withFixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-quality-wire-'));
  try {
    const feature = '인증 fixture', spec = path.join(dir, 'team/specs', feature), lib = path.join(dir, 'tc-team/lib'), util = path.join(dir, 'scripts/util');
    for (const p of [spec, lib, util]) fs.mkdirSync(p, { recursive: true });
    for (const n of ['quality_report.js', 'execution_metadata.js', 'traceability.js']) fs.copyFileSync(path.join(root, 'lib', n), path.join(lib, n));
    const write = (n, value) => fs.writeFileSync(path.join(spec, n), typeof value === 'string' ? value : JSON.stringify(value));
    write('analysis.md', '기존 분석'); write('tc_design.md', '기존 설계'); write('confluence_raw.md', '원문 규칙');
    write('tcteam_tc_final.json', { rows: [['001', '대', '중', '소', '정상', '원문 규칙 확인', 'PC', '미진행', 'N/A', '']] });
    write('slices.json', { rules: [{ rule_id: 'R1', sec_id: 'S1', text: '원문 규칙' }] });
    write('coverage.json', [{ rule_id: 'R1', tc_ids: ['001'] }]); write('exclusions.json', []);
    const log = path.join(dir, 'uploads.jsonl');
    fs.writeFileSync(path.join(util, 'upload_md_to_drive.js'), "require('fs').appendFileSync(process.env.QUALITY_UPLOAD_LOG,JSON.stringify(process.argv.slice(2))+'\\n');");
    const env = { ...process.env, TCTEAM_PROJECT_ROOT: dir.replace(/\\/g, '/'), TCTEAM_NODE: process.execPath.replace(/\\/g, '/'), QUALITY_UPLOAD_LOG: log };
    const run = () => spawnSync(bash, [path.join(root, 'scripts/finalize.sh').replace(/\\/g, '/'), '--feature', feature, '--sheet-id', 'FIXTURE', '--only', '3'], { env, encoding: 'utf8', timeout: 20000 });
    const uploads = () => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse) : [];
    fn({ spec, write, run, uploads });
  } finally {
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
t('S5 report is before no-sheet exit', () => {
  const s = fs.readFileSync(path.join(root, 'scripts/run_pipeline_full.sh'), 'utf8');
  const report = s.indexOf('"$LIB/quality_report.js"'); const noSheet = s.indexOf('if [[ $NO_SHEET -eq 1 ]]', report);
  assert(report > 0 && noSheet > report);
});
t('FINAL3 uploads fresh report and preserves canonical TC bytes', () => withFixture(f => {
  const before = fs.readFileSync(path.join(f.spec, 'tcteam_tc_final.json'), 'hex'); const r = f.run();
  assert.equal(r.status, 0, r.stdout + r.stderr); assert(f.uploads()[0].some(x => x.endsWith('quality_report.md')));
  assert.equal(fs.readFileSync(path.join(f.spec, 'tcteam_tc_final.json'), 'hex'), before);
  assert(fs.existsSync(path.join(f.spec, '.quality_report_uploaded.sha256')));
}));
t('legacy upload marker sends only the new quality report', () => withFixture(f => {
  f.write('.drive_uploaded', 'previous'); assert.equal(f.run().status, 0);
  const paths = f.uploads()[0].slice(2); assert.equal(paths.length, 1); assert(paths[0].endsWith('quality_report.md'));
}));
t('unchanged report is not uploaded twice', () => withFixture(f => {
  assert.equal(f.run().status, 0); assert.equal(f.run().status, 0); assert.equal(f.uploads().length, 1);
}));
t('changed report refreshes only its upload', () => withFixture(f => {
  assert.equal(f.run().status, 0); f.write('_labels.json', { 기획확인: ['[규칙 없음] 제한 횟수는?'] });
  assert.equal(f.run().status, 0); assert.equal(f.uploads().length, 2); assert.equal(f.uploads()[1].slice(2).length, 1);
}));
t('bad input creates alert and partial exit, without uploading stale report', () => withFixture(f => {
  assert.equal(f.run().status, 0); f.write('coverage.json', '{bad}'); const r = f.run();
  assert.equal(r.status, 20, r.stdout + r.stderr); assert.equal(f.uploads().length, 1); assert(fs.existsSync(path.join(f.spec, '.quality_report_alert.txt')));
}));
t('final text report includes actual metric definitions and paths', () => withFixture(f => {
  generate(f.spec); const r = spawnSync(process.execPath, [path.join(root, 'scripts/chain_helpers.js'), 'final-report', f.spec, f.spec, '인증'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); const s = fs.readFileSync(path.join(f.spec, 'final_report.txt'), 'utf8');
  assert(s.includes('TC 직접 연결 100.00%')); assert(s.includes('quality_report.html')); assert(s.includes('제품 테스트 실행 결과와 별개'));
}));
t('metadata contract is loaded in shared designer and reviewer rules', () => {
  const rules = path.join(process.env.TCTEAM_RULES_DIR || path.join(__dirname, '..', '..', 'skills', 'tc-team', 'rules'));
  if (!fs.existsSync(rules)) return;
  assert(fs.readFileSync(path.join(rules, 'tc-설계.md'), 'utf8').includes('실행 계획 메타데이터'));
  assert(fs.readFileSync(path.join(rules, 'tc-설계검수.md'), 'utf8').includes('C-17'));
});
console.log(`결과: ${pass} PASS / ${fail} FAIL`); process.exit(fail ? 1 : 0);
