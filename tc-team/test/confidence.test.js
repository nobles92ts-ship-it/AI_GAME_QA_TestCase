'use strict';
// confidence_core.js 회귀 테스트 — 합성 픽스처로 R1~R7 을 알려진 위치에서 발화시켜
// 소분류·항목 점수를 정확히 잠근다. 산식을 튜닝하면 이 기대표를 함께 갱신해야 한다
// (= 점수가 바뀌는 변경은 반드시 눈에 보인다).
const assert = require('assert');
const path = require('path');
const { compute, computeItems, RULES, penaltyOf } = require('../scripts/confidence/confidence_core.js');

const FIX = path.join(__dirname, 'fixtures', 'confidence');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  PASS ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' — ' + e.message); } }

const ids = (o) => o.reasons.map((r) => r.id).sort().join(',');
const { scored } = compute(FIX);
const { items } = computeItems(FIX);
const leaf = (n) => scored.find((s) => s.name.startsWith(n));
const item = (n, stage, no) => items.find((i) => i.leaf.startsWith(n) && i.stage === stage && i.no === no);

console.log('confidence_core.js 테스트');

// ── 파싱 ────────────────────────────────────────────────────────────────
t('설계서 트리 파싱 — 소분류 4 / 항목 9', () => {
  assert.strictEqual(scored.length, 4);
  assert.strictEqual(items.length, 9);
});

t('대·중분류와 리스크 마커가 리프에 전달된다', () => {
  const l = leaf('환전');
  assert.strictEqual(l.major, '우편 시스템');
  assert.strictEqual(l.mid, '보상 처리');
  assert.strictEqual(l.risk, 'LOW');
});

// ── 소분류 단위 감점 ────────────────────────────────────────────────────
t('소분류 점수표 (감점 규칙별 1회씩)', () => {
  const want = [
    ['우편 배너', 100, 'A', 'R7'],       // 감점 0 + 설계기법 배지(점수 영향 없음)
    ['쿠폰 코드', 35, 'D', 'R1,R2'],     // 미결 질의 -45, 이미지 의존 -20
    ['우편함 보상', 52, 'C', 'R3,R5'],   // crossref keep 2건 -(25+8), 커버리지 gap -15
    ['환전 비율', 70, 'B', 'R4,R6'],     // crossref locate 1건 -12, 얕은 앵커 -18
  ];
  for (const [n, score, grade, rs] of want) {
    const l = leaf(n);
    assert.strictEqual(l.score, score, `${n} 점수 ${l.score} ≠ ${score}`);
    assert.strictEqual(l.grade, grade, `${n} 등급 ${l.grade} ≠ ${grade}`);
    assert.strictEqual(ids(l), rs, `${n} 규칙 [${ids(l)}] ≠ [${rs}]`);
  }
});

t('어느 리프에도 안 걸리는 crossref 용어는 감점하지 않는다 (오탐 방지)', () => {
  const fired = scored.flatMap((s) => s.reasons).filter((r) => r.id === 'R3' || r.id === 'R4');
  assert.ok(!fired.some((r) => /길드 창고/.test(r.detail)), '무관 용어 "길드 창고 정원"이 발화');
});

t('R3(keep)가 있으면 R4(locate)는 중복 발화하지 않는다', () => {
  scored.forEach((s) => assert.ok(!(ids(s).includes('R3') && ids(s).includes('R4')), s.name));
});

// ── 항목 단위 감점 ──────────────────────────────────────────────────────
t('항목 점수표 (9건 전수)', () => {
  const want = [
    ['우편 배너', '정상', 1, 100, 'A', 'R7'],
    ['우편 배너', '정상', 2, 100, 'A', 'R7'],
    ['쿠폰 코드', '정상', 1, 35, 'D', 'R1,R2'],
    ['쿠폰 코드', '정상', 2, 80, 'B', 'R2'],
    ['쿠폰 코드', '정상', 3, 80, 'N', 'R2'],   // [J:추후구현] → 등급 N
    ['우편함 보상', '정상', 1, 67, 'C', 'R3'], // 문장이 용어 2개를 물음 → -(25+8)
    ['우편함 보상', '정상', 2, 100, 'A', ''],  // 문장에 용어 0개 → 소분류명 누출 차단으로 무감점
    ['우편함 보상', '부정', 1, 60, 'C', 'R3,R5'], // 용어 1개 -25 + 단계 gap -15
    ['환전 비율', '정상', 1, 70, 'B', 'R4,R6'],
  ];
  for (const [n, st, no, score, grade, rs] of want) {
    const it = item(n, st, no);
    assert.ok(it, `${n} ${st}-${no} 없음`);
    assert.strictEqual(it.score, score, `${n} ${st}-${no} 점수 ${it.score} ≠ ${score}`);
    assert.strictEqual(it.grade, grade, `${n} ${st}-${no} 등급 ${it.grade} ≠ ${grade}`);
    assert.strictEqual(ids(it), rs, `${n} ${st}-${no} 규칙 [${ids(it)}] ≠ [${rs}]`);
  }
});

t('R5는 gap이 걸린 단계의 항목에만 붙는다', () => {
  assert.ok(!ids(item('우편함 보상', '정상', 1)).includes('R5'), '정상 항목에 부정 gap이 전이됨');
  assert.ok(ids(item('우편함 보상', '부정', 1)).includes('R5'), '부정 항목에 gap 미반영');
});

t('R2(이미지)는 소분류 전 항목에 상속된다', () => {
  const c = items.filter((i) => i.leaf.startsWith('쿠폰'));
  assert.strictEqual(c.length, 3);
  c.forEach((i) => assert.ok(i.reasons.some((r) => r.id === 'R2' && r.inherited), `${i.stage}-${i.no}`));
});

t('[J:추후구현] 항목은 등급 N (점수와 무관하게 채점 대상 제외)', () => {
  const n = items.filter((i) => i.unimplemented);
  assert.strictEqual(n.length, 1);
  assert.strictEqual(n[0].grade, 'N');
});

// ── 산식의 설계 결정 (2026-07-30 튜닝 — 바꾸려면 여기가 먼저 깨진다) ──────
t('R7은 배지다 — 점수에 영향을 주지 않는다 (d=0)', () => {
  const r7 = items.filter((i) => i.reasons.some((r) => r.id === 'R7'));
  assert.ok(r7.length > 0, 'R7이 아예 발화하지 않으면 이 성질을 확인할 수 없다');
  r7.forEach((i) => {
    const r = i.reasons.find((x) => x.id === 'R7');
    assert.strictEqual(r.d, 0, 'R7이 점수를 움직임');
    assert.strictEqual(r.badge, true);
  });
  assert.strictEqual(RULES.find((r) => r.id === 'R7').penalty, 0);
});

t('R3/R4 항목 매칭은 문장만 본다 — 소분류명이 근거로 새지 않는다', () => {
  const it = item('우편함 보상', '정상', 2);   // 본문: "수령 완료 후 목록이 갱신되는지"
  assert.ok(!/우편함|등급표|보상 수량/.test(it.text), '픽스처 전제: 이 문장에는 crossref 용어가 없다');
  assert.ok(it.leaf.includes('우편함'), '픽스처 전제: 소분류명에는 용어가 있다');
  assert.strictEqual(ids(it), '', '소분류명만으로 감점됨 — 누출 차단 실패');
});

t('R3/R4는 걸린 용어 수만큼 가중된다 (R5도 gap 건수만큼)', () => {
  assert.deepStrictEqual([1, 2, 3, 4, 9].map((n) => penaltyOf(RULES, 'R3', n)), [25, 33, 41, 45, 45]);
  assert.deepStrictEqual([1, 2, 3, 4, 9].map((n) => penaltyOf(RULES, 'R4', n)), [12, 17, 22, 25, 25]);
  assert.deepStrictEqual([1, 2, 9].map((n) => penaltyOf(RULES, 'R5', n)), [15, 30, 30]);
  ['R1', 'R2', 'R6'].forEach((id) => assert.strictEqual(
    penaltyOf(RULES, id, 7), penaltyOf(RULES, id, 1), `${id}는 건수와 무관해야 한다`));
});

t('용어 토큰화 — 한글 언더스코어는 쪼개고 영문 식별자는 보존', () => {
  const { tokenize } = compute(FIX);
  // 대조 에이전트가 `전투_처치_판정_시스템` 형태로 쓰는 런이 있다. 안 쪼개면 매칭 0 → 감점이
  // 조용히 사라진다(실측 1챕터 R3/R4 26.2%→0%, A 73.8%→96%).
  assert.deepStrictEqual(tokenize('전투_처치_판정_시스템'), ['전투', '처치', '판정']); // 시스템=스톱워드
  assert.deepStrictEqual(tokenize('기대결과_UI문구_토스트'), ['기대결과', 'UI문구', '토스트']);
  // 반대로 실제 식별자는 통째로 — 쪼개면 조각난 'UI'가 Sample_UI_Title 에 오매칭된다(과거 함정).
  ['WBP_BossEncounterIntro', 'MonsterNameUI_Open', 'Sample_UI_Title', 'Monster_Boss.xlsx']
    .forEach((w) => assert.deepStrictEqual(tokenize(w), [w], w));
});

t('locate(R4) 최대 감점이 keep(R3) 최소 감점을 넘지 않는다 (신호 강도 역전 금지)', () => {
  assert.ok(penaltyOf(RULES, 'R4', 99) <= penaltyOf(RULES, 'R3', 1),
    '위치라도 찾은 항목이 아예 못 찾은 항목보다 나쁘게 채점됨');
});

t('crossref 산출물이 없어도 채점한다 (crossref_brain=off 환경)', () => {
  const os = require('os'), fsx = require('fs');
  const d = fsx.mkdtempSync(path.join(os.tmpdir(), 'conf-off-'));
  ['tc_design.md', 'coverage_gaps.json'].forEach((f) => fsx.copyFileSync(path.join(FIX, f), path.join(d, f)));
  const r = computeItems(d);   // dxr_crossref.json · tc_skeleton.json 없음
  assert.strictEqual(r.items.length, 9);
  assert.ok(!r.items.some((i) => i.reasons.some((x) => x.id === 'R3' || x.id === 'R4')), 'crossref 없이 R3/R4 발화');
  fsx.rmSync(d, { recursive: true, force: true });
});

t('오버라이드는 원본 모델을 오염시키지 않는다 (스윕 안전성)', () => {
  const alt = computeItems(FIX, { rules: { R3: { penalty: 40 } } });   // 용어 2건 → min(40+8,45)=45
  assert.strictEqual(alt.items.find((i) => i.leaf.startsWith('우편함') && i.stage === '정상' && i.no === 1).score, 55);
  assert.strictEqual(item('우편함 보상', '정상', 1).score, 67, '기본 산출물이 변조됨');
  assert.strictEqual(RULES.find((r) => r.id === 'R3').penalty, 25, 'RULES 상수가 변조됨');
});

console.log(`결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
