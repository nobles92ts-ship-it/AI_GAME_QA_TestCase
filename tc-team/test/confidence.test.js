'use strict';
// confidence_core.js 회귀 테스트 — 합성 픽스처로 R1~R7 을 알려진 위치에서 발화시켜
// 소분류·항목 점수를 정확히 잠근다. 산식을 튜닝하면 이 기대표를 함께 갱신해야 한다
// (= 점수가 바뀌는 변경은 반드시 눈에 보인다).
const assert = require('assert');
const path = require('path');
const { compute, computeItems, RULES, TUNING, penaltyOf, xrefPenalty, stampGate, mapRowsToItems } = require('../scripts/confidence/confidence_core.js');

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
    ['쿠폰 코드', 55, 'C', 'R1,R2'],     // 미결 질의 -45, 이미지 의존 = 배지(0) — 2026-09-11 R2 강등 전엔 -20 → 35 D
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
    // 쿠폰 3건 — 2026-09-11 R2 배지 강등으로 각 +20 (35 D→55 C · 80 B→100 A · 80 N→100 N). R2 는 배지로 남는다.
    ['쿠폰 코드', '정상', 1, 55, 'C', 'R1,R2'],
    ['쿠폰 코드', '정상', 2, 100, 'A', 'R2'],
    ['쿠폰 코드', '정상', 3, 100, 'N', 'R2'],   // [J:추후구현] → 등급 N
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

t('R2 는 배지다 — 감점하지 않고 표시만 남는다 (2026-09-11 강등)', () => {
  const all = [...scored.flatMap((s) => s.reasons), ...items.flatMap((i) => i.reasons)].filter((r) => r.id === 'R2');
  assert.ok(all.length > 0, 'R2 가 아예 사라지면 QA 지침(그림 대조)도 사라진다');
  assert.ok(all.every((r) => r.d === 0), 'R2 가 점수를 깎았다');
});

t('R2 되살림 오버라이드 — penalty 20 이면 종전 점수(쿠폰 정상-1 35 D)로 돌아간다', () => {
  const old = computeItems(FIX, { rules: { R2: { penalty: 20 } } }).items.find((i) => i.leaf.startsWith('쿠폰') && i.stage === '정상' && i.no === 1);
  assert.strictEqual(old.score, 35);
  assert.strictEqual(old.grade, 'D');
  assert.strictEqual(old.reasons.find((r) => r.id === 'R2').d, -20);
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
  ['WBP_BossEncounterIntro', 'MonsterNameUI_Open', 'Sample_UI_Title', 'Sample_Boss.xlsx']
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

// ── 2026-09-08 수리 회귀 2건 ────────────────────────────────────────────
t('gap 은 배열 위치가 아니라 선언된 이름으로 소분류에 붙는다', () => {
  // 구 코드: floor_by_subcat 키 순서 = 리프 순서로 보고 keys[i] → leaves[i] 로 이었다.
  // 설계가 소분류를 병합·재배열하면 통째로 밀린다 — 전 스펙 실측 166건 중 76건 오귀속.
  // 픽스처는 mail_reward 를 키 0번에 두었으므로, 위치 조인이면 gap 이 '우편 배너'에 붙는다.
  assert.ok(leaf('우편함 보상').reasons.some((r) => r.id === 'R5'), 'gap 이 자기 소분류에 안 붙음');
  assert.ok(!leaf('우편 배너').reasons.some((r) => r.id === 'R5'), '위치 조인 회귀 — gap 이 남의 소분류에 붙음');
});

t('이름·근접도 어느 쪽으로도 못 정한 gap 은 gapUnmapped 로 드러난다', () => {
  // 붙이지 않는 것 자체는 맞지만 **조용히** 사라지면 안 된다 — 그 화면은 커버리지 구멍이
  // 점수에 안 잡힌 상태다. confidence_apply 가 이 목록을 완료 보고 요약 라인으로 올린다.
  const os = require('os'), fsx = require('fs');
  const d = fsx.mkdtempSync(path.join(os.tmpdir(), 'conf-unmapped-'));
  fsx.readdirSync(FIX).forEach((f) => fsx.copyFileSync(path.join(FIX, f), path.join(d, f)));
  fsx.rmSync(path.join(d, 'candidates.json'));   // 이름 경로 없음 + gap 에 nearest_design 없음
  const r = computeItems(d);
  assert.deepStrictEqual(r.gapUnmapped, ['mail_reward'], '미부착 gap 이 보고되지 않음');
  assert.ok(!r.items.some((i) => i.reasons.some((x) => x.id === 'R5')), '못 정했는데 R5 가 붙음');
  assert.deepStrictEqual(computeItems(FIX).gapUnmapped, [], '정상 픽스처에서 미부착이 잡힘(오탐)');
  fsx.rmSync(d, { recursive: true, force: true });
});

t("용어 이름에 ' / ' 가 있어도 항목 감점이 소분류 감점을 넘지 않는다", () => {
  // 구 코드: 소분류 detail 문자열을 ' / ' 로 되쪼개 용어를 복원 → 이름에 구분자가 든 용어가
  // 여러 건으로 불어나 건수 스케일링이 상한까지 뛴다(장비 아이템 비교 TC 037: 소분류 -33 / 항목 -45).
  const os = require('os'), fsx = require('fs');
  const d = fsx.mkdtempSync(path.join(os.tmpdir(), 'conf-slash-'));
  fsx.readdirSync(FIX).forEach((f) => fsx.copyFileSync(path.join(FIX, f), path.join(d, f)));
  fsx.writeFileSync(path.join(d, 'dxr_crossref.json'), JSON.stringify({
    items: [{ term: '우편함 등급표 / 보상 수량 상한 / 환전 수수료', branch: 'keep' }],
  }), 'utf8');
  const lf = compute(d).scored.find((x) => x.name.startsWith('우편함 보상'));
  const it = computeItems(d).items.find((x) => x.leaf.startsWith('우편함 보상') && x.stage === '정상' && x.no === 1);
  const r3 = (o) => Math.abs((o.reasons.find((r) => r.id === 'R3') || { d: 0 }).d);
  assert.strictEqual(r3(lf), penaltyOf(RULES, 'R3', 1), '소분류가 용어 1건으로 안 세짐');
  assert.ok(r3(it) <= r3(lf), `항목 R3 -${r3(it)} 가 소분류 -${r3(lf)} 를 초과 — 구분자 되쪼개기 회귀`);
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

// ── 행 매핑 (mapRowsToItems) — 2026-09-04 오채점 사고 고정 ──────────────
// 시트 행: [TC ID, 대분류, 중분류, 소분류, 검증단계, …] — B/C/D는 그룹 첫 행에만 값
const HDR = ['TC ID', '대분류', '중분류', '소분류', '검증단계'];
const IT = (mid, leaf, stage, no) => ({ mid, leaf, stage, no });

t('같은 소분류명이 다른 중분류 아래 있으면 각자의 설계 항목에 붙는다 (오채점 금지)', () => {
  const items = [IT('던전 화면 진입', '던전 초기 화면', '정상', 1), IT('ESC 키', '던전 초기 화면', '정상', 1)];
  const rows = [HDR,
    ['001', '던전 메뉴 진입', '던전 화면 진입', '던전 초기 화면', '정상'],
    ['002', '화면 종료 키 입력', 'ESC 키', '던전 초기 화면', '정상'],
  ];
  const { perRow, drift } = mapRowsToItems(rows, items);
  assert.strictEqual(drift.length, 0);
  assert.strictEqual(perRow[0].it.mid, '던전 화면 진입');
  assert.strictEqual(perRow[1].it.mid, 'ESC 키', '뒤 구간이 앞 구간 설계 항목에 붙었다');
});

t('설계서에 없는 중분류의 행은 폴백 없이 드리프트로 잡힌다 (모호할 때 조용히 붙지 않는다)', () => {
  const items = [IT('던전 화면 진입', '던전 초기 화면', '정상', 1), IT('ESC 키', '던전 초기 화면', '정상', 1)];
  const rows = [HDR, ['001', '화면 종료 키 입력', '뒤로가기 키', '던전 초기 화면', '정상']];
  const { perRow, drift } = mapRowsToItems(rows, items);
  assert.strictEqual(perRow.length, 0);
  assert.strictEqual(drift.length, 1);
});

t('소분류명이 유일하면 중분류가 달라도 구 키로 폴백한다 (하위호환)', () => {
  const items = [IT('설계서 중분류명', '남은 시간 표시 영역 화면', '정상', 1)];
  const rows = [HDR, ['001', '하단 정보 영역', '시트 중분류명', '남은 시간 표시 영역 화면', '정상']];
  const { perRow, drift } = mapRowsToItems(rows, items);
  assert.strictEqual(drift.length, 0, '기존 런(설계서·시트 중분류명 불일치)이 깨졌다');
  assert.strictEqual(perRow[0].it.no, 1);
});

t('중분류가 바뀌면 구간이 끊겨 검증단계 순번이 1부터 다시 센다', () => {
  const items = [IT('ESC 키', '팝업 화면', '정상', 1), IT('뒤로가기 키', '팝업 화면', '정상', 1)];
  const rows = [HDR,
    ['001', '화면 종료 키 입력', 'ESC 키', '팝업 화면', '정상'],
    ['002', '', '뒤로가기 키', '팝업 화면', '정상'],
  ];
  const { perRow, drift } = mapRowsToItems(rows, items);
  assert.strictEqual(drift.length, 0);
  assert.deepStrictEqual(perRow.map((p) => p.it.mid), ['ESC 키', '뒤로가기 키']);
});

t('기본기능 섹션은 매핑 대상이 아니다 (드리프트로도 안 잡힌다)', () => {
  const items = [IT('던전 메뉴 진입', '게임 메뉴 화면', '정상', 1)];
  const rows = [HDR,
    ['001', '기본기능', '던전 메뉴 진입', '게임 메뉴 화면', '정상'],
    ['002', '던전 메뉴 진입', '게임 메뉴 진입', '게임 메뉴 화면', '정상'],
  ];
  const { perRow, drift } = mapRowsToItems(rows, items);
  assert.strictEqual(drift.length, 0);
  assert.strictEqual(perRow.length, 1);
  assert.strictEqual(perRow[0].tcid, '002');
});

// ── 원문 직접 근거 대조 (2026-09-11) ────────────────────────────────────
// 「기획서에 있으면 무시하세요」로 떠넘기던 확인을 도구가 한다. 원문 한 칸에 TC 문장이 거의 그대로
// 있으면 R2·R3 는 참고(감점 0)로 돌리고, R1 은 절대 빼지 않는다.
{
  const { docCells, groundOf, STOP_BASE } = require('../scripts/confidence/confidence_core.js');
  const stop = new Set([...STOP_BASE, '선택', '상태', '버튼', '경우', '던전']);
  // 실물(기능A §2-1 L80)을 그대로 옮긴 행
  const L80 = '## 2-1. 정예 던전 화면\n| 던전 입장 버튼 | 해당 버튼 클릭 시, 해당 맵의 StartPos 좌표로 이동합니다.  다음과 같은 경우 Dimmed 처리하며, 클릭 시 케이스에 맞는 토스트 메시지를 출력합니다.   * 선택한 던전의 남은 시간 및 충전 시간의 합이 0 초인 경우   + 이용 가능한 시간이 남아있지 않습니다. * PC 전투력이 선택한 던전의 요구 전투력 미만인 경우   + 전투력 {0} 달성 시 입장할 수 있습니다. * 두 조건을 모두 만족하지 않는 경우 전투력 부족 토스트만 출력합니다. |';
  const cells = docCells(L80, stop);

  t('원문 근거 — 양성: TC 142 문장이 §2-1 「던전 입장 버튼」 칸에 잡힌다', () => {
    const g = groundOf('남은 시간과 충전 시간의 합이 0초이면서 플레이어 캐릭터의 전투력도 요구 전투력 미만인 상태에서 던전 입장 버튼을 선택하면 전투력 부족 토스트 메시지만 출력되는지', cells, stop);
    assert.ok(g.cov >= TUNING.groundThreshold, `cov=${g.cov}`);
    assert.strictEqual(g.sec, '2-1');
    assert.strictEqual(g.label, '던전 입장 버튼');
    assert.ok(/전투력 부족 토스트만/.test(g.quote), g.quote);
  });

  t('원문 근거 — 음성: 원문에 없는 주제는 판정선을 못 넘는다', () => {
    const g = groundOf('파티원이 탈퇴하면 보상 분배 비율이 다시 계산되는지', cells, stop);
    assert.ok(g.cov < TUNING.groundThreshold, `cov=${g.cov}`);
  });

  t('원문 근거 — 내용어 3개 미만은 판정하지 않는다(null)', () => {
    assert.strictEqual(groundOf('버튼이 선택되는지', cells, stop), null);
  });

  t('원문 근거 — confluence_raw.md 가 없으면 대조를 쉬고 점수는 종전 그대로', () => {
    const { items: its, diag } = computeItems(FIX);
    assert.strictEqual(diag.groundCells, 0);
    assert.ok(its.every((i) => i.ground === null));
    assert.ok(its.every((i) => !i.reasons.some((r) => r.waived)));
  });

  // 통합 — 픽스처 + 원문 한 장
  const os = require('os'), fsx = require('fs');
  const d = fsx.mkdtempSync(path.join(os.tmpdir(), 'conf-ground-'));
  fsx.readdirSync(FIX).forEach((f) => fsx.copyFileSync(path.join(FIX, f), path.join(d, f)));
  fsx.writeFileSync(path.join(d, 'confluence_raw.md'), [
    '## 2-1. 쿠폰',
    '| 쿠폰 코드 입력 | 쿠폰 코드는 12자리 입력을 수용합니다. * 오입력 시 안내 문구를 노출합니다. |',
    '## 3-1. 보상',
    '| 보상 수령 | 등급표에 따른 보상 수량을 지급합니다. * 보상 수량 초과 요청은 차단합니다. |',
  ].join('\n'), 'utf8');
  const G = computeItems(d).items;
  const gi = (n, stage, no) => G.find((i) => i.leaf.startsWith(n) && i.stage === stage && i.no === no);
  fsx.rmSync(d, { recursive: true, force: true });

  // (2026-09-11 R2 배지 강등 뒤로는 R2 가 원래 0 이라 점수는 근거 여부와 무관하게 55 — 이 테스트는 이제
  //  「근거가 잡히면 R2 를 참고로 표시하고, R1 은 절대 빠지지 않는다」만 잠근다)
  t('원문 근거 — R2 는 참고로 표시하고 R1 은 남는다 (쿠폰 정상-1: 55)', () => {
    const i = gi('쿠폰', '정상', 1);
    assert.strictEqual(i.score, 55);
    assert.ok(i.reasons.some((r) => r.id === 'R1' && r.d < 0), 'R1 이 빠지면 안 된다');
    assert.ok(i.reasons.some((r) => r.id === 'R2' && r.d === 0 && r.waived));
    assert.strictEqual(i.ground.sec, '2-1');
  });

  t('원문 근거 — R3 는 참고로 돌리고 용어는 지우지 않는다 (보상 정상-1: 67 → 100)', () => {
    const i = gi('우편함', '정상', 1);
    assert.strictEqual(i.score, 100);
    const r3 = i.reasons.find((r) => r.id === 'R3');
    assert.ok(r3 && r3.waived && r3.d === 0 && r3.terms.length > 0);
  });

  t('원문 근거 — keep 이 빠지면 locate 는 기준 감점을 다시 문다 (보상 부정-1: 55 → 73)', () => {
    // 종전: R5 −15 · R3 −25 · R4 −5(keep 이 기준 선점 → 증분만) = 55
    // 근거: R3 참고 → R4 는 keep 없는 기준 −12 로 재계산 · R5 그대로 = 73
    const i = gi('우편함', '부정', 1);
    assert.strictEqual(i.score, 73);
    assert.strictEqual(i.reasons.find((r) => r.id === 'R4').d, -12);
    assert.strictEqual(i.reasons.find((r) => r.id === 'R5').d, -15);
  });

  t('원문 근거 — 원문에 없는 TC 는 종전 감점 그대로 (환전 정상-1: 70)', () => {
    const i = gi('환전', '정상', 1);
    assert.strictEqual(i.score, 70);
    assert.strictEqual(i.ground, null);
  });
}

// ── 문장형 미정 항목은 자기 TC 에만 (2026-09-11) ─────────────────────────
// 문장 통째(…는지 확인)는 흔한 단어가 많아 낱말 기준으로 옆 TC 에까지 붙는다(기능A 99% D).
{
  const { isSentenceTerm } = require('../scripts/confidence/confidence_core.js');

  t('문장형 분류 — 어미로만 가른다 (긴 명사구는 낱말형)', () => {
    assert.strictEqual(isSentenceTerm('난이도 버튼을 다시 선택하면 흰색 테두리가 그대로 유지되는지 확인'), true);
    assert.strictEqual(isSentenceTerm('남은 시간이 0인 카드에서 0으로 표기되는지'), true);
    assert.strictEqual(isSentenceTerm('파티 획득 알림 유지 시간 확정값 (DA_UIData LootingUIDelay)'), false);
    assert.strictEqual(isSentenceTerm('남은 시간 표현 공통 규칙'), false);
  });

  const os = require('os'), fsx = require('fs');
  const d = fsx.mkdtempSync(path.join(os.tmpdir(), 'conf-sent-'));
  fsx.readdirSync(FIX).forEach((f) => fsx.copyFileSync(path.join(FIX, f), path.join(d, f)));
  const xr = JSON.parse(fsx.readFileSync(path.join(d, 'dxr_crossref.json'), 'utf8'));
  const OWN = '등급표에 따른 보상 수량이 지급되는지 확인';               // 자기 TC = 우편함 정상-1
  const ORPHAN = '우편함이 가득 찬 상태에서 보상을 수령하면 대기열에 쌓이는지 확인'; // 자기 TC 없음
  xr.items.push({ term: OWN, branch: 'keep', source: '' }, { term: ORPHAN, branch: 'keep', source: '' });
  fsx.writeFileSync(path.join(d, 'dxr_crossref.json'), JSON.stringify(xr), 'utf8');
  const on = computeItems(d);
  const off = computeItems(d, { sentenceOwnOnly: false });
  fsx.rmSync(d, { recursive: true, force: true });
  const r3terms = (res, n, stage, no) => {
    const i = res.items.find((x) => x.leaf.startsWith(n) && x.stage === stage && x.no === no);
    return ((i.reasons.find((r) => r.id === 'R3') || {}).terms) || [];
  };
  const hasOwn = (arr) => arr.some((x) => x.startsWith('등급표에 따른 보상 수량'));

  t('문장형 — 자기 TC(우편함 정상-1)에는 붙는다', () => {
    assert.ok(hasOwn(r3terms(on, '우편함', '정상', 1)));
  });

  t('문장형 — 흔한 단어(보상·수량)를 공유하는 옆 TC(우편함 부정-1)에는 안 붙는다', () => {
    assert.ok(!hasOwn(r3terms(on, '우편함', '부정', 1)));
  });

  t('문장형 — 자기 TC 가 없으면 어디에도 안 붙고 diag.sentenceOrphans 로 드러난다', () => {
    assert.ok(on.items.every((i) => !((i.reasons.find((r) => r.id === 'R3') || {}).terms || []).some((x) => x.startsWith('우편함이 가득'))));
    assert.deepStrictEqual(on.diag.sentenceOrphans, [ORPHAN]);
    assert.strictEqual(on.diag.sentenceTerms, 2);
  });

  t('문장형 — 스위치를 끄면 구 방식(흔한 단어로 옆 TC 에도 붙음)으로 돌아간다', () => {
    assert.ok(hasOwn(r3terms(off, '우편함', '부정', 1)), '구 방식 재현이 안 되면 sweep 비교가 무의미하다');
    assert.deepStrictEqual(off.diag.sentenceOrphans, []);
  });
}

console.log(`결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
