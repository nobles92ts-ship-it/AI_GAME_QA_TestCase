// gen_decision.js — G4: 결정 테이블 MC/DC 결정론 전개
// 단층 AND/OR c조건 → c+1 케이스 (전조합 2^c 불필요, 상한 2c 충족)
//   AND: all-true 1(정상) + 조건별 single-false c(부정)
//   OR : all-false 1(부정) + 조건별 single-true c(정상)

const { MCDC } = require('./pattern_catalog');

function fill(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
}

// 입력만으로 케이스 수 확정 (항등식 항): Σ (conditions.length + 1)
function expectedCount(decision) {
  return (decision || []).reduce((n, d) => n + d.conditions.length + 1, 0);
}

function generate(decision, subcatsByKey) {
  const cases = [];
  (decision || []).forEach((d, di) => {
    const sub = subcatsByKey.get(d.subcat);
    const conds = d.conditions.join(' · ');
    const t = MCDC[d.op];
    const base = d.op === 'AND'
      ? { stage: t.all.stage, purpose: fill(t.all.purpose, { subcat: sub.name, conds, true_outcome: d.true_outcome }) }
      : { stage: t.none.stage, purpose: fill(t.none.purpose, { subcat: sub.name, conds, false_outcome: d.false_outcome }) };
    cases.push({ gen: 'G4', subcat: d.subcat, ...base,
      trace: { source: 'B-6', decision_index: di, row: d.op === 'AND' ? 'all_true' : 'all_false', name: d.name } });
    d.conditions.forEach((cond, ci) => {
      const s = t.single;
      cases.push({
        gen: 'G4', subcat: d.subcat, stage: s.stage,
        purpose: fill(s.purpose, { subcat: sub.name, cond, true_outcome: d.true_outcome, false_outcome: d.false_outcome }),
        trace: { source: 'B-6', decision_index: di, row: 'single', condition_index: ci, name: d.name },
      });
    });
  });
  return { cases, skipped: [] };
}

module.exports = { generate, expectedCount };
