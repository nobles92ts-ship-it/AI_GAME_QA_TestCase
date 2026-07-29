'use strict';
const assert = require('assert');
const { checkOrigin } = require('../lib/origin_gate.js');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  PASS ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' — ' + e.message); } }
const R = (id, f) => [id, '훈장', '중', '화면', '예외', f, 'PC/모바일', '미진행', '미진행', ''];
const has = (fs, kind) => fs.filter(x => x.kind === kind);

console.log('origin_gate.js 테스트');

t('원문에 없는 상호작용 동사 → HIGH (7차 회고 유형 D 형상)', () => {
  const rows = [R('321', '툴팁 대상이 목록에서 빠져도 툴팁이 닫히는지 확인')];
  const raw = '# 훈장\n툴팁에는 이름과 등급을 출력한다.';
  const f = checkOrigin(rows, raw);
  assert.strictEqual(has(f, 'interaction_verb').length, 1);
  assert.strictEqual(f[0].severity, 'HIGH');
});

t('원문에 어간이 있으면 동사 후보에서 제외 (오탐 방지)', () => {
  const rows = [R('100', '나가기 버튼을 입력하면 UI가 닫히는지 확인')];
  const raw = '나가기 버튼 선택 시 UI를 닫는다.';
  assert.strictEqual(has(checkOrigin(rows, raw), 'interaction_verb').length, 0);
});

t('호버·포커스·재표시도 동일 규칙', () => {
  const rows = [R('037', '툴팁 아이콘을 반복 호버하면 툴팁이 다시 표시되는지 확인'),
    R('038', '포커스 이탈 시 툴팁이 닫히는지 확인')];
  const raw = '툴팁 아이콘을 노출한다.';
  assert.ok(has(checkOrigin(rows, raw), 'interaction_verb').length >= 3, '호버·재표시·포커스·닫힘');
});

t('좌표가 원문에 없으면 HIGH', () => {
  const rows = [R('193', '소형 훈장 가배치가 [9,9] 슬롯에서 시작되는지 확인')];
  const raw = '소형 훈장은 [3,2] 슬롯을 중앙으로 한다.';
  const c = has(checkOrigin(rows, raw), 'coordinate');
  assert.strictEqual(c.length, 1);
});

t('행·열 뒤바뀜을 명시적으로 지목 (회고 193·194)', () => {
  const rows = [R('194', '가배치가 3행 2열에서 시작되는지 확인')];
  const raw = '소형 훈장은 [2,3] 슬롯을 중앙으로 한다.';
  const c = has(checkOrigin(rows, raw), 'coordinate');
  assert.strictEqual(c.length, 1);
  assert.ok(/뒤바뀜/.test(c[0].detail), '스왑 힌트가 있어야 함: ' + c[0].detail);
});

t('원문 이스케이프 좌표도 대조 성립 (컨버터 형식 차이 흡수)', () => {
  const rows = [R('023', '가배치가 [3,2] 슬롯에서 시작되는지 확인')];
  const raw = '소형 훈장은 \\[3,2\\] 슬롯을 중앙으로 한다.';
  assert.strictEqual(has(checkOrigin(rows, raw), 'coordinate').length, 0, '이스케이프/평문 동일 취급');
});

t('방향어가 원문에 있으면 후보 아님 (042 오탐 억제)', () => {
  const rows = [R('042', '메뉴 이름이 좌측에 출력되는지 확인')];
  const raw = 'Top UI 좌측에 뒤로가기 버튼을 배치한다.';
  assert.strictEqual(has(checkOrigin(rows, raw), 'direction').length, 0);
});

t('방향어가 원문에 아예 없으면 LOW 후보', () => {
  const rows = [R('042', '메뉴 이름이 좌측에 출력되는지 확인')];
  const raw = 'Top UI에 뒤로가기 버튼을 배치한다.';
  const d = has(checkOrigin(rows, raw), 'direction');
  assert.strictEqual(d.length, 1);
  assert.strictEqual(d[0].severity, 'LOW');
});

t('근거 있는 TC만 있으면 빈 결과', () => {
  const rows = [R('001', '훈장을 선택하면 이름이 출력되는지 확인')];
  const raw = '훈장을 선택하면 이름을 출력한다.';
  assert.strictEqual(checkOrigin(rows, raw).length, 0);
});

t('F열이 비어도 안전', () => {
  assert.strictEqual(checkOrigin([[...R('001', '')]], '원문').length, 0);
});

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
