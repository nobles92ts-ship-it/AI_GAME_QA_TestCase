// shadow_compare.js — 전개기 출력 ↔ 실제 설계(tc_design.md) 섀도 대조 리포트
// 목적: Phase A/B 게이트 — 전개기가 골든 설계의 어느 케이스를 재현/누락하는지 정량 보고.
// 매칭: 결정론 토큰 중첩(자카드 유사) — LLM 판단 없음. 보고 전용 (exit 0 고정, 대조 실패는 수치로 표현).
// CLI: node shadow_compare.js <expanded_cases.json> <tc_design.md> [--json <out>]

const fs = require('fs');
const path = require('path');
const { parseDesignTree } = require(path.join(__dirname, '..', 'validate_tc_rows.js'));

const STOP = new Set(['확인', '시', '때', '상태', '경우', '여부', '동작', '정상', '발생', '미발생', '차단']);

function tokens(s) {
  return new Set(String(s).replace(/[^0-9A-Za-z가-힣.]+/g, ' ').split(' ')
    .map((w) => w.trim()).filter((w) => w.length >= 2 && !STOP.has(w)));
}
function jaccard(a, b) {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function compare(expanded, designMd, threshold = 0.18) {
  const tree = parseDesignTree(designMd);
  const leaves = (tree.leaves || []).map((l, i) => ({ ...l, _i: i, _tok: tokens(`${l.cat3} ${l.text}`) }));
  const cases = expanded.cases.map((c) => ({ ...c, _tok: tokens(c.purpose) }));

  // 전개기 케이스별 최적 설계 leaf (탐욕, 입력 순서 고정 — 결정론)
  const matches = [];
  for (const c of cases) {
    let best = null, bestS = 0;
    for (const l of leaves) {
      const s = jaccard(c._tok, l._tok);
      if (s > bestS) { bestS = s; best = l; }
    }
    matches.push({ id: c.id, gen: c.gen, stage: c.stage, purpose: c.purpose,
      matched: bestS >= threshold, score: Number(bestS.toFixed(3)),
      leaf: best ? { line: best.line, stage: best.stage, text: best.text } : null });
  }
  const matchedLeafLines = new Set(matches.filter((m) => m.matched).map((m) => m.leaf.line));
  const uncovered = leaves.filter((l) => !matchedLeafLines.has(l.line))
    .map((l) => ({ line: l.line, cat3: l.cat3, stage: l.stage, text: l.text }));

  const stageOf = (arr, key) => arr.reduce((a, x) => { a[x[key]] = (a[x[key]] || 0) + 1; return a; }, {});
  return {
    expander: { total: cases.length, stages: stageOf(cases, 'stage'),
      matched: matches.filter((m) => m.matched).length,
      unmatched: matches.filter((m) => !m.matched).length },
    design: { total: leaves.length, stages: stageOf(leaves, 'stage'),
      covered: matchedLeafLines.size, uncovered: uncovered.length },
    threshold,
    matches,
    design_uncovered: uncovered,
  };
}

module.exports = { compare };

if (require.main === module) {
  const [expFile, designFile] = process.argv.slice(2);
  if (!expFile || !designFile) { console.error('usage: node shadow_compare.js <expanded_cases.json> <tc_design.md> [--json <out>]'); process.exit(1); }
  const expanded = JSON.parse(fs.readFileSync(expFile, 'utf8'));
  const designMd = fs.readFileSync(designFile, 'utf8');
  const r = compare(expanded, designMd);
  const jIdx = process.argv.indexOf('--json');
  if (jIdx >= 0) fs.writeFileSync(process.argv[jIdx + 1], JSON.stringify(r, null, 2), 'utf8');
  console.log(JSON.stringify({ expander: r.expander, design: r.design, threshold: r.threshold }, null, 2));
}
