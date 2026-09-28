'use strict';
const assert = require('assert');
const fs = require('fs');
const { slice } = require('../lib/slicer.js');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  PASS ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' — ' + e.message); } }

const doc = [
  '# 자동 사냥 기능',
  '',
  '> 메타: 저장자',
  '',
  '---',            // 구분선 — 헤딩 아님
  '',
  '자동 사냥 규칙',
  '========',        // setext h1
  '',
  '* 자동 사냥 버튼 클릭 시 설정 반경 내에서 시작하는지 확인',
  '* 우선순위 1순위는 나를 공격 중인 몬스터',
  '  + 같은 순위 여럿이면 가까운 대상 우선',   // depth 2
  '    - 너무 깊은 항목은 규칙에서 제외',      // depth 3 (ruleDepth=2 기본이면 배제)
  '* PC',           // 짧음 — 배제
  '* ![img](http://x/y.png)',  // 이미지 — 배제',
  '',
  '### 예외사항',    // atx h3
  '',
  '1. 자동 사냥 도중 사망 시 종료되는지 확인',
  '2. 마을 안에서는 반경 내 몬스터가 있어도 수행하지 않는지 확인',
].join('\n');

console.log('slicer.js 테스트');

const r = slice(doc);

t('헤딩 3개(# 제목, setext 규칙, ### 예외) — 구분선 --- 제외', () => {
  assert.strictEqual(r.sections.length, 3, '섹션 수: ' + r.sections.map(s => s.heading).join('|'));
  assert.strictEqual(r.sections[1].heading, '자동 사냥 규칙');
  assert.strictEqual(r.sections[1].level, 1); // setext ===
  assert.strictEqual(r.sections[2].heading, '예외사항');
  assert.strictEqual(r.sections[2].level, 3); // atx ###
});

t('구분선 ---가 setext h2로 오탐되지 않음', () => {
  assert.ok(!r.sections.some(s => /^-+$/.test(s.heading) || s.heading === ''));
});

t('규칙 추출 — 짧은 항목·이미지·과다 depth 배제', () => {
  const ruleTexts = r.rules.map(x => x.text);
  assert.ok(ruleTexts.some(x => x.includes('설정 반경 내에서 시작')));
  assert.ok(ruleTexts.some(x => x.includes('같은 순위 여럿이면')), 'depth2는 포함');
  assert.ok(!ruleTexts.some(x => x.includes('너무 깊은 항목')), 'depth3은 배제(ruleDepth=2)');
  assert.ok(!ruleTexts.includes('PC'), '짧은 항목 배제');
  assert.ok(!ruleTexts.some(x => x.startsWith('![')), '이미지 배제');
});

t('rule_id 형식 R-<sec>.<n> + sec_id 연결', () => {
  for (const rl of r.rules) {
    assert.ok(/^R-\d+\.\d+$/.test(rl.rule_id), 'rule_id: ' + rl.rule_id);
    assert.ok(rl.sec_id && r.sections.some(s => s.sec_id === rl.sec_id));
  }
});

t('예외사항 번호목록도 규칙으로 추출', () => {
  assert.ok(r.rules.some(x => x.text.includes('사망 시 종료')));
  assert.ok(r.rules.some(x => x.text.includes('마을 안에서는')));
});

t('섹션 원문 보존 — text에 하위 리스트 원문 포함', () => {
  const sec = r.sections.find(s => s.heading === '자동 사냥 규칙');
  assert.ok(sec.text.includes('우선순위 1순위'));
});

t('헤딩 없는 문서 = 단일 섹션 폴백', () => {
  const r2 = slice('그냥 평문\n리스트도 없음');
  assert.strictEqual(r2.sections.length, 1);
  assert.strictEqual(r2.sections[0].sec_id, 'R-1');
});

// ── 표 규칙 추출 (2026-07-29 신설) ──
const tdoc = [
  '| 1. 개요 |',              // 표형 대제목 (1셀 + 숫자) — 헤딩
  '| --- |',
  '',
  '**History**',
  '',
  '| **날짜** | **이름** | **내용** |',
  '| --- | --- | --- |',
  '| 2026-06-22 | @시스템/송성진 | 문서 최초 작성 |',   // 변경 이력 — 배제
  '',
  '| **UI 설명** | **항목** | **설명** |',
  '| --- | --- | --- |',
  '| image-20260724-030647.png | 챕터 이동 | 챕터 이동 버튼을 추가합니다.   * MapGroup 값이 1이면 좌측 화살표를 표현하지 않습니다.    + 딤드 처리한 경우 별도 토스트 메시지는 출력하지 않습니다. |',
  '| **UI 설명** | **항목** | **설명** |',   // 문서 중간 반복 헤더 — 배제
  '| Icon_WorldMap_Village.PNG | **Grade** | 마을은 가장 크고, 관문은 그보다 작아야 합니다. |',
  '| Common | NameCode | <https://{CONFLUENCE_SITE}/wiki/x> |',   // 한글 없음 — 전부 배제
  '',
  '* 줌인 - 줌아웃의 시간에 따라 투명도가 변경되도록 수정합니다.',
].join('\n');

const rt = slice(tdoc);
const tTexts = rt.rules.map((x) => x.text);

t('표 데이터 셀이 규칙으로 추출됨', () => {
  assert.ok(tTexts.some((x) => x.includes('챕터 이동 버튼을 추가합니다')), '표 셀 미추출: ' + tTexts.join(' | '));
  assert.ok(tTexts.some((x) => x.includes('마을은 가장 크고')));
});

t('셀 안 눌린 불릿이 개별 규칙으로 분할됨', () => {
  assert.ok(tTexts.some((x) => x.startsWith('MapGroup 값이 1이면')), '2단 불릿 미분할');
  assert.ok(tTexts.some((x) => x.startsWith('딤드 처리한 경우')), '3단 불릿 미분할');
});

t('산문 하이픈(공백 1칸)은 분할하지 않음', () => {
  assert.ok(tTexts.some((x) => x.includes('줌인 - 줌아웃의 시간에 따라')), '산문 하이픈이 잘림');
});

t('헤더 행·구분선·반복 헤더 행 배제', () => {
  assert.ok(!tTexts.some((x) => x.includes('UI 설명')), '헤더 행이 규칙으로 들어옴');
  assert.ok(!tTexts.some((x) => /^-+$/.test(x)), '구분선이 규칙으로 들어옴');
});

t('변경 이력(첫 셀=날짜) 행 배제', () => {
  assert.ok(!tTexts.some((x) => x.includes('문서 최초 작성')));
});

t('이미지 파일명 단독 셀 배제', () => {
  assert.ok(!tTexts.some((x) => /\.(png|jpg|gif)$/i.test(x)), '이미지 파일명이 규칙으로 들어옴: ' + tTexts.filter((x) => /\.png$/i.test(x)));
});

t('한글 없는 셀(enum 값·컬럼명·URL) 배제 — 스키마 표 노이즈', () => {
  assert.ok(!tTexts.includes('Common'));
  assert.ok(!tTexts.includes('NameCode'));
  assert.ok(!tTexts.some((x) => x.startsWith('<http')));
});

t('볼드만 있는 셀(열 라벨) 배제', () => {
  assert.ok(!tTexts.some((x) => /^\*\*[^*]+\*\*$/.test(x)), '볼드 라벨이 규칙으로 들어옴');
});

t('표형 대제목(1셀+숫자)은 헤딩이지 규칙 아님', () => {
  assert.ok(rt.sections.some((s) => s.heading === '1. 개요'));
  assert.ok(!tTexts.some((x) => x === '1. 개요'));
});

t('표 규칙에 from=table 표식', () => {
  const tb = rt.rules.filter((x) => x.from === 'table');
  const li = rt.rules.filter((x) => x.from === 'list');
  assert.ok(tb.length >= 4, '표 규칙 ' + tb.length);
  assert.ok(li.length >= 1, '리스트 규칙 ' + li.length);
});

t('tableMinChars 옵션이 표 셀에만 적용됨', () => {
  const loose = slice(tdoc, { tableMinChars: 2 });
  const strict = slice(tdoc, { tableMinChars: 40 });
  assert.ok(loose.rules.filter((x) => x.from === 'table').length > strict.rules.filter((x) => x.from === 'table').length);
  const li = (r2) => r2.rules.filter((x) => x.from === 'list').length;
  assert.strictEqual(li(loose), li(strict), '리스트 규칙 수는 tableMinChars에 영향받지 않아야 함');
});

// ── 표 행 구멍 수리 (2026-09-24 감사 L4-01) ──
// 칸 단위 추출이 짧은 칸(12자 미만)을 버려, 칸이 전부 짧은 행은 규칙이 0개였다(현행 39런 표 데이터 행 20%).
// 규칙이 0개인 행은 행 단위 규칙 1개(헤더: 값)로 남기고, 칸 규칙에는 row(행 맥락)를 붙인다.
const sdoc = [
  '## 스탯 목록',
  '',
  '| **스탯** | **표시명** | **구현** | **비고** |',
  '| --- | --- | --- | --- |',
  '| 물리 명중 | 물리 명중 | O |  |',
  '| 치명타 확률 | 치명타 | X | 추후 |',
  '| Common | NameCode | Sample_UI |  |',
  '| 2026-09-01 | 홍길동 | 수정 |  |',
  '',
  '## 아이템 정책',
  '',
  '| **아이템** | **거래** | **사용** |',
  '| --- | --- | --- |',
  '| 스킬 강화 쿠폰 | X | O - 스킬 UI 진입 |',
  '| 스킬 연마석 | O | O - 스킬 UI 진입 |',
  '',
  '## 연출',
  '',
  '| **구간** | **설명** |',
  '| --- | --- |',
  '| +6강 ~ +7강 | 1단계 이펙트 |',
  '| 보스 등장 연출 boss_intro.png | 흔들림 |',
].join('\n');
const sr = slice(sdoc);
const rowRules = sr.rules.filter((x) => x.from === 'table-row');

t('칸이 전부 짧은 행도 규칙 1개로 남는다 — 행 단위(헤더: 값)', () => {
  const hit = rowRules.find((x) => x.text.includes('물리 명중'));
  assert.ok(hit, '물리 명중 행 규칙 없음: ' + sr.rules.map((x) => x.text).join(' | '));
  assert.ok(hit.text.includes('구현: O'), '헤더: 값 결합 아님: ' + hit.text);
  assert.ok(rowRules.some((x) => x.text.includes('치명타 확률') && x.text.includes('구현: X')));
});

t('숫자·단계만 있는 행(연출 구간표)도 규칙으로 남는다', () => {
  assert.ok(rowRules.some((x) => x.text.includes('+6강 ~ +7강') && x.text.includes('1단계 이펙트')), rowRules.map((x) => x.text).join(' | '));
});

t('「한글 문장 + 이미지 파일명」 칸은 파일명만 떼고 문장을 살린다', () => {
  assert.ok(rowRules.some((x) => x.text.includes('보스 등장 연출')), '파일명 섞인 칸이 통째로 버려짐');
  const all = sr.rules.map((x) => x.text + ' ' + (x.row || '')).join(' ');
  assert.ok(!/boss_intro\.png/i.test(all), '파일명이 규칙에 남음');
});

t('한글 없는 행(enum·스트링 키)과 변경 이력 행은 여전히 규칙 0개', () => {
  const all = sr.rules.map((x) => x.text + ' ' + (x.row || '')).join(' ');
  assert.ok(!all.includes('NameCode'), '한글 없는 행이 규칙이 됨');
  assert.ok(!all.includes('홍길동'), '변경 이력 행이 규칙이 됨');
});

t('칸 규칙에 행 맥락(row)이 붙어 같은 문구의 두 행이 구분된다', () => {
  const same = sr.rules.filter((x) => x.from === 'table' && x.text === 'O - 스킬 UI 진입');
  assert.strictEqual(same.length, 2, '같은 문구 칸 규칙 2개 기대: ' + JSON.stringify(same));
  assert.ok(same[0].row && same[0].row.includes('스킬 강화 쿠폰') && same[0].row.includes('거래: X'), 'row 맥락 없음: ' + JSON.stringify(same[0]));
  assert.ok(same[1].row && same[1].row.includes('스킬 연마석'), 'row 맥락 없음: ' + JSON.stringify(same[1]));
  assert.notStrictEqual(same[0].row, same[1].row);
});

// 재측정(42런)에서 남은 실누락 2형 — 이름이 짧은 스탯 행 · 볼드 행 키
const s2 = slice([
  '## 짧은 행',
  '',
  '| **스탯** | **표시명** | **구현** |',
  '| --- | --- | --- |',
  '| 명중 | 명중 | O |',
  '| 예 |  |  |',
  '',
  '| **상황** | **자동 스킬** |',
  '| --- | --- |',
  '| **글로벌 쿨타임 중 자동 스킬 대기** | X |',
  '| **수정 결과** image-20260915-081926.png |  |',
].join('\n'));
const s2row = s2.rules.filter((x) => x.from === 'table-row').map((x) => x.text);

t('값이 짧아도 칸이 2개 이상인 행은 규칙으로 남는다 (| 명중 | 명중 | O |)', () => {
  assert.ok(s2row.some((x) => x.includes('명중') && x.includes('구현: O')), s2row.join(' | '));
});

t('데이터 행의 볼드 첫 칸은 열 라벨이 아니라 행 키다 — 행 규칙에 들어간다', () => {
  assert.ok(s2row.some((x) => x.includes('글로벌 쿨타임 중 자동 스킬 대기') && x.includes('X')), s2row.join(' | '));
});

t('칸 1개짜리 짧은 행·그림만 가리키는 행은 여전히 규칙 0개 (| 예 | · **수정 결과** 이미지)', () => {
  assert.ok(!s2row.some((x) => x === '예' || x.includes('수정 결과')), s2row.join(' | '));
});

t('칸 규칙이 이미 있는 행에는 행 단위 규칙을 더하지 않는다(규칙 부풀림 방지)', () => {
  assert.ok(!rowRules.some((x) => x.text.includes('스킬 강화 쿠폰')), '칸 규칙이 있는 행에 행 규칙이 중복 생성됨');
});

// ── 실제 confluence_raw 통합 스모크 ──
t('실물 자동_사냥_기능/confluence_raw.md 파싱 정상', () => {
  const p = '{PROJECT_ROOT}/team/specs/자동_사냥_기능/confluence_raw.md';
  if (!fs.existsSync(p)) { console.log('    (skip — 파일 없음)'); return; }
  const real = slice(fs.readFileSync(p, 'utf8'));
  assert.ok(real.sections.length >= 3, '실물 섹션 ' + real.sections.length);
  assert.ok(real.rules.length >= 10, '실물 규칙 ' + real.rules.length);
  console.log(`    실물: 섹션 ${real.sections.length} / 규칙 ${real.rules.length}`);
  console.log('    섹션: ' + real.sections.map(s => s.heading).slice(0, 8).join(' · '));
});

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
