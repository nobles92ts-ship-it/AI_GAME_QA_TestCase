// gen_ep_bva.js — G2: BVA 4포인트 결정론 전개 (σ_BVA 고정 사상)
// 입력: candidates.bva[] (스키마 통과본) / 출력: 케이스 골격 배열 (입력 순서 보존)
// 포인트당 1케이스 1방향 → P-20 위반이 생성 경로상 불가능

const { SIGMA_BVA, BVA_POINT_ORDER } = require('./pattern_catalog');

function fill(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
}

// subcatsByKey: Map(key → {key,name,...})
function generate(bva, subcatsByKey) {
  const cases = [];
  const skipped = [];
  (bva || []).forEach((b, bi) => {
    const sub = subcatsByKey.get(b.subcat);
    for (const pk of BVA_POINT_ORDER) {
      const pt = b.points[pk];
      const sigma = SIGMA_BVA[pk];
      if (pt && typeof pt.skip === 'string') {
        skipped.push({ gen: 'G2', subcat: b.subcat, bva_index: bi, point: pk, skip: pt.skip, reason: pt.reason });
        continue;
      }
      cases.push({
        gen: 'G2',
        subcat: b.subcat,
        stage: sigma.stage,
        purpose: fill(sigma.purpose, { subcat: sub.name, metric: b.metric, value: pt.value, label: pt.label }),
        trace: { source: 'B-4', bva_index: bi, point: pk, source_key: b.source_key, direction: sigma.direction },
      });
    }
  });
  return { cases, skipped };
}

module.exports = { generate };
