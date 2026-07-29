'use strict';
// eval_digest ↔ S4 렌즈 동기화 가드 — 이관감사 R2-③(digest 드리프트 감지 장치 부재) 해소.
// digest는 tc-리뷰.md(SSoT) 발췌본: 이 테스트가 "digest 14종 실재 + 렌즈 참조 배선"을 기계 보증한다.
// SSoT에서 EVAL을 추가/폐지하면 이 테스트와 digest를 함께 갱신할 것.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  PASS ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' — ' + e.message); } }

const digest = fs.readFileSync(path.join(__dirname, '..', 'docs', 'eval_digest.md'), 'utf8');
const wf = fs.readFileSync(path.join(__dirname, '..', 'workflows', 'tcteam-s4-review.js'), 'utf8');

// digest가 소유해야 하는 14종 (01·05·06·08·09=결정론 코드 소유 — traceability/재번호/regroup/골격=direct_convert(scripts/util)/content_gate, 07=structure 렌즈+judge delete 소유)
const DIGEST_EVALS = ['EVAL-02', 'EVAL-03', 'EVAL-04', 'EVAL-10', 'EVAL-11', 'EVAL-12', 'EVAL-13',
  'EVAL-14', 'EVAL-15', 'EVAL-16', 'EVAL-17', 'EVAL-18', 'EVAL-19', 'EVAL-20'];

t('digest에 EVAL 14종 전부 존재', () => {
  for (const id of DIGEST_EVALS) assert.ok(digest.includes(id), id + ' 누락');
});

t('digest 렌즈 섹션 4종([공통]/[structure]/[quality]/[crossref]) 존재', () => {
  for (const s of ['[공통]', '[structure]', '[quality]', '[crossref]']) assert.ok(digest.includes(s), s + ' 섹션 누락');
});

t('추후구현 정책(M-021)·취소선(EVAL-11)·배분(EVAL-02) 명시', () => {
  assert.ok(digest.includes('추후구현 정책'), '추후구현 정책');
  assert.ok(digest.includes('취소선'), '취소선');
  assert.ok(/HIGH≥60%/.test(digest) && /49%/.test(digest), '비율 하한');
});

t('S4 3렌즈가 전부 digest를 참조', () => {
  assert.ok((wf.match(/eval_digest\.md/g) || []).length >= 3, '렌즈 digest 참조 3회 미만');
});

t('렌즈 id 열거 ↔ digest 섹션 정합(대표 항목)', () => {
  assert.ok(wf.includes('EVAL-19·16·14·04·17·02'), 'structure 열거');
  assert.ok(wf.includes('EVAL-03 예외6종·15'), 'quality 열거');
  assert.ok(wf.includes('11 취소선'), 'crossref 열거');
});

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
