'use strict';
const assert = require('assert');
const { checkItemCite } = require('../lib/item_cite_gate.js');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  PASS ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' — ' + e.message); } }

const R = (id, f) => [id, '인벤토리', '아이템 사용', '화면', '정상', f, 'PC/모바일', '미진행', '미진행', ''];
const has = (fs, kind) => fs.filter(x => x.kind === kind);

// 실 테이블 형상을 축약한 사전: 세공=실명 가능 / 제작=표시명 공유(placeholder)
const DICT = {
  systems: [
    { key: '세공', item_count: 3, examples: [{ index: 303000001, name: '샘플재료석', name_placeholder: false, cite: '샘플재료석' }] },
    { key: '제작', item_count: 60, examples: [{ index: 100000002, name: '제작 재료 임시 명칭', name_placeholder: true, placeholder_reason: 'shared', cite: '제작 재료 임시 명칭(Index 100000002)' }] },
  ],
  types: [
    { inventory_category: '재료', item_type: '성장 재료', examples: [{ index: 302010001, name: '일반 샘플 강화권B', name_placeholder: false, cite: '일반 샘플 강화권B' }] },
    { inventory_category: '재료', item_type: '순간 이동', examples: [{ index: 304000001, name: '순간 이동 주문서', name_placeholder: false, cite: '순간 이동 주문서' }] },
    { inventory_category: '장비', item_type: '무기', examples: [{ index: 101010001, name: '방패 건틀릿', name_placeholder: false, cite: '방패 건틀릿' }] },
  ],
  combos: [{ systems: ['제작', '강화'], item_count: 0 }, { systems: ['세공', '강화'], item_count: 0 }],
  placeholder_names: ['제작 재료 임시 명칭'],
  name_index: { '샘플재료석': 303000001, '일반 샘플 강화권B': 302010001, '샘플 고유재료': 301000005, '순간 이동 주문서': 304000001 },
};

console.log('item_cite_gate.js 테스트');

t('④ 유형만 지목 → missing_cite 후보 + 병기 후보를 제시한다', () => {
  const { findings } = checkItemCite([R('011', '인벤토리에서 세공 재료 아이템 아이콘을 더블 클릭하면 세공 화면으로 전환되는지 확인')], DICT);
  const m = has(findings, 'missing_cite');
  assert.strictEqual(m.length, 1);
  assert.ok(/샘플재료석/.test(m[0].detail), '사전 예시를 후보로 제시');
  assert.ok(/축1/.test(m[0].detail), '판정 축을 명시해 LLM 이 무엇을 결정해야 하는지 알려준다');
});

t('병기가 있으면 후보로 잡지 않는다 (already_cited 로 센다)', () => {
  const { findings, excluded } = checkItemCite([R('011', '세공 재료 아이템(예: 샘플재료석)을 사용하면 세공 화면으로 전환되는지 확인')], DICT);
  assert.strictEqual(has(findings, 'missing_cite').length, 0);
  assert.strictEqual(excluded.already_cited, 1);
});

t('상태 서술만 하는 행은 제외 — 준비물이 아니다(축1=X)', () => {
  const rows = [
    R('014', '세공 재료만 등록되어 세공 대상 슬롯이 빈 상태이면 안내 가이드 텍스트가 출력되는지 확인'),
    R('122', '강화 화면에 재료가 이미 등록된 상태에서 화면을 닫으면 등록된 재료가 잔류하지 않는지 확인'),
  ];
  const { findings, excluded } = checkItemCite(rows, DICT);
  assert.strictEqual(has(findings, 'missing_cite').length, 0);
  assert.ok(excluded.state_only >= 1);
});

t('② 전수 검증 문장에 대표 1건 병기 = HIGH (범위 축소 오독)', () => {
  const { findings } = checkItemCite([R('200', '모든 성장 재료 아이템(예: 일반 샘플 강화권B)의 툴팁에 사용 버튼이 출력되는지 확인')], DICT);
  const v = has(findings, 'cite_with_scope_all');
  assert.strictEqual(v.length, 1);
  assert.strictEqual(v[0].severity, 'HIGH');
});

t('전수 검증 문장은 병기가 없어도 후보로 잡지 않는다 (병기 금지 대상)', () => {
  const { findings, excluded } = checkItemCite([R('201', '각 성장 재료별로 사용 버튼이 출력되는지 확인')], DICT);
  assert.strictEqual(has(findings, 'missing_cite').length, 0);
  assert.strictEqual(excluded.scope_all, 1);
});

t('① 공유 표시명을 인용했는데 Index 없음 → HIGH 확정', () => {
  const { findings } = checkItemCite([R('001', '제작 재료 아이템(예: 제작 재료 임시 명칭) 툴팁에 제작 아이콘이 출력되는지 확인')], DICT);
  const v = has(findings, 'placeholder_no_index');
  assert.strictEqual(v.length, 1);
  assert.strictEqual(v[0].severity, 'HIGH');
});

t('① Index 가 붙어 있으면 통과 (중첩 괄호 파싱 — 실측 오탐 6건 회귀 방지)', () => {
  const { findings, excluded } = checkItemCite([R('001', '제작 재료 아이템(예: 제작 재료 임시 명칭(Index 100000002)) 툴팁에 제작 아이콘이 출력되는지 확인')], DICT);
  assert.strictEqual(findings.length, 0, '중첩 괄호를 안쪽에서 자르면 이름이 깨져 전건 오탐이 된다');
  assert.strictEqual(excluded.already_cited, 1);
});

t('① 판정은 유형이 아니라 **인용된 개체** 기준 — 같은 유형의 고유 실명은 Index 불필요 (실측 오탐 회귀 방지)', () => {
  const { findings } = checkItemCite([R('042', '제작 재료에만 해당하는 아이템(예: 샘플 고유재료)의 툴팁을 열면 사용 버튼이 출력되지 않는지 확인')], DICT);
  assert.strictEqual(findings.length, 0, '"제작 재료" 유형이 placeholder 라는 이유로 고유 실명을 위반 처리하면 안 된다');
});

t('⑤ 테이블에 없는 이름을 병기 → HIGH 확정 (기억·추측 금지의 집행)', () => {
  const { findings } = checkItemCite([R('039', '성장 재료 아이템(예: 강화석)의 툴팁을 열면 사용 버튼이 출력되는지 확인')], DICT);
  const v = has(findings, 'unknown_item_name');
  assert.strictEqual(v.length, 1);
  assert.strictEqual(v[0].severity, 'HIGH');
  assert.ok(/강화석/.test(v[0].detail));
});

t('⑤ 이름 색인이 없는 구 사전이면 검사를 건너뛴다 (전건 오탐 방지)', () => {
  const old = { systems: DICT.systems, types: DICT.types, combos: DICT.combos };
  const { findings } = checkItemCite([R('039', '성장 재료 아이템(예: 강화석)의 툴팁을 열면 사용 버튼이 출력되는지 확인')], old);
  assert.strictEqual(has(findings, 'unknown_item_name').length, 0);
});

t('③ 한 문장에 같은 병기 2회 → MEDIUM', () => {
  const { findings } = checkItemCite([R('092', '세공 재료 아이템(예: 샘플재료석)을 사용한 뒤 같은 세공 재료 아이템(예: 샘플재료석)을 다시 사용하면 재판정되는지 확인')], DICT);
  assert.strictEqual(has(findings, 'duplicate_cite').length, 1);
});

t('`, 예: X)` 형태(부정 TC 괄호 안 병기)도 병기로 인정한다', () => {
  const { findings, excluded } = checkItemCite(
    [R('079', '세공 재료가 아닌 재료 아이템(SystemC 세공 재료 목록에 없는 아이템, 예: 일반 샘플 강화권B)을 사용하면 세공 화면으로 전환되지 않는지 확인')], DICT);
  assert.strictEqual(has(findings, 'missing_cite').length, 0);
  assert.strictEqual(excluded.already_cited, 1);
});

t('장비 유형은 대상이 아니다 — 재료 카테고리만 본다(오탐 억제)', () => {
  const { findings } = checkItemCite([R('125', '강화 화면에 진입하면 무기 아이템만 목록에 출력되는지 확인')], DICT);
  assert.strictEqual(findings.length, 0);
});

t('`순간 이동` 류는 뒤에 "아이템"이 와야 매치 (단독 오탐 억제)', () => {
  const a = checkItemCite([R('300', '순간 이동 후 화면이 전환되는지 확인')], DICT);
  assert.strictEqual(a.findings.length, 0, '단독 등장은 무시');
  const b = checkItemCite([R('301', '순간 이동 아이템을 사용하면 지정 좌표로 이동하는지 확인')], DICT);
  assert.strictEqual(has(b.findings, 'missing_cite').length, 1);
});

t('제외분을 센다 — 후보 0건이 "위반 없음"인지 "제외가 다 먹었는지" 구분 가능', () => {
  const rows = [
    R('014', '세공 재료만 등록된 상태에서 슬롯이 빈 공간으로 출력되는지 확인'),
    R('201', '모든 제작 재료 아이템에 아이콘이 붙는지 확인'),
    R('011', '세공 재료 아이템(예: 샘플재료석)을 사용하면 전환되는지 확인'),
  ];
  const { findings, excluded } = checkItemCite(rows, DICT);
  assert.strictEqual(has(findings, 'missing_cite').length, 0);
  assert.deepStrictEqual(excluded, { scope_all: 1, state_only: 1, already_cited: 1 });
});

t('F열이 빈 행은 건너뛴다', () => {
  assert.strictEqual(checkItemCite([R('999', '')], DICT).findings.length, 0);
});

console.log(`결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
