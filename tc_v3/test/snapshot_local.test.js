'use strict';
const assert = require('assert');
const fs = require('fs');
const { buildSnapshot } = require('../lib/snapshot_local.js');
const { to7col } = require('../lib/sheet_write.js');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  PASS ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' — ' + e.message); } }

console.log('snapshot_local.js 테스트');

t('7열 → 10열 조립: A 순번·H/I 파생', () => {
  const data7 = [['기본기능', '진입', '버튼', '정상', 'F문장', 'PC', ''], ['QA', '타겟', '우선순위', '정상', 'F2', 'PC/모바일', '']];
  const s = buildSnapshot(data7, 'T');
  assert.strictEqual(s.rows.length, 2);
  assert.strictEqual(s.rows[0][0], '001');
  assert.strictEqual(s.rows[1][0], '002');
  assert.strictEqual(s.rows[0][1], '기본기능');
  assert.strictEqual(s.rows[0][5], 'F문장'); // F열
  assert.strictEqual(s.rows[0][6], 'PC');    // G열
  // 기본기능+PC → I=N/A (tc-생성.md:179)
  assert.strictEqual(s.rows[0][8], 'N/A');
});

// round-trip equivalence on a local snapshot: 10-col → 7-col projection → rebuild = original (skips without fixture)
t('integration: snapshot round-trip equivalence (skips without fixture)', () => {
  const p = './fixtures/sample_feature/tc_snapshot.json';
  if (!fs.existsSync(p)) { console.log('    (skip — no fixture)'); return; }
  const orig = JSON.parse(fs.readFileSync(p, 'utf8'));
  const rebuilt = buildSnapshot(to7col(orig.rows), orig.sheetName);
  assert.strictEqual(rebuilt.rows.length, orig.rows.length, '행수 동일');
  let hiMismatch = 0, otherMismatch = 0;
  for (let i = 0; i < orig.rows.length; i++) {
    const o = orig.rows[i], r = rebuilt.rows[i];
    // A,B,C,D,E,F,G,J는 투영·재조립으로 보존돼야
    for (const c of [0, 1, 2, 3, 4, 5, 6, 9]) if ((o[c] || '') !== (r[c] || '')) otherMismatch++;
    // H,I는 expectedHI 재파생 — 원본과 일치해야(동일 함수)
    if ((o[7] || '') !== (r[7] || '') || (o[8] || '') !== (r[8] || '')) hiMismatch++;
  }
  console.log(`    ${orig.rows.length}행 · 골격열 불일치 ${otherMismatch} · H/I 불일치 ${hiMismatch}`);
  assert.strictEqual(otherMismatch, 0, '골격열(A~G,J) 왕복 보존');
  assert.strictEqual(hiMismatch, 0, 'H/I 재파생이 원본과 일치(expectedHI 동등)');
});

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
