// gen_ep.js — G1: EP 파티션 결정론 전개 (σ_EP 고정 사상)
// 파티션당 1케이스. B-4/B-5/B-6과 중복되는 파티션은 분석 단계가 생략(→참조)하므로 여기선 받은 것만 전개.

const { SIGMA_EP } = require('./pattern_catalog');

function fill(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
}

function generate(ep, subcatsByKey) {
  const cases = [];
  (ep || []).forEach((e, ei) => {
    const sub = subcatsByKey.get(e.subcat);
    e.partitions.forEach((p, pi) => {
      const sigma = SIGMA_EP[p.kind];
      cases.push({
        gen: 'G1',
        subcat: e.subcat,
        stage: sigma.stage,
        purpose: fill(sigma.purpose, { subcat: sub.name, label: p.label, expect: p.expect }),
        trace: { source: 'B-3', ep_index: ei, partition_index: pi, kind: p.kind, condition: e.condition },
      });
    });
  });
  return { cases, skipped: [] };
}

module.exports = { generate };
