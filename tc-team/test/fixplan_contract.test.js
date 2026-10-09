'use strict';
// S4 판정자의 J열은 설명문이 아닌 content_gate 상태 플래그여야 한다.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const helper = path.join(__dirname, '..', 'scripts', 'chain_helpers.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fixplan-contract-'));
let pass = 0;

function validate(patches) {
  const file = path.join(dir, 'plan.json');
  fs.writeFileSync(file, JSON.stringify({ rationale: '', patches }), 'utf8');
  return spawnSync(process.execPath, [helper, 'validate-json', file, 'fixplan'],
                   { encoding: 'utf8' });
}

function check(name, patches, expected) {
  const r = validate(patches);
  assert.strictEqual(r.status === 0, expected, `${name}: ${r.stdout} ${r.stderr}`);
  pass++;
}

try {
  check('J exact enum', [{ op: 'edit_cell', col: 'J', tc_id: '019',
                           after: '기획 확인 필요', reason: '근거 없음' }], true);
  check('J prose rejected', [{ op: 'edit_cell', col: 'J', tc_id: '019',
                               after: '이 규칙은 기획 확인이 필요하다.', reason: '근거 없음' }], false);
  check('add_row J prose rejected', [{ op: 'add_row', after_tc_id: '019',
                                       row: { j: '기획 확인이 필요하다.' }, reason: '근거 없음' }], false);
  check('DXBUG id accepted', [{ op: 'edit_cell', col: 'J', tc_id: '019',
                                after: 'DXBUG-123', reason: '기등록 버그' }], true);
  console.log(`결과: ${pass} PASS / 0 FAIL`);
} finally {
  fs.rmSync(path.join(dir, 'plan.json'), { force: true });
  fs.rmdirSync(dir);
}
