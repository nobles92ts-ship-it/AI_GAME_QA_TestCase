#!/usr/bin/env node
/**
 * sweep.js — 확신도 산식 오프라인 스윕 (튜닝 근거 생성기)
 *
 * 확신도는 LLM 0회 결정론이라, 과거 런의 산출물만 있으면 산식 변형의 효과를
 * 배포 없이 전수 측정할 수 있다. RULES/TUNING 값을 손대기 전에 이걸 먼저 돌린다.
 *
 *   node sweep.js                     # 기본 변형 세트
 *   node sweep.js --specs <dir>       # 런 모음 디렉토리 (기본: <repo>/team/specs)
 *
 * 읽기 전용 — 어떤 파일도 쓰지 않는다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const core = require('./confidence_core.js');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SPECS_DIR = arg('--specs', process.env.TCV2_SPECS_DIR
  || path.resolve(__dirname, '..', '..', '..', 'team', 'specs'));
const ONLY_XREF = process.argv.includes('--with-crossref');
const SPECS = (fs.existsSync(SPECS_DIR) ? fs.readdirSync(SPECS_DIR) : []).filter((d) =>
  fs.existsSync(path.join(SPECS_DIR, d, 'tc_design.md'))
  && (!ONLY_XREF || fs.existsSync(path.join(SPECS_DIR, d, 'dxr_crossref.json'))));
if (!SPECS.length) { console.error(`런을 찾지 못함: ${SPECS_DIR}`); process.exit(1); }
const NX = SPECS.filter((d) => fs.existsSync(path.join(SPECS_DIR, d, 'dxr_crossref.json'))).length;

// 비교할 변형. 키 = 라벨, 값 = compute() 오버라이드.
const VARIANTS = {
  '현재 기본값': {},
  '소분류명 누출 복원': { itemXrefHaystack: 'text+leaf' },
  'R3/R4 스케일링 제거': { rules: { R3: { per: 0 }, R4: { per: 0 } } },
  '항목 매칭 임계 2토큰': { itemXrefMinTokens: 2 },
  '밴드 A90/B75/C55': { bands: { A: 90, B: 75, C: 55 } },
  // 2026-09-11 신설 — R2 는 '기획서가 그림뿐인가'가 아니라 '설계기가 마커를 달았는가'를 잰다.
  // 같은 Confluence 페이지(402948225)를 두 번 돌린 파티_보상_분배_시스템 v1/v2 에서
  // 마커 17건→0건, R2 발화 80%→0% 로 뒤집혔다. 재현되지 않는 축을 점수에서 빼면 어떻게 되나.
  // 2026-09-11 — R2 배지 강등이 기본값이 됐다(오너 결정). 되살리면 구 방식과 비교된다.
  'R2 감점 되살림(구 방식)': { rules: { R2: { penalty: 20 } } },
  // 2026-09-11 — 원문 직접 근거 대조가 기본값이 됐다. 끄면 구 방식(대조 없음)과 비교된다.
  '원문 근거 대조 끔(구 방식)': { groundThreshold: 1.01 },
  // 2026-09-11 — 문장형 미정 항목(…는지 확인)을 자기 TC 에만 붙이는 것이 기본값이 됐다.
  '문장형 용어 자기 TC 한정 끔(구 방식)': { sentenceOwnOnly: false },
};

const RIDS = core.RULES.map((r) => r.id);
function stat(items) {
  const g = {}, hist = {}, fire = {};
  const gr = items.filter((i) => i.grade !== 'N');
  items.forEach((i) => { g[i.grade] = (g[i.grade] || 0) + 1; i.reasons.forEach((r) => { fire[r.id] = (fire[r.id] || 0) + 1; }); });
  gr.forEach((i) => { hist[i.score] = (hist[i.score] || 0) + 1; });
  const n = gr.length, v = Object.values(hist).sort((a, b) => b - a);
  return { g, fire, n, t: items.length, distinct: Object.keys(hist).length,
    top2: (v[0] + (v[1] || 0)) / n, avg: gr.reduce((s, i) => s + i.score, 0) / n };
}

const base = [];
const rows = [];
for (const [label, cfg] of Object.entries(VARIANTS)) {
  const items = SPECS.flatMap((s) => {
    try { return core.computeItems(path.join(SPECS_DIR, s), cfg).items; } catch (e) { return []; }
  });
  if (!base.length) base.push(...items);
  let moved = 0;
  items.forEach((x, i) => { if (base[i] && base[i].grade !== 'N' && base[i].grade !== x.grade) moved++; });
  rows.push({ label, moved, ...stat(items) });
}

const p = (x, t) => ((x || 0) / t * 100).toFixed(1).padStart(5);
console.log(`런 ${SPECS.length}개 (crossref 보유 ${NX}개) / TC ${rows[0].t}   ${SPECS_DIR}`);
if (!ONLY_XREF && NX < SPECS.length) console.log(`  ※ R3/R4 튜닝은 --with-crossref 로 ${NX}개만 보는 편이 정확하다 (나머지는 대조 신호 자체가 없음)`);
console.log('');
console.log('  A     B     C     D   │ 평균  단계  상위2 │ 이동 │ 변형');
console.log('─'.repeat(76));
for (const r of rows) {
  console.log(`${p(r.g.A, r.t)} ${p(r.g.B, r.t)} ${p(r.g.C, r.t)} ${p(r.g.D, r.t)} │ ${r.avg.toFixed(1).padStart(5)} ${String(r.distinct).padStart(5)} ${p(r.top2, 1)} │ ${String(r.moved).padStart(4)} │ ${r.label}`);
}
console.log('\n규칙 발화율 (%)');
console.log('  ' + RIDS.map((x) => x.padStart(6)).join('') + '   변형');
for (const r of rows) console.log('  ' + RIDS.map((id) => p(r.fire[id], r.t) + ' ').join('') + '  ' + r.label);
console.log('\n단계 = 서로 다른 점수 값의 개수(해상도) / 상위2 = 최빈 점수 2개가 차지하는 비중(낮을수록 분산)');
