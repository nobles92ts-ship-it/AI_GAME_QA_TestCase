'use strict';
const assert = require('assert');
const { checkDuplicates, norm, jaccard, tokens } = require('../lib/dup_gate.js');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  PASS ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' — ' + e.message); } }
// [A,B,C,D,E,F,G,H,I,J]
const R = (id, b, d, f, e = '정상') => [id, b, '중', d, e, f, 'PC/모바일', '미진행', '미진행', ''];

console.log('dup_gate.js 테스트');

t('QA 본문 F열 완전 동일 → exact 검출', () => {
  const rows = [R('001', '슬롯', '장착 확정', '일괄 해제가 실패하면 롤백되는지 확인'),
    R('002', '슬롯', '장착 확정', '일괄 해제가 실패하면 롤백되는지 확인')];
  const res = checkDuplicates(rows);
  assert.strictEqual(res.exact.length, 1);
  assert.deepStrictEqual(res.exact[0].tc_ids, ['001', '002']);
});

t('소분류가 달라도 F열이 같으면 exact (테스터가 구별 불가)', () => {
  const rows = [R('001', '슬롯', '대형 장착', '일괄 해제가 실패하면 롤백되는지 확인'),
    R('002', '슬롯', '소형 장착', '일괄 해제가 실패하면 롤백되는지 확인')];
  assert.strictEqual(checkDuplicates(rows).exact.length, 1);
});

t('구두점·따옴표 차이는 동일로 정규화', () => {
  const rows = [R('001', '리스트', '화면', '메뉴가 "훈장"(Key)으로 출력되는지 확인'),
    R('002', '리스트', '화면', '메뉴가 훈장 Key 으로 출력되는지 확인')];
  assert.strictEqual(checkDuplicates(rows).exact.length, 1, '정규화 후 일치해야 함');
});

t('기본기능↔QA 중복은 검사 대상 아님 (설계상 의도된 재기술)', () => {
  const rows = [R('001', '기본기능', '진입', '훈장 메뉴가 출력되는지 확인'),
    R('002', '훈장 리스트', '진입', '훈장 메뉴가 출력되는지 확인')];
  assert.strictEqual(checkDuplicates(rows).exact.length, 0, '스코프가 달라 교차 비교 금지');
});

t('기본기능 내부끼리의 완전 동일은 검출', () => {
  const rows = [R('001', '기본기능', '진입', '훈장 메뉴가 출력되는지 확인'),
    R('002', '기본기능', '진입', '훈장 메뉴가 출력되는지 확인')];
  const res = checkDuplicates(rows);
  assert.strictEqual(res.exact.length, 1);
  assert.strictEqual(res.exact[0].scope, 'basic');
});

t('토큰 집합이 같고 배치만 다른 쌍 → similar 자카드 1.0 (실측 308↔354 형상)', () => {
  const rows = [R('308', '보상', '툴팁', '훈장 보상 UI에서 훈장을 선택하면 툴팁이 출력되는지 확인'),
    R('354', '보상', '툴팁', '보상 UI에서 훈장을 선택하면 훈장 툴팁이 출력되는지 확인')];
  const res = checkDuplicates(rows, 0.85);
  assert.strictEqual(res.exact.length, 0, '문자열 자체는 다름');
  assert.strictEqual(res.similar.length, 1, '유사로 잡혀야 함');
  assert.strictEqual(res.similar[0].score, 1, '토큰 집합 동일 → 1.0');
});

t('조사만 다른 쌍도 임계 이상이면 similar (실측 161↔261 형상)', () => {
  const rows = [R('161', '리스트', '화면', '해제 버튼을 500ms 이내에 연속 3회 입력해도 중복 처리되지 않는지 확인'),
    R('261', '슬롯', '화면', '해제 버튼을 500ms 내 연속 3회 입력해도 중복 처리되지 않는지 확인')];
  const res = checkDuplicates(rows, 0.85);
  assert.strictEqual(res.similar.length, 1);
  assert.ok(res.similar[0].score >= 0.85, 'score=' + res.similar[0].score);
});

t('의미가 다른 TC는 유사로 잡히지 않음 (오탐 방지)', () => {
  const rows = [R('001', '슬롯', '화면', '가로 4열 경계까지 이동시키면 슬롯 밖으로 벗어나지 않는지 확인'),
    R('002', '리스트', '툴팁', '미보유 훈장을 선택하면 공유 버튼이 출력되지 않는지 확인')];
  assert.strictEqual(checkDuplicates(rows, 0.85).similar.length, 0);
});

t('exact로 잡힌 행은 similar에서 중복 계상하지 않음', () => {
  const rows = [R('001', '슬롯', '화면', '동일한 문장으로 검증하는지 확인'),
    R('002', '슬롯', '화면', '동일한 문장으로 검증하는지 확인'),
    R('003', '슬롯', '화면', '동일한 문장으로 검증하는지 확인')];
  const res = checkDuplicates(rows, 0.5);
  assert.strictEqual(res.exact.length, 1, '3행이 한 그룹');
  assert.strictEqual(res.exact[0].tc_ids.length, 3);
  assert.strictEqual(res.similar.length, 0, 'exact 대상은 similar에서 제외');
});

t('중복 없으면 빈 결과', () => {
  const rows = [R('001', '슬롯', '화면', '장착하면 E 아이콘이 출력되는지 확인'),
    R('002', '슬롯', '화면', '미보유 상태에서 딤드 처리되는지 확인')];
  const res = checkDuplicates(rows);
  assert.strictEqual(res.exact.length, 0);
});

t('jaccard/tokens 기본 동작', () => {
  assert.strictEqual(jaccard(tokens('가나 다라'), tokens('가나 다라')), 1);
  assert.strictEqual(jaccard(new Set(), new Set(['x'])), 0);
  assert.strictEqual(norm('  a  ,  b  '), 'a b');
});

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
