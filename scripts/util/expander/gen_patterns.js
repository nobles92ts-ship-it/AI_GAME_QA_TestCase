// gen_patterns.js — G6: 오류 패턴 행렬 결정론 전개
// (소분류 × 패턴 id) → 1케이스. stage·목적 골격은 ERROR_CATALOG 고정 사상.

const { ERROR_CATALOG } = require('./pattern_catalog');

function fill(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
}

function generate(patterns, subcatsByKey) {
  const cases = [];
  (patterns || []).forEach((g, gi) => {
    const sub = subcatsByKey.get(g.subcat);
    const cat = ERROR_CATALOG[g.type];
    g.patterns.forEach((id, pi) => {
      const def = cat.patterns[id];
      cases.push({
        gen: 'G6',
        subcat: g.subcat,
        stage: def.stage,
        purpose: fill(def.purpose, { subcat: sub.name }),
        trace: { source: 'B-8', pattern_index: gi, pattern_pos: pi, type: g.type, pattern: id },
      });
    });
  });
  return { cases, skipped: [] };
}

module.exports = { generate };
