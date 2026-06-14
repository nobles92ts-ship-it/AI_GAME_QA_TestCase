// candidate_schema.js — candidates.json fail-fast 검증기 (전개기 입력 계약)
// 계약 SSoT: tc-분석.md §2.5 Part B (B-0 마스터 키 + B-4 4포인트 + B-5 전이 + B-8 enum)
// CLI: node candidate_schema.js <candidates.json>  → exit 0(통과) / 4(위반) / 1(파일·파싱 오류)

const { ERROR_CATALOG, BVA_POINT_ORDER, LENS_AXES } = require('./pattern_catalog');

const KEY_RE = /^[a-z0-9_]+$/;
const TOP_KEYS = ['meta', 'subcats', 'bva', 'fsm', 'patterns', 'ep', 'decision', 'pairwise', 'lenses'];

function validate(c) {
  const v = []; // violations: {code, path, msg}
  const push = (code, path, msg) => v.push({ code, path, msg });

  if (!c || typeof c !== 'object' || Array.isArray(c)) {
    push('S-00', '$', '루트가 객체가 아님');
    return { ok: false, violations: v, counts: {} };
  }
  for (const k of Object.keys(c)) {
    if (!TOP_KEYS.includes(k)) push('S-01', `$.${k}`, `허용되지 않은 최상위 키 (허용: ${TOP_KEYS.join(', ')})`);
  }

  // meta
  if (!c.meta || typeof c.meta.feature !== 'string' || !c.meta.feature.trim()) {
    push('S-02', '$.meta.feature', 'meta.feature 필수 (비어있지 않은 문자열)');
  }
  if (!c.meta || c.meta.version !== 1) push('S-03', '$.meta.version', 'meta.version은 1이어야 함');

  // B-0 subcats — 마스터 키
  const keys = new Set();
  if (!Array.isArray(c.subcats) || c.subcats.length === 0) {
    push('S-10', '$.subcats', 'subcats 배열 필수 (1개 이상) — B-0 마스터 키');
  } else {
    c.subcats.forEach((s, i) => {
      const p = `$.subcats[${i}]`;
      if (!s || typeof s.key !== 'string' || !KEY_RE.test(s.key)) push('S-11', `${p}.key`, `key는 ${KEY_RE} 형식 필수`);
      else if (keys.has(s.key)) push('S-12', `${p}.key`, `중복 키: ${s.key}`);
      else keys.add(s.key);
      if (typeof s.name !== 'string' || !s.name.trim()) push('S-13', `${p}.name`, 'name(한글 소분류명) 필수');
      // 렌더 그룹핑 필드 (선택 — Phase C 렌더 시 사용, 기본값: cat1=feature, cat2=name, MEDIUM, PC/모바일)
      if (s.risk !== undefined && !['HIGH', 'MEDIUM', 'LOW'].includes(s.risk)) push('S-14', `${p}.risk`, 'risk는 HIGH|MEDIUM|LOW');
      if (s.platform !== undefined && !['PC/모바일', 'PC', '모바일'].includes(s.platform)) push('S-15', `${p}.platform`, 'platform은 PC/모바일|PC|모바일');
    });
  }
  const refOk = (key) => keys.has(key);

  // B-4 bva — 4포인트 강제
  let bvaPoints = 0, bvaSkipped = 0;
  (Array.isArray(c.bva) ? c.bva : c.bva === undefined ? [] : (push('S-20', '$.bva', 'bva는 배열이어야 함'), []))
    .forEach((b, i) => {
      const p = `$.bva[${i}]`;
      if (!refOk(b.subcat)) push('S-21', `${p}.subcat`, `B-0에 없는 키 참조: ${b.subcat}`);
      if (typeof b.metric !== 'string' || !b.metric.trim()) push('S-22', `${p}.metric`, 'metric(수치명) 필수');
      if (typeof b.source_key !== 'string') push('S-23', `${p}.source_key`, 'source_key 필수 (GlobalDefine 키 또는 "(키 미정)")');
      const pts = b.points;
      if (!pts || typeof pts !== 'object') { push('S-24', `${p}.points`, 'points 객체 필수'); return; }
      const extra = Object.keys(pts).filter((k) => !BVA_POINT_ORDER.includes(k));
      if (extra.length) push('S-25', `${p}.points`, `허용되지 않은 포인트 키: ${extra.join(', ')}`);
      let live = 0;
      for (const k of BVA_POINT_ORDER) {
        const pt = pts[k];
        const pp = `${p}.points.${k}`;
        if (pt === undefined) { push('S-26', pp, `4포인트 강제 — ${k} 누락 (불가하면 {"skip":"infeasible|unspecified","reason":"…"})`); continue; }
        if (pt && typeof pt.skip === 'string') {
          if (!['infeasible', 'unspecified'].includes(pt.skip)) push('S-27', pp, 'skip은 infeasible|unspecified만 허용');
          if (typeof pt.reason !== 'string' || !pt.reason.trim()) push('S-28', pp, 'skip 시 reason 필수');
          bvaSkipped++;
        } else if (pt && typeof pt.value === 'string' && pt.value.trim() && typeof pt.label === 'string' && pt.label.trim()) {
          live++; bvaPoints++;
        } else {
          push('S-29', pp, '{value,label} 또는 {skip,reason} 형식 필수');
        }
      }
      if (live < 2 && BVA_POINT_ORDER.every((k) => pts[k] !== undefined)) {
        push('S-2A', `${p}.points`, `유효 포인트 ${live}개 — 최소 2개 필요 (전부 skip이면 BVA 후보가 아님)`);
      }
    });

  // B-5 fsm — 전이 명시 (all-edges 입력)
  let fsmTransitions = 0;
  (Array.isArray(c.fsm) ? c.fsm : c.fsm === undefined ? [] : (push('S-30', '$.fsm', 'fsm은 배열이어야 함'), []))
    .forEach((f, i) => {
      const p = `$.fsm[${i}]`;
      if (!refOk(f.subcat)) push('S-31', `${p}.subcat`, `B-0에 없는 키 참조: ${f.subcat}`);
      const states = Array.isArray(f.states) ? f.states : [];
      if (states.length < 2 || new Set(states).size !== states.length) push('S-32', `${p}.states`, '상태 2개 이상 + 중복 금지');
      const trs = Array.isArray(f.transitions) ? f.transitions : [];
      if (trs.length === 0) push('S-33', `${p}.transitions`, '전이 1개 이상 필수 (all-edges 입력)');
      const seen = new Set();
      trs.forEach((t, j) => {
        const tp = `${p}.transitions[${j}]`;
        if (!states.includes(t.from)) push('S-34', `${tp}.from`, `states에 없는 상태: ${t.from}`);
        if (!states.includes(t.to)) push('S-35', `${tp}.to`, `states에 없는 상태: ${t.to}`);
        if (typeof t.trigger !== 'string' || !t.trigger.trim()) push('S-36', `${tp}.trigger`, 'trigger 필수');
        const sig = `${t.from}→${t.to}@${t.trigger}`;
        if (seen.has(sig)) push('S-37', tp, `중복 전이: ${sig}`);
        seen.add(sig);
        fsmTransitions++;
      });
    });

  // B-8 patterns — enum 강제
  let patternCount = 0;
  (Array.isArray(c.patterns) ? c.patterns : c.patterns === undefined ? [] : (push('S-40', '$.patterns', 'patterns는 배열이어야 함'), []))
    .forEach((g, i) => {
      const p = `$.patterns[${i}]`;
      if (!refOk(g.subcat)) push('S-41', `${p}.subcat`, `B-0에 없는 키 참조: ${g.subcat}`);
      const cat = ERROR_CATALOG[g.type];
      if (!cat) { push('S-42', `${p}.type`, `허용되지 않은 기능 유형: ${g.type} (허용: ${Object.keys(ERROR_CATALOG).join(', ')})`); return; }
      const ids = Array.isArray(g.patterns) ? g.patterns : [];
      if (ids.length === 0) push('S-43', `${p}.patterns`, '패턴 1개 이상 필수');
      ids.forEach((id, j) => {
        if (!cat.patterns[id]) push('S-44', `${p}.patterns[${j}]`, `${g.type}에 없는 패턴: ${id} (허용: ${Object.keys(cat.patterns).join(', ')})`);
        else patternCount++;
      });
    });

  // B-3 ep — 파티션 (Phase B)
  let epCases = 0;
  (Array.isArray(c.ep) ? c.ep : c.ep === undefined ? [] : (push('S-50', '$.ep', 'ep는 배열이어야 함'), []))
    .forEach((e, i) => {
      const p = `$.ep[${i}]`;
      if (!refOk(e.subcat)) push('S-51', `${p}.subcat`, `B-0에 없는 키 참조: ${e.subcat}`);
      if (typeof e.condition !== 'string' || !e.condition.trim()) push('S-52', `${p}.condition`, 'condition 필수');
      const parts = Array.isArray(e.partitions) ? e.partitions : [];
      if (parts.length === 0) push('S-53', `${p}.partitions`, '파티션 1개 이상 필수 (B-4/B-5/B-6 중복 파티션은 생략 — 전부 중복이면 ep 항목 자체를 생략)');
      parts.forEach((pt, j) => {
        const pp = `${p}.partitions[${j}]`;
        if (!['valid', 'invalid'].includes(pt.kind)) push('S-54', `${pp}.kind`, 'kind는 valid|invalid');
        if (typeof pt.label !== 'string' || !pt.label.trim()) push('S-55', `${pp}.label`, 'label 필수');
        if (typeof pt.expect !== 'string' || !pt.expect.trim()) push('S-56', `${pp}.expect`, 'expect(검증 절) 필수');
        epCases++;
      });
    });

  // B-6 decision — 단층 AND/OR (Phase B). 중첩 식은 분리하거나 pairwise로.
  let mcdcCases = 0;
  (Array.isArray(c.decision) ? c.decision : c.decision === undefined ? [] : (push('S-60', '$.decision', 'decision은 배열이어야 함'), []))
    .forEach((d, i) => {
      const p = `$.decision[${i}]`;
      if (!refOk(d.subcat)) push('S-61', `${p}.subcat`, `B-0에 없는 키 참조: ${d.subcat}`);
      if (typeof d.name !== 'string' || !d.name.trim()) push('S-62', `${p}.name`, 'name 필수');
      if (!['AND', 'OR'].includes(d.op)) push('S-63', `${p}.op`, 'op는 AND|OR (단층만 — 중첩 식은 항목 분리)');
      const conds = Array.isArray(d.conditions) ? d.conditions : [];
      if (conds.length < 2 || conds.some((x) => typeof x !== 'string' || !x.trim())) {
        push('S-64', `${p}.conditions`, '조건 2개 이상 + 전부 비어있지 않은 문자열');
      }
      if (typeof d.true_outcome !== 'string' || !d.true_outcome.trim()) push('S-65', `${p}.true_outcome`, 'true_outcome 필수');
      if (typeof d.false_outcome !== 'string' || !d.false_outcome.trim()) push('S-66', `${p}.false_outcome`, 'false_outcome 필수');
      mcdcCases += conds.length + 1;
    });

  // pairwise — 조합 인자 (Phase B)
  let pairwiseRows = 0; // 행수는 생성기 출력에서 확정 — 여기선 입력 무결성만
  (Array.isArray(c.pairwise) ? c.pairwise : c.pairwise === undefined ? [] : (push('S-70', '$.pairwise', 'pairwise는 배열이어야 함'), []))
    .forEach((pw, i) => {
      const p = `$.pairwise[${i}]`;
      if (!refOk(pw.subcat)) push('S-71', `${p}.subcat`, `B-0에 없는 키 참조: ${pw.subcat}`);
      if (typeof pw.name !== 'string' || !pw.name.trim()) push('S-72', `${p}.name`, 'name 필수');
      const fac = Array.isArray(pw.factors) ? pw.factors : [];
      if (fac.length < 2) push('S-73', `${p}.factors`, '인자 2개 이상 필수');
      fac.forEach((f, j) => {
        const fp = `${p}.factors[${j}]`;
        if (typeof f.name !== 'string' || !f.name.trim()) push('S-74', `${fp}.name`, '인자명 필수');
        const lv = Array.isArray(f.levels) ? f.levels : [];
        if (lv.length < 2 || new Set(lv).size !== lv.length) push('S-75', `${fp}.levels`, '수준 2개 이상 + 중복 금지');
      });
      pairwiseRows++;
    });

  // B-9 lenses — 신규 도출 칸 (Phase B)
  let lensCases = 0;
  (Array.isArray(c.lenses) ? c.lenses : c.lenses === undefined ? [] : (push('S-80', '$.lenses', 'lenses는 배열이어야 함'), []))
    .forEach((l, i) => {
      const p = `$.lenses[${i}]`;
      if (!refOk(l.subcat)) push('S-81', `${p}.subcat`, `B-0에 없는 키 참조: ${l.subcat}`);
      if (!LENS_AXES[l.axis]) push('S-82', `${p}.axis`, `axis는 ${Object.keys(LENS_AXES).join('|')}`);
      if (typeof l.candidate !== 'string' || !l.candidate.trim()) push('S-83', `${p}.candidate`, 'candidate(검증 절 한 줄) 필수');
      lensCases++;
    });

  // 표↔JSON 행수 대조용 counts (분석 Step 7 자가검증 입력)
  const counts = {
    subcats: keys.size,
    bva_rows: Array.isArray(c.bva) ? c.bva.length : 0,
    bva_points: bvaPoints,
    bva_skipped: bvaSkipped,
    fsm_rows: Array.isArray(c.fsm) ? c.fsm.length : 0,
    fsm_transitions: fsmTransitions,
    pattern_rows: Array.isArray(c.patterns) ? c.patterns.length : 0,
    pattern_cases: patternCount,
    ep_rows: Array.isArray(c.ep) ? c.ep.length : 0,
    ep_cases: epCases,
    decision_rows: Array.isArray(c.decision) ? c.decision.length : 0,
    mcdc_cases: mcdcCases,
    pairwise_rows: pairwiseRows,
    lens_cases: lensCases,
  };
  return { ok: v.length === 0, violations: v, counts };
}

module.exports = { validate };

if (require.main === module) {
  const fs = require('fs');
  const file = process.argv[2];
  if (!file) { console.error('usage: node candidate_schema.js <candidates.json>'); process.exit(1); }
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { console.error(JSON.stringify({ ok: false, error: `read/parse 실패: ${e.message}` })); process.exit(1); }
  const r = validate(data);
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.ok ? 0 : 4);
}
