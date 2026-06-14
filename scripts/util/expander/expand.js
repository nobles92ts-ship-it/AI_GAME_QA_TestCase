// expand.js — 결정론 전개기 드라이버 (Phase B: G1 EP + G2 BVA + G3 FSM + G4 MC/DC + G5 pairwise + G6 패턴 + G7 렌즈)
// EXPAND = Number ∘ Sort ∘ Ratio ∘ Dedup ∘ (G1∪…∪G7)   ※ Render 통합은 Phase C
// 결정론 보장: candidates.json 바이트가 같으면 출력 바이트가 같다 (난수·시계 사용 금지)
// CLI: node expand.js <candidates.json> [--out <dir>]  → exit 0 / 4(스키마 위반·항등식 불일치) / 1(IO)

const fs = require('fs');
const path = require('path');
const { validate } = require('./candidate_schema');
const { GEN_ORDER } = require('./pattern_catalog');
const g1 = require('./gen_ep');
const g2 = require('./gen_ep_bva');
const g3 = require('./gen_fsm');
const g4 = require('./gen_decision');
const g5 = require('./gen_pairwise');
const g6 = require('./gen_patterns');
const g7 = require('./gen_lenses');

// ρ: 부정+예외 하한 비율 (생성 항등식 neg ≥ ρ/(1−ρ)·pos). Phase A는 보고 전용 — Phase C에서 상수 단일화.
const RHO_DEFAULT = 0.49;

function expand(candidates, opts = {}) {
  const rho = opts.rho !== undefined ? opts.rho : RHO_DEFAULT;
  const schema = validate(candidates);
  if (!schema.ok) return { ok: false, schema };

  const subcatsByKey = new Map(candidates.subcats.map((s) => [s.key, s]));
  const subcatOrder = new Map(candidates.subcats.map((s, i) => [s.key, i]));

  // (G1∪…∪G7) — 생성기별 입력 순서 보존
  const outs = [
    g1.generate(candidates.ep, subcatsByKey),
    g2.generate(candidates.bva, subcatsByKey),
    g3.generate(candidates.fsm, subcatsByKey),
    g4.generate(candidates.decision, subcatsByKey),
    g5.generate(candidates.pairwise, subcatsByKey),
    g6.generate(candidates.patterns, subcatsByKey),
    g7.generate(candidates.lenses, subcatsByKey),
  ];
  const pairwiseRowCount = outs[4].cases.length; // G5 행수는 covering array 산출에서 확정
  const raw = outs.flatMap((o) => o.cases).map((c, i) => ({ ...c, _seq: i }));
  const skipped = outs.flatMap((o) => o.skipped);

  // Dedup — key: subcat|stage|정규화 목적. 먼저 온 케이스 생존 (입력 순서 기준 결정론)
  const seen = new Map();
  const dropped = [];
  for (const c of raw) {
    const key = `${c.subcat}|${c.stage}|${c.purpose.replace(/\s+/g, ' ').trim()}`;
    if (seen.has(key)) dropped.push({ key, trace: c.trace, kept_trace: seen.get(key).trace });
    else seen.set(key, c);
  }
  const deduped = [...seen.values()];

  // Ratio — 생성 항등식 선검사 (보고 전용): neg ≥ ρ/(1−ρ)·pos
  const pos = deduped.filter((c) => c.stage === '정상').length;
  const neg = deduped.length - pos;
  const required = Math.ceil((rho / (1 - rho)) * pos);
  const ratio = { rho, pos, neg, required_neg: required, satisfied: neg >= required, shortfall: Math.max(0, required - neg) };

  // Sort — 소분류 입력 순서 → 생성기 순서(G2<G3<G6) → 생성기 내 입력 순서 (전부 고정, 동률 불가)
  deduped.sort((a, b) =>
    subcatOrder.get(a.subcat) - subcatOrder.get(b.subcat)
    || GEN_ORDER[a.gen] - GEN_ORDER[b.gen]
    || a._seq - b._seq);

  // Number — 전역 순번 부여
  const cases = deduped.map((c, i) => {
    const { _seq, ...rest } = c;
    return { id: `EXP-${String(i + 1).padStart(3, '0')}`, ...rest };
  });

  // 케이스 수 항등식: N = ep + bva_points + transitions + mcdc + pairwise행 + patterns + lens − δ
  // (pairwise행만 생성 산출 — 나머지는 입력만으로 확정)
  const expected = schema.counts.ep_cases + schema.counts.bva_points + schema.counts.fsm_transitions
    + schema.counts.mcdc_cases + pairwiseRowCount + schema.counts.pattern_cases + schema.counts.lens_cases
    - dropped.length;
  const identity = { expected, actual: cases.length, match: expected === cases.length };

  // 배분표 projection — 케이스 배열에서 직접 사영 (별도 문서 아님 → 3자 동치 검사 불필요)
  const allotment = {};
  for (const c of cases) {
    if (!allotment[c.subcat]) allotment[c.subcat] = { 정상: 0, 부정: 0, 예외: 0 };
    allotment[c.subcat][c.stage]++;
  }

  return {
    ok: identity.match,
    meta: { feature: candidates.meta.feature, expander: 'phase-B', generators: ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'] },
    counts: schema.counts,
    identity,
    ratio,
    allotment,
    cases,
    skipped,
    dedup_dropped: dropped,
  };
}

module.exports = { expand, RHO_DEFAULT };

if (require.main === module) {
  const args = process.argv.slice(2);
  const file = args[0];
  const outIdx = args.indexOf('--out');
  if (!file) { console.error('usage: node expand.js <candidates.json> [--out <dir>]'); process.exit(1); }
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { console.error(`read/parse 실패: ${e.message}`); process.exit(1); }

  const r = expand(data);
  if (r.schema) { // 스키마 위반
    console.error(JSON.stringify(r.schema, null, 2));
    process.exit(4);
  }
  const outDir = outIdx >= 0 ? args[outIdx + 1] : path.dirname(file);
  const outFile = path.join(outDir, 'expanded_cases.json');
  fs.writeFileSync(outFile, JSON.stringify(r, null, 2), 'utf8');

  const stages = { 정상: 0, 부정: 0, 예외: 0 };
  r.cases.forEach((c) => stages[c.stage]++);
  console.log(JSON.stringify({
    ok: r.ok, out: outFile, total: r.cases.length, stages,
    identity: r.identity, ratio: { satisfied: r.ratio.satisfied, shortfall: r.ratio.shortfall },
    skipped: r.skipped.length, dedup_dropped: r.dedup_dropped.length,
  }, null, 2));
  process.exit(r.ok ? 0 : 4);
}
