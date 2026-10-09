'use strict';
// confidence_local — 시트 없이 확신도. 산식은 tc-team confidence_core 그대로 쓰고(사본 0),
// 시트 격자 대신 최종본 행을 넣는다. 매핑이 깨지면 조용히 넘기지 않고 실패를 돌려준다.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { computeLocal } = require('../lib/confidence_local');
const copyFlat = require('./copy_fixture');

const FIX = path.join(__dirname, 'fixtures', 'sample_run');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  PASS ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' — ' + e.message); } }
const copyFix = (tag) => copyFlat(FIX, fs.mkdtempSync(path.join(os.tmpdir(), `aiconf-${tag}-`)));

t('QA 행 전부 점수가 붙는다 (드리프트 0)', () => {
  const r = computeLocal(FIX);
  assert.ok(r.ok, r.msg);
  assert.strictEqual(r.data.items.length, 8);   // 기본기능 2행은 대상 아님 — 사람용과 같다
  assert.strictEqual(r.data.drift.length, 0);
  const dist = Object.values(r.data.summary.dist).reduce((a, b) => a + b, 0);
  assert.strictEqual(dist, 8);
});
t('기획 확인 행(R1)은 점수가 더 낮다', () => {
  const by = new Map(computeLocal(FIX).data.items.map((i) => [i.tcid, i]));
  assert.ok(by.get('005').score < by.get('006').score, `005=${by.get('005').score} 006=${by.get('006').score}`);
});
t('설계와 최종본이 어긋나면 실패(drift)', () => {
  const d = copyFix('drift');
  const f = path.join(d, 'tcteam_tc_final.json');
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  j.rows.forEach((r) => { if (r[1] !== '기본기능') r[3] = '없는 화면'; });
  fs.writeFileSync(f, JSON.stringify(j));
  const r = computeLocal(d);
  assert.ok(!r.ok); assert.strictEqual(r.code, 'drift');
});
t('설계서가 없으면 실패(no_items)', () => {
  const d = copyFix('nodesign');
  fs.rmSync(path.join(d, 'tc_design.md'));
  const r = computeLocal(d);
  assert.ok(!r.ok);
});

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
