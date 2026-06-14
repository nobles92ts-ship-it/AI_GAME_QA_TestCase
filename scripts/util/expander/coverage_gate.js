// coverage_gate.js — 전개기 완전성 게이트 (STEP 2 설계검수 입력, 2026-06-13)
// 모델: 결정론 바닥(floor) + LLM 판정. 전개기가 "반드시 있어야 할" 케이스를 결정론으로 깔고,
//   설계(tc_design.md)가 그 바닥을 충족하는지 검사 → 미충족 = 잠재 누락을 reviewer에게 advisory로 제시.
// ⚠ 교체 아님 — 설계는 바닥 위에 도메인 케이스를 자유롭게 더함(전개기가 못 만드는 G0 등). 게이트는 빼지 않음.
// 비차단: exit 항상 0 (reviewer가 각 gap을 확인/기각 + 근거. precheck와 동일 패턴).
// CLI: node coverage_gate.js <candidates.json> <tc_design.md> [--out <coverage_gaps.json>] [--threshold 0.18]
//
// ⚠ 검출 범위 (정직): 텍스트 유사도(자카드) 기반이라 **distinctive 누락**(형제 케이스와 토큰이 다른 것
//   — dup_event·FSM 엣지·렌즈 신규축 등)은 잘 잡지만, **형제와 토큰이 거의 같은 단일 경계점 누락**
//   (예: min/max는 있고 max+1만 빠짐)은 소분류명·지표 토큰이 매칭을 구제해 놓칠 수 있다. 후자는
//   설계검수 C-05 분모 완전성(LLM)이 보완. 게이트는 "큰 체계적 누락"의 결정론 1차 그물.

const fs = require('fs');
const path = require('path');
const { expand } = require('./expand');
const { compare } = require('./shadow_compare');

// gen → 사람이 읽는 근거 라벨 (reviewer가 어느 분석 축에서 온 바닥인지 알도록)
const GEN_SOURCE = {
  G1: 'B-3 EP 무효 파티션', G2: 'B-4 BVA 경계', G3: 'B-5 상태 전이(all-edges)',
  G4: 'B-6 결정 테이블(MC/DC)', G5: 'B-6 조합(pairwise)', G6: 'B-8 오류 패턴', G7: 'B-9 렌즈',
};

function buildGate(candidates, designMd, threshold) {
  const expanded = expand(candidates);
  if (expanded.schema && !expanded.schema.ok) {
    return { ok: false, schema_error: expanded.schema, gaps: [], summary: {} };
  }
  const cmp = compare(expanded, designMd, threshold);

  // 미매칭 전개기 케이스 = 설계가 바닥을 충족 못 한 잠재 누락
  const gaps = cmp.matches.filter((m) => !m.matched).map((m) => ({
    subcat: expanded.cases.find((c) => c.id === m.id).subcat,
    gen: m.gen,
    stage: m.stage,
    source: GEN_SOURCE[m.gen] || m.gen,
    floor_case: m.purpose,
    nearest_design: m.leaf ? { line: m.leaf.line, stage: m.leaf.stage, text: m.leaf.text.slice(0, 80) } : null,
    nearest_score: m.score,
  }));

  // 소분류×단계 바닥 카운트 요약 (coarse — 리뷰어 컨텍스트용)
  const floor = {};
  for (const c of expanded.cases) {
    floor[c.subcat] = floor[c.subcat] || { 정상: 0, 부정: 0, 예외: 0 };
    floor[c.subcat][c.stage]++;
  }

  return {
    ok: gaps.length === 0,
    summary: {
      expander_floor: cmp.expander.total,
      floor_met: cmp.expander.matched,
      gaps: gaps.length,
      design_total: cmp.design.total,
      threshold: cmp.threshold,
      generators: expanded.meta.generators,
    },
    floor_by_subcat: floor,
    gaps,
  };
}

module.exports = { buildGate };

if (require.main === module) {
  const args = process.argv.slice(2);
  const [candFile, designFile] = args;
  if (!candFile || !designFile) {
    console.error('usage: node coverage_gate.js <candidates.json> <tc_design.md> [--out <file>] [--threshold 0.18]');
    process.exit(1);
  }
  const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
  let candidates, designMd;
  try {
    candidates = JSON.parse(fs.readFileSync(candFile, 'utf8'));
    designMd = fs.readFileSync(designFile, 'utf8');
  } catch (e) { console.error(`read/parse 실패: ${e.message}`); process.exit(1); }

  const r = buildGate(candidates, designMd, parseFloat(opt('--threshold', '0.18')));
  const out = opt('--out', path.join(path.dirname(candFile), 'coverage_gaps.json'));
  fs.writeFileSync(out, JSON.stringify(r, null, 2), 'utf8');
  console.log(JSON.stringify({ ok: r.ok, out, summary: r.summary,
    gap_subcats: [...new Set(r.gaps.map((g) => g.subcat))] }, null, 2));
  process.exit(0); // 항상 0 — advisory (비차단)
}
