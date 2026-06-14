// gen_fsm.js — G3: 상태머신 all-edges 결정론 전개
// 전이당 정확히 1케이스 = 수학적 하한 (전이 누락 P-08 소멸). stage 고정 정상.
// 비정상 전이(강종/중복 이벤트)는 G6 패턴 소관 — 여기서 생성하지 않음.

const { FSM_EDGE } = require('./pattern_catalog');

function fill(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
}

function generate(fsm, subcatsByKey) {
  const cases = [];
  (fsm || []).forEach((f, fi) => {
    const sub = subcatsByKey.get(f.subcat);
    f.transitions.forEach((t, ti) => {
      cases.push({
        gen: 'G3',
        subcat: f.subcat,
        stage: FSM_EDGE.stage,
        purpose: fill(FSM_EDGE.purpose, { subcat: sub.name, from: t.from, to: t.to, trigger: t.trigger }),
        trace: { source: 'B-5', fsm_index: fi, transition_index: ti, edge: `${t.from}→${t.to}@${t.trigger}` },
      });
    });
  });
  return { cases, skipped: [] };
}

module.exports = { generate };
