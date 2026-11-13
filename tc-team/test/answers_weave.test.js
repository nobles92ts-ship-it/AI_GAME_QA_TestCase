'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const w = require('../lib/answers_weave');
const { BEGIN, END } = require('../lib/answers_merge');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; } catch (e) { fail++; console.error('FAIL ' + name + ': ' + e.stack); } }

const DOC = ['# 분석', '### A-1. 개요', '요약', '### A-2. 기능 정의 — 원문 보존', '| Recover_Max | N (미지정) | 원문 |', '### A-3. 이미지',
  '### A-5. 키 목록', '| Recover_Max | N (미지정) | 개 |', '### C-1. 미지정값 재확인 체크리스트', '- [ ] Recover_Max 최대 개수 미지정',
  '- [ ] 공통 문구', '- [ ] 공통 문구', '### C-2. 분석자 코멘트', '- 기존 코멘트', '', BEGIN, '| Recover_Max | N (미지정) | 개 |', END, ''].join('\n');
function spec() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'weave-'));
  fs.writeFileSync(path.join(d, 'analysis.md'), DOC.replace(/\n/g, '\r\n'));   // 실물처럼 CRLF 도 받는다
  return d;
}
const REF = '사망_v2 패널 5번';
const R = d => fs.readFileSync(path.join(d, 'analysis.md'), 'utf8');

t('원문 보존(A-2)·Part D 밖에서 한 번만 나오는 글만 고친다', () => {
  const d = spec();
  const r = w.apply(d, { ops: [{ ref: REF, old: '| Recover_Max | N (미지정) | 개 |', new: '| Recover_Max | 20 (기획답변: 사망_v2 패널 5번) | 개 |' }] });
  assert.strictEqual(r.applied.length, 1, JSON.stringify(r.rejected));
  const a = R(d);
  assert.ok(a.includes('| Recover_Max | 20 (기획답변:'));
  assert.ok(a.includes('| Recover_Max | N (미지정) | 원문 |'), '원문 보존 구역이 바뀌었다');
  assert.ok(a.slice(a.indexOf(BEGIN)).includes('| Recover_Max | N (미지정) | 개 |'), 'Part D 가 바뀌었다');
});
t('버리는 경우 — 출처 없음 · 본문에 없음 · 여러 곳 · 원문 구역 · 같은 글 두 번', () => {
  const d = spec();
  const r = w.apply(d, { ops: [
    { ref: REF, old: '- [ ] Recover_Max 최대 개수 미지정', new: '- [x] 20' },
    { ref: REF, old: '없는 줄', new: 'x 기획답변: a' },
    { ref: REF, old: '- [ ] 공통 문구', new: '- [x] 공통 (기획답변: a)' },
    { ref: REF, old: '| N (미지정) | 원문 |', new: '| 20 | 원문 | (기획답변: a)' },
    { ref: REF, old: '요약', new: '요약 (기획답변: a)' },
    { ref: REF, old: '요약', new: '요약2 (기획답변: a)' },
  ] });
  assert.deepStrictEqual(r.rejected.map(x => x.why), ['출처(기획답변:) 없음', '본문에 없음', '여러 곳(2)', '원문 보존·Part D 구역', '같은 글을 두 번 고침']);
  assert.strictEqual(r.applied.length, 1);
});
t('메모는 C-2 절 끝에 붙고, 두 번 붙지 않는다 · 원장에 ref 가 쌓인다', () => {
  const d = spec();
  const p = { ops: [{ ref: REF, note: '원문은 N 인데 답은 20 — 원문 기준' }], no_change: ['사망_v2 패널 9번'] };
  w.apply(d, p);
  w.apply(d, p);
  const a = R(d);
  assert.strictEqual(a.split('원문은 N 인데 답은 20').length, 2);
  assert.ok(a.indexOf('원문은 N 인데') > a.indexOf('### C-2.') && a.indexOf('원문은 N 인데') < a.indexOf(BEGIN));
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(d, '.answers_woven.json'), 'utf8')).refs, ['사망_v2 패널 5번', '사망_v2 패널 9번']);
});
t('--check 는 쓰지 않는다', () => {
  const d = spec(); const before = R(d);
  const r = w.apply(d, { ops: [{ ref: REF, old: '요약', new: '요약 (기획답변: a)' }] }, { check: true });
  assert.strictEqual(r.applied.length, 1);
  assert.strictEqual(R(d), before);
  assert.ok(!fs.existsSync(path.join(d, '.answers_woven.json')));
});
const PARTD = (a5) => [BEGIN, '## Part D', '', '### 판 `사망_v2` — 2건', '', '#### D-1. 확정 — 패널 5번 (T3, 2026-11-02 11:15)',
  '**답**', `> ${a5}`, '', '#### D-2. 확정 — 패널 9번 (T4, 2026-11-02 11:15)', '**답**', '> 그대로', END, ''].join('\n');
function specD(a5 = '20개') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'weavep-'));
  const d = path.join(root, '사망_v2'); fs.mkdirSync(d);
  fs.writeFileSync(path.join(d, 'analysis.md'), DOC.slice(0, DOC.indexOf(BEGIN)) + PARTD(a5));
  return { root, d };
}
t('partD — ref 는 `<판> 패널 N번`, 답이 바뀌면 지문이 바뀐다', () => {
  const a = w.partD(PARTD('20개')), b = w.partD(PARTD('30개'));
  assert.deepStrictEqual(a.map(x => x.ref), ['사망_v2 패널 5번', '사망_v2 패널 9번']);
  assert.notStrictEqual(a[0].hash, b[0].hash);
  assert.strictEqual(a[1].hash, b[1].hash);
});
t('pending — 안 녹인 답 → 녹이면 빠짐 → 답이 바뀌면 그 답만 다시', () => {
  const { root, d } = specD();
  assert.deepStrictEqual(w.pending(root), [{ spec: '사망_v2', refs: ['사망_v2 패널 5번', '사망_v2 패널 9번'] }]);
  w.apply(d, { ops: [{ ref: REF, old: '- [ ] Recover_Max 최대 개수 미지정', new: '- [x] 20 (기획답변: 사망_v2 패널 5번)' }], no_change: ['사망_v2 패널 9번'] });
  assert.deepStrictEqual(w.pending(root), []);
  fs.writeFileSync(path.join(d, 'analysis.md'), R(d).replace('> 20개', '> 30개'));
  assert.deepStrictEqual(w.pending(root), [{ spec: '사망_v2', refs: ['사망_v2 패널 5번'] }]);
});
t('pending — 고칠 것이 no_change 뿐이어도 장부에 남는다(매번 다시 부르지 않게)', () => {
  const { root, d } = specD();
  w.apply(d, { ops: [], no_change: ['사망_v2 패널 5번', '사망_v2 패널 9번'] });
  assert.deepStrictEqual(w.pending(root), []);
});
t('pending --baseline — 지문 없는 옛 장부는 녹인 것으로 보고 지문을 채운다', () => {
  const { root, d } = specD();
  fs.writeFileSync(path.join(d, '.answers_woven.json'), JSON.stringify({ refs: ['사망_v2 패널 5번', '사망_v2 패널 9번'] }));
  assert.deepStrictEqual(w.pending(root, { baseline: true }), []);
  assert.strictEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(d, '.answers_woven.json'), 'utf8')).hashes).length, 2);
  fs.writeFileSync(path.join(d, 'analysis.md'), R(d).replace('> 20개', '> 30개'));
  assert.deepStrictEqual(w.pending(root), [{ spec: '사망_v2', refs: ['사망_v2 패널 5번'] }]);
});
console.log(`결과: ${pass} PASS / ${fail} FAIL`); process.exit(fail ? 1 : 0);
