// gen_lenses.js — G7: 렌즈 스윕 결정론 전개 (B-9 신규 도출 칸만)
// 계약: →B-N 참조 칸·비해당(–) 칸은 분석이 생략 — 받은 entry당 1케이스, stage는 축 고정 사상.

const { LENS_AXES } = require('./pattern_catalog');

function generate(lenses, subcatsByKey) {
  const cases = [];
  (lenses || []).forEach((l, li) => {
    const sub = subcatsByKey.get(l.subcat);
    const axis = LENS_AXES[l.axis];
    const clause = l.candidate.trim();
    cases.push({
      gen: 'G7',
      subcat: l.subcat,
      stage: axis.stage,
      purpose: `${sub.name} — ${clause}${clause.endsWith('확인') ? '' : ' 확인'}`,
      trace: { source: 'B-9', lens_index: li, axis: l.axis, axis_label: axis.label },
    });
  });
  return { cases, skipped: [] };
}

module.exports = { generate };
