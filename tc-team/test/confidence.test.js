'use strict';
// confidence_core.js 회귀 테스트 — 합성 픽스처로 R1~R7 을 알려진 위치에서 발화시켜
// 소분류·항목 점수를 정확히 잠근다. 산식을 튜닝하면 이 기대표를 함께 갱신해야 한다
// (= 점수가 바뀌는 변경은 반드시 눈에 보인다).
const assert = require('assert');
const path = require('path');
const { compute, computeItems, RULES, TUNING, penaltyOf, xrefPenalty, stampGate } = require('../scripts/confidence/confidence_core.js');

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
    ['우편함 보상', 47, 'D', 'R3,R4,R5'], // keep 2건 -(25+8) + locate 1건 -5(증분) + gap -15
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

t('keep과 locate는 각각 기록된다 (한쪽이 다른 쪽을 삼키지 않는다)', () => {
  // 2026-07-31 이전엔 `keep 있으면 R3, 아니면 R4` 배타 분기라, keep 이 하나라도 있으면
  // locate 는 점수에도 리포트에도 나타나지 않았다 — keep1 과 keep1+locate5 가 동점.
  const l = leaf('우편함 보상');
  const r3 = l.reasons.find((r) => r.id === 'R3');
  const r4 = l.reasons.find((r) => r.id === 'R4');
  assert.ok(r3 && r4, 'keep·locate 가 같이 있는 리프인데 한쪽만 기록됨');
  assert.ok(/초과 요청 차단 기준/.test(r4.detail), 'locate 용어가 detail 에 안 보임');
  assert.ok(r3.d < 0 && r4.d < 0, '기록만 되고 점수에 반영되지 않음');
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
    ['우편함 보상', '부정', 1, 55, 'C', 'R3,R4,R5'], // keep 1개 -25 + locate 1개 -5 + 단계 gap -15
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

t('R1만 걸려도 노란색(C) 이하 — 임의 판단 TC가 무색으로 남을 수 없다', () => {
  // 형근님 규칙(2026-07-31): 기획서에 없는 내용을 설계가 판단해 넣은 TC는 무조건 노란색 이상.
  // 집행 경로 = tc-설계 L3-7 이 그런 항목에 [J:기획 확인 필요] 를 달고 → 여기 R1 이 발화한다.
  // 시트 색은 confidence_apply.js 기준 D=빨강 · C=노랑 · A/B=무색이므로, 다른 감점이 하나도
  // 없는 만점 출발 TC조차 B 밴드 아래로 내려가야 규칙이 성립한다.
  // R1 penalty 를 31 미만으로 낮추면(=100-R1 이 70 이상) 색이 안 칠해지고 규칙이 조용히 깨진다.
  const best = 100 - penaltyOf(RULES, 'R1', 1);
  assert.ok(best < TUNING.bands.B,
    `R1만 걸린 TC가 ${best}점 — B(${TUNING.bands.B}) 이상이라 무색 처리됨`);
});

t('locate(R4) 최대 감점이 keep(R3) 최소 감점을 넘지 않는다 (신호 강도 역전 금지)', () => {
  assert.ok(penaltyOf(RULES, 'R4', 99) <= penaltyOf(RULES, 'R3', 1),
    '위치라도 찾은 항목이 아예 못 찾은 항목보다 나쁘게 채점됨');
});

t('총건수가 같으면 keep을 locate로 바꿀수록 좋아진다 (R3/R4 동시 발화 시 역전 금지)', () => {
  // R3·R4 를 각각 독립으로 더하면 keep1+locate1(-37) 이 keep2(-33) 보다 나빠진다.
  // locate 는 keep 보다 진전된 상태이므로 그럴 수 없다 — xrefPenalty 가 막는 지점.
  const tot = (k, l) => { const x = xrefPenalty(RULES, k, l); return x.r3 + x.r4; };
  for (let n = 1; n <= 8; n++) {
    for (let k = n; k > 0; k--) {
      assert.ok(tot(k, n - k) >= tot(k - 1, n - k + 1),
        `총 ${n}건에서 keep${k}(-${tot(k, n - k)}) 가 keep${k - 1}+locate${n - k + 1}(-${tot(k - 1, n - k + 1)}) 보다 관대함`);
    }
  }
  assert.ok(tot(1, 5) > tot(1, 0), 'keep1 에 locate 5건을 얹었는데 점수가 그대로 — 구 배타분기 회귀');
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

// ── 설계서 표기 흔들림 (2026-08-16 조용한 실패 회귀) ─────────────────────
// 실사고: 설계기가 트리를 **들여쓰기 없이** 냈는데 파서가 `^\s+`·`^\s{2,}` 를 요구해
//   leaves=[] → 점수 0건 · 색칠 0행 · 드리프트 218행. 그런데 rc=0 으로 FINAL-0:✓ 보고.
//   같은 파일을 읽는 validate_tc_rows.js(parseDesignTree)는 정상 처리해 앞 단계는 전부 통과했다.
// 이제 줄 모양 계약은 scripts/util/design_tree_lines.js 한 벌이다.
const mkSpec = (xform) => {
  const os = require('os'), fsx = require('fs');
  const d = fsx.mkdtempSync(path.join(os.tmpdir(), 'conf-fmt-'));
  fsx.readdirSync(FIX).forEach((f) => fsx.copyFileSync(path.join(FIX, f), path.join(d, f)));
  const p = path.join(d, 'tc_design.md');
  fsx.writeFileSync(p, xform(fsx.readFileSync(p, 'utf8')), 'utf8');
  return d;
};
const shape = (r) => r.items.map((i) => [i.leaf, i.stage, i.no, i.score, i.grade, ids(i)]);

t('들여쓰기 없는 설계서도 동일하게 채점된다 (CRLF 포함 — 실사고 재현형)', () => {
  const d = mkSpec((s) => s.split('\n').map((l) => l.replace(/^[ \t]+/, '')).join('\r\n'));
  const r = computeItems(d);
  assert.ok(r.items.length > 0, '들여쓰기 없는 설계에서 항목 0건 — 조용한 실패 재발');
  assert.strictEqual(r.scored.length, scored.length, `소분류 ${r.scored.length} ≠ ${scored.length}`);
  assert.deepStrictEqual(shape(r), shape({ items }), '들여쓰기 유무가 점수를 바꿈');
  require('fs').rmSync(d, { recursive: true, force: true });
});

// 트리 섹션 안의 줄만 건드린다 — 마크다운 표(`|`)는 열 0 이 문법이라 통째 들여쓰면 표가 깨진다.
const inTree = (s, f) => {
  let on = false;
  return s.split('\n').map((l) => {
    if (/^\s*##\s/.test(l)) { on = /분류\s*그룹핑\s*트리/.test(l); return l; }
    return on && l.trim() ? f(l) : l;
  }).join('\n');
};

t('들여쓰기를 더 넣어도 동일하게 채점된다 (양방향)', () => {
  const d = mkSpec((s) => inTree(s, (l) => '        ' + l.trim()));
  const r = computeItems(d);
  assert.ok(r.items.length > 0, '깊게 들여쓴 설계에서 항목 0건');
  assert.deepStrictEqual(shape(r), shape({ items }));
  require('fs').rmSync(d, { recursive: true, force: true });
});

t('두 파서(확신도 · validate_tc_rows)가 같은 항목 집합을 본다', () => {
  // 계약이 갈라진 게 실사고의 구조적 원인 — 표기가 흔들려도 둘의 (소분류,단계,순번)이 같아야 한다.
  const { parseDesignTree } = require(path.resolve(__dirname, '../../scripts/util/validate_tc_rows.js'));
  const fsx = require('fs');
  const key = (a) => a.slice().sort().join('|');
  [(s) => s, (s) => s.split('\n').map((l) => l.replace(/^[ \t]+/, '')).join('\r\n')].forEach((xform, n) => {
    const md = xform(fsx.readFileSync(path.join(FIX, 'tc_design.md'), 'utf8'));
    const v = parseDesignTree(md, { strict: false }).leaves.map((l) => `${l.cat3}\0${l.stage}\0${l.seq}`);
    const d = mkSpec(() => md);
    const c = computeItems(d).items.map((i) => `${i.leaf}\0${i.stage}\0${i.no}`);
    assert.strictEqual(key(c), key(v), `표기 ${n === 0 ? '들여쓰기 있음' : '없음'}에서 두 파서가 불일치`);
    fsx.rmSync(d, { recursive: true, force: true });
  });
});

// ── 조용한 실패 차단 (stampGate) ────────────────────────────────────────
t('항목 0건이면 스탬핑 게이트가 막는다 (경고 아님)', () => {
  const g = stampGate({ items: 0 });
  assert.strictEqual(g.ok, false);
  assert.strictEqual(g.code, 'no_items');
});

t('드리프트가 과반이면 게이트가 막는다 / 절반 이하는 통과', () => {
  assert.strictEqual(stampGate({ items: 9, matched: 0, drift: 218 }).code, 'drift'); // 실사고 수치
  assert.strictEqual(stampGate({ items: 9, matched: 99, drift: 100 }).code, 'drift');
  assert.strictEqual(stampGate({ items: 9, matched: 100, drift: 100 }).ok, true);    // 정확히 50%는 통과
  assert.strictEqual(stampGate({ items: 9, matched: 200, drift: 3 }).ok, true);
});

t('정상 픽스처는 게이트를 통과한다 (게이트가 정상 런을 막지 않는다)', () => {
  assert.strictEqual(stampGate({ items: items.length, matched: items.length, drift: 0 }).ok, true);
});

t('오버라이드는 원본 모델을 오염시키지 않는다 (스윕 안전성)', () => {
  const alt = computeItems(FIX, { rules: { R3: { penalty: 40 } } });   // 용어 2건 → min(40+8,45)=45
  assert.strictEqual(alt.items.find((i) => i.leaf.startsWith('우편함') && i.stage === '정상' && i.no === 1).score, 55);
  assert.strictEqual(item('우편함 보상', '정상', 1).score, 67, '기본 산출물이 변조됨');
  assert.strictEqual(RULES.find((r) => r.id === 'R3').penalty, 25, 'RULES 상수가 변조됨');
});

console.log(`결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
