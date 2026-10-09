'use strict';
// rewrite_gate — AI 다시 쓰기(전제·조작·기대·관측)의 원문 보존 게이트.
// 게이트는 «통과시킨 것»이 아니라 «잡은 것»으로 믿는다: 일부러 망가뜨린 표본을 종류마다 하나씩 물리고,
// 충실한 표본은 통과하는지(오탐 0) 같이 본다.
const assert = require('assert');
const { anchorsOf, checkRewrite, checkChunk } = require('../lib/rewrite_gate');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  PASS ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' — ' + e.message); } }

// 표본 문장은 합성이다(가상의 우편 기능) — 공개 배포본에 실리므로 실제 기획서 문장을 쓰지 않는다.
const NEG = '받는 사람 ID 가 빈 우편, 첨부가 0개인 유료 우편, 제목이 빈 우편을 각각 보냈을 때 매번 「발송 완료」 문구가 뜨지 않는지 확인';
const NEG_OK = {
  전제: [],
  조작: ['받는 사람 ID 가 빈 우편을 보낸다', '첨부가 0개인 유료 우편을 보낸다', '제목이 빈 우편을 보낸다'],
  기대: ['매번 「발송 완료」 문구가 뜨지 않는다'],
  관측: ['발송 결과 문구'],
};
const CH = 'A서버 캐릭터가 우편을 보내도 B서버 캐릭터 우편함에는 그 우편이 도착하지 않는지 확인';
const CH_OK = {
  전제: ['A서버와 B서버에 캐릭터가 하나씩 있다'],
  조작: ['A서버 캐릭터로 우편을 보낸다'],
  기대: ['B서버 캐릭터 우편함에는 그 우편이 도착하지 않는다'],
  관측: ['B서버 캐릭터 우편함 목록'],
};
const Q = '받는 사람이 아직 열지 않은 우편은 보낸 우편함에서 읽음 표시가 물음표(?)로 표시되는지 확인';
const Q_OK = {
  전제: ['받는 사람이 아직 열지 않은 우편이 있다'],
  조작: ['보낸 우편함을 연다'],
  기대: ['그 우편의 읽음 표시가 물음표(?)로 표시된다'],
  관측: ['보낸 우편함의 읽음 표시'],
};
const reasonsOf = (orig, rw) => checkRewrite(orig, rw).reasons.join(' | ');
const with_ = (rw, k, v) => ({ ...rw, [k]: v });

// ── 닻 추출 ─────────────────────────────────────────────────────────────
t('닻: 숫자·영문·기호·부정 극성', () => {
  const a = anchorsOf(NEG);
  assert.deepStrictEqual(a.numbers, ['0']);
  assert.deepStrictEqual(a.idents, ['ID']);
  assert.strictEqual(a.polarity, 'neg');
  assert.deepStrictEqual(anchorsOf(Q).marks, ['?']);
  assert.strictEqual(anchorsOf(Q).polarity, 'pos');
  assert.deepStrictEqual(anchorsOf('배너 문구가 「신규 우편 3건」으로 출력되는지 확인').marks, ['신규 우편 3건']);
});
t('닻: 「~지 확인」으로 안 끝나면 극성 판정 없음(null)', () => {
  assert.strictEqual(anchorsOf('보상 지급 결과를 기록한다').polarity, null);
});

// ── 음성 표본: 충실한 다시 쓰기는 통과 ──────────────────────────────────
t('충실한 표본 3종 통과 (오탐 0)', () => {
  for (const [o, rw] of [[NEG, NEG_OK], [CH, CH_OK], [Q, Q_OK]]) {
    const r = checkRewrite(o, rw);
    assert.ok(r.ok, `오탐: ${r.reasons.join(', ')}`);
  }
});
t('항목 머리 번호(1) · -)는 숫자 추가로 세지 않는다', () => {
  const rw = with_(NEG_OK, '조작', ['1) 받는 사람 ID 가 빈 우편을 보낸다', '2. 첨부가 0개인 유료 우편을 보낸다', '- 제목이 빈 우편을 보낸다']);
  assert.ok(checkRewrite(NEG, rw).ok, reasonsOf(NEG, rw));
});
t('전제는 비어도 된다', () => {
  assert.ok(checkRewrite(CH, with_(CH_OK, '전제', [])).ok);
});

// ── 양성 표본: 종류마다 하나씩 반드시 걸린다 ─────────────────────────────
t('숫자 누락 → number_missing', () => {
  const rw = with_(NEG_OK, '조작', ['받는 사람 ID 가 빈 우편을 보낸다', '첨부가 없는 유료 우편을 보낸다', '제목이 빈 우편을 보낸다']);
  assert.match(reasonsOf(NEG, rw), /number_missing:0/);
});
t('숫자 추가 → number_added', () => {
  const rw = with_(CH_OK, '조작', ['A서버 캐릭터로 우편을 3회 보낸다']);
  assert.match(reasonsOf(CH, rw), /number_added:3/);
});
t('영문 이름 누락 → ident_missing', () => {
  // 닻은 «글 어딘가에 남아 있나»로 본다 — 전제에 A 가 남으면 조작에서 빠져도 못 잡는다(한계, 원문이 정본인 이유)
  const rw = { ...CH_OK, 전제: ['두 서버에 캐릭터가 하나씩 있다'], 조작: ['한 서버 캐릭터로 우편을 보낸다'] };
  assert.match(reasonsOf(CH, rw), /ident_missing:A/);
});
t('기호 누락 → mark_missing', () => {
  const rw = with_(Q_OK, '기대', ['그 우편의 읽음 표시가 물음표로 표시된다']);
  assert.match(reasonsOf(Q, rw), /mark_missing:\?/);
});
t('따옴표 문구 변형 → mark_missing', () => {
  const o = '새 우편이 3건 있는 상태에서 우편함을 열면 배너 문구가 「신규 우편 3건」으로 출력되는지 확인';
  const rw = { 전제: ['새 우편이 3건 있다'], 조작: ['우편함을 연다'], 기대: ['배너 문구가 「새 우편 3건」으로 출력된다'], 관측: ['배너 문구'] };
  assert.match(reasonsOf(o, rw), /mark_missing:신규 우편 3건/);
});
t('부정 소실(않는지 → 긍정 기대) → polarity_lost', () => {
  const rw = with_(CH_OK, '기대', ['B서버 캐릭터 우편함에도 그 우편이 도착한다']);
  assert.match(reasonsOf(CH, rw), /polarity_lost/);
});
t('조건 탈락(서버 이전 조건 삭제) → coverage', () => {
  const o = '우편을 보낸 뒤 받는 사람이 다른 서버로 이전하면 그 우편의 처리 결과가 기획에서 확정한 규칙과 일치하는지 확인';
  const rw = { 전제: [], 조작: ['우편을 보낸다'], 기대: ['우편이 보인다'], 관측: ['우편함'] };
  assert.match(reasonsOf(o, rw), /coverage:/);
});
t('빈 기대 → empty:기대', () => {
  assert.match(reasonsOf(CH, with_(CH_OK, '기대', [])), /empty:기대/);
});
t('칸 모양 오류(배열 아님) → shape', () => {
  assert.match(reasonsOf(CH, with_(CH_OK, '조작', 'A서버 캐릭터로 우편을 보낸다')), /shape:조작/);
});
t('엉뚱한 문장 → 통과 못 함', () => {
  const rw = { 전제: [], 조작: ['상점을 연다'], 기대: ['상품이 보인다'], 관측: ['상점 화면'] };
  assert.ok(!checkRewrite(CH, rw).ok);
});
t('진공: 빈 객체는 통과 못 함', () => {
  assert.ok(!checkRewrite(CH, {}).ok);
});

// ── 청크 단위: id 집합 ─────────────────────────────────────────────────
t('청크: 정확한 id 집합이면 통과', () => {
  const r = checkChunk(['001', '002'], { rows: [{ id: '001' }, { id: '002' }] });
  assert.ok(r.ok, r.errors.join(', '));
});
t('청크: 누락·추가·중복·숫자 id 를 잡는다', () => {
  const r = checkChunk(['001', '002', '003'], { rows: [{ id: '001' }, { id: '001' }, { id: '009' }, { id: 2 }] });
  const e = r.errors.join(' | ');
  assert.ok(!r.ok);
  assert.match(e, /002 누락/); assert.match(e, /003 누락/); assert.match(e, /009/); assert.match(e, /001 중복/); assert.match(e, /rows\[3\] id/);
});
t('청크: rows 배열이 없으면 실패', () => {
  assert.ok(!checkChunk(['001'], { data: [] }).ok);
  assert.ok(!checkChunk(['001'], null).ok);
});

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
