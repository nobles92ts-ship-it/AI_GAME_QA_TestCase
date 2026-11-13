'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const TC = path.join(__dirname, '..');
const HELPERS = path.join(TC, 'scripts', 'chain_helpers.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-readback-id-width-'));

function rows(count) {
  const finalRows = [], sheetRows = [];
  for (let n = 1; n <= count; n++) {
    const id = String(n).padStart(3, '0');
    const f = [id, '대분류', '중분류', '소분류', '정상', `TC ${id} 재현`, 'PC/모바일', '미진행', '미진행', '비고'];
    const s = [id, '대분류', '중분류', '소분류', '정상', `TC ${id} 재현`, 'PC/모바일', '', '', '', '비고'];
    finalRows.push(f);
    sheetRows.push(s);
  }
  return { finalRows, sheetRows };
}

function run(finalRows, sheetRows, suffix) {
  const finalPath = path.join(tmp, `final-${suffix}.json`);
  const dumpPath = path.join(tmp, `dump-${suffix}.json`);
  fs.writeFileSync(finalPath, JSON.stringify({ rows: finalRows }));
  fs.writeFileSync(dumpPath, JSON.stringify({ rows: sheetRows }));
  return spawnSync(process.execPath, [HELPERS, 'readback-diff', finalPath, dumpPath], { encoding: 'utf8' });
}

try {
  const full = rows(1730);
  const good = run(full.finalRows, full.sheetRows, 'full');
  assert.strictEqual(good.status, 0, good.stdout + good.stderr);
  assert.match(good.stdout, /0-diff ok \(1730행\)/);
  assert.deepStrictEqual([full.finalRows[998][0], full.finalRows[999][0], full.finalRows[1729][0]], ['999', '1000', '1730']);

  const damaged = rows(1730);
  damaged.sheetRows[999][0] = '1000x';
  const bad = run(damaged.finalRows, damaged.sheetRows, 'bad-id');
  assert.notStrictEqual(bad.status, 0, bad.stdout + bad.stderr);
  assert.match(bad.stdout, /시트에 없는 tc_id: 1000/);

  const small = rows(999);
  const legacy = run(small.finalRows, small.sheetRows, 'small');
  assert.strictEqual(legacy.status, 0, legacy.stdout + legacy.stderr);
  assert.match(legacy.stdout, /0-diff ok \(999행\)/);

  console.log('PASS readback-diff preserves 3-digit IDs and accepts IDs 1000..1730');
  console.log('PASS missing/corrupt 4-digit ID remains a readback failure');
  console.log('PASS 999-row readback remains 0-diff');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
