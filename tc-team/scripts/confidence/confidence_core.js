/**
 * confidence_core.js — TC별 확신도 산출 (결정론, LLM 호출 0회)
 *
 * tc-team 산출물만 읽어 소분류/TC별 확신도를 감점 계산한다.
 * 소비자(시트 스탬핑 confidence_apply.js · HTML 리포트 confidence_report.js)는
 * 이 모듈을 require 한다. 산식은 여기 한 곳(SSoT).
 *
 * 신호 출처 (판단은 S1~S2에서 이미 끝나 있고, 여기는 집계만):
 *   R1·R2·R6·R7 ← tc_design.md (S1 설계·검수)
 *   R3·R4       ← dxr_crossref.json (S1 대조)
 *   R5          ← coverage_gaps.json (S2 결정론 게이트)
 *
 * ⚠ 적대 리뷰 반영 (2026-07-29):
 *   - 도메인 스톱워드 하드코딩 금지 → 리프 과반 등장 토큰 자동 도출
 *   - R7 보너스는 감점 0일 때만 (축이 다른 감점을 상쇄 금지)
 */
const fs = require('fs');
const path = require('path');
// 트리 줄 모양(대·중·소분류/항목)은 validate_tc_rows.js 와 **같은 계약**을 쓴다 — 2026-08-16 실사고.
// 여기만 `^\s+`·`^\s{2,}` 로 들여쓰기를 요구하던 시절, 설계기가 들여쓰기 없이 트리를 내자
// convert·merge·S4 는 통과하고 확신도만 leaves=[] 로 조용히 죽었다. 계약은 한 벌만 존재한다.
const { DESIGN_TREE_RE, classifyDesignLine, splitLeafMarkers } = require(path.resolve(__dirname, '../../../scripts/util/design_tree_lines'));

// ── 점수 모델 (튜닝 노브) ───────────────────────────────────────────────
// penalty = 감점(음수는 보너스) / per = 2건째부터 건당 추가 감점 / cap = 스케일링 상한.
//   실효 감점 = per 없으면 penalty 고정, 있으면 min(penalty + per × (건수-1), cap).
// 값을 바꾸면 test/confidence.test.js 의 기대표가 깨진다 — 그게 이 표의 안전장치다.
const RULES = [
  { id: 'R1', label: '기획 확인 필요 (미결 질의)', penalty: 45 },
  { id: 'R2', label: '이미지 참조 필요 (텍스트 근거 부재)', penalty: 20 },
  { id: 'R3', label: '외부 의존 미해소 (crossref keep)', penalty: 25, per: 8, cap: 45 },
  { id: 'R4', label: '외부 의존 위치만 확인 (crossref locate)', penalty: 12, per: 5, cap: 25 },
  { id: 'R5', label: '커버리지 floor 미달 (gap)', penalty: 15, per: 15, cap: 30 },
  { id: 'R6', label: '기획서 앵커 얕음 (1단계 섹션)', penalty: 18 },
  { id: 'R7', label: '설계기법 대응 (ST/DT/BVA) — 표시 전용', penalty: 0 },
];

// 감점 이외의 판정 기준.
const TUNING = {
  bands: { A: 85, B: 70, C: 50 },      // 등급 하한 (미만은 D)
  itemXrefHaystack: 'text',            // 항목 R3/R4 매칭 말뭉치. 'text+leaf'=소분류명까지 포함(누출)
  itemXrefMinTokens: 1,                // 항목 매칭 최소 비식별자 토큰 수.
                                       //   소분류는 2 고정 — 말뭉치가 화면 전체라 넓어 오탐이 쉽다.
                                       //   항목은 문장 하나뿐이라 1 로 둔다(2로 올리면 실측 529건이 일괄 승격).
};

/** 규칙 n건의 실효 감점(양수). 보너스·비스케일 규칙은 건수와 무관. */
function penaltyOf(rules, id, n = 1) {
  const r = rules.find((x) => x.id === id);
  if (!r) return 0;
  if (r.penalty < 0 || !r.per) return r.penalty;
  return Math.min(r.penalty + r.per * (Math.max(1, n) - 1), r.cap != null ? r.cap : Infinity);
}

/**
 * 외부 의존(crossref) 감점 — keep 과 locate 를 **각각** 기록하되 총량은 함께 본다.
 *
 * 첫 미해소가 기준 감점을 정하고, 나머지는 분기별 증분으로 붙는다.
 * ⚠ keep 이 이미 기준을 물었으면 locate 는 기준(12)을 다시 물지 않는다 — 단순 합산하면
 *   keep1+locate1(-37) 이 keep2(-33) 보다 나빠져 **"위치라도 찾은 쪽이 아예 못 찾은 쪽보다
 *   나쁨"** 이라는 역전이 생긴다. locate 는 keep 보다 진전된 상태이므로 그럴 수 없다.
 * 합계는 R3 상한으로 클램프 — 외부 의존 감점 총량의 천장.
 *
 * (2026-07-31 이전에는 `keep 있으면 R3, 아니면 R4` 배타 분기라 keep 이 하나라도 있으면
 *  locate 가 통째로 무시됐다. keep1 과 keep1+locate5 가 동점 = 5건이 점수에 안 보임.)
 */
function xrefPenalty(rules, nKeep, nLoc) {
  const r3 = nKeep ? penaltyOf(rules, 'R3', nKeep) : 0;
  const incr = (rules.find((x) => x.id === 'R4') || {}).per || 0;
  let r4 = nLoc ? (nKeep ? incr * nLoc : penaltyOf(rules, 'R4', nLoc)) : 0;
  const ceil = (rules.find((x) => x.id === 'R3') || {}).cap;
  if (ceil != null && r3 + r4 > ceil) r4 = Math.max(0, ceil - r3);
  return { r3, r4 };
}

/** 호출자 오버라이드를 기본 모델 위에 얕게 병합 (원본 상수는 불변). */
function resolve(override) {
  const o = override || {};
  return {
    rules: RULES.map((r) => ({ ...r, ...((o.rules || {})[r.id] || {}) })),
    tuning: { ...TUNING, ...o, bands: { ...TUNING.bands, ...(o.bands || {}) } },
  };
}

const gradeOf = (score, bands) => (score >= bands.A ? 'A' : score >= bands.B ? 'B' : score >= bands.C ? 'C' : 'D');

// 범용 조사·서술 명사 — 기능 무관 공통 스톱워드 (도메인 단어는 넣지 않는다)
const STOP_BASE = new Set(['화면', '정보', '출력', '확인', '상태', '대상', '참조',
  '여부', '존재', '규칙', '목록', '개수', '동작', '상세', '버튼', '메뉴', '시트', '표기', '순서',
  '입력', '가능', '노출', '보기', '적용', '기능', '항목', '사용', '표시', '시스템']);

const isIdent = (w) => /[A-Za-z]/.test(w);
// 언더스코어 처리 (2026-07-30): 대조 에이전트가 용어를 `전투_처치_판정_시스템` 처럼 쓰는 런이 있다.
// `_` 를 구분자에 안 넣으면 토큰 1개가 되어 어디에도 매칭되지 않고 **감점이 조용히 0** 이 된다
// (실측: 1챕터 R3/R4 발화 26.2% → 0%, A 등급 73.8% → 96%). 그렇다고 무조건 쪼개면
// `WBP_BossEncounterIntro`·`MonsterNameUI_Open` 같은 실제 식별자가 깨지고, 조각난 `UI` 가
// 'Sample_UI_Title' 에 오매칭되는 과거 함정이 되살아난다. → **한글이 섞인 토큰만** 쪼갠다
// (`기대결과_UI문구_토스트` 처럼 영문이 끼어도 한글 구문이면 쪼개야 하므로 isIdent 기준은 부족).
const splitUnderscore = (w) => (w.includes('_') && /[가-힣]/.test(w) ? w.split('_') : [w]);
const rawTokens = (t) => String(t).split(/[（(]/)[0].replace(/[=<>'"[\]]/g, ' ').split(/[\s/·,]+/)
  .flatMap(splitUnderscore)
  .map((w) => w.trim()).filter((w) => w.length >= 2 && !/^(True|False)$/i.test(w));
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// 영문 식별자는 단어 경계 매칭 — 'UI'가 'Sample_UI_Title' 부분문자열에 오매칭되는 것 방지.
// 한글은 조사가 붙어(팝업/팝업이) 경계 개념이 없으므로 부분 포함 유지.
const matchTok = (hay, w) => {
  const lw = w.toLowerCase();
  return isIdent(w) ? new RegExp('(^|[^a-z0-9_])' + escRe(lw) + '([^a-z0-9_]|$)').test(hay) : hay.includes(lw);
};

/** 리프 말뭉치에서 과반 등장 토큰 = 그 기능의 범용어 (예: '훈장') — 자동 스톱워드 */
function buildStop(leaves) {
  const df = {};
  leaves.forEach((lf) => {
    const toks = new Set(rawTokens(lf.name + ' ' + lf.mid + ' ' + lf.major + ' ' + lf.items.map((x) => x.text).join(' ')));
    toks.forEach((t) => { df[t] = (df[t] || 0) + 1; });
  });
  const auto = Object.entries(df).filter(([, c]) => c > leaves.length * 0.5).map(([t]) => t);
  return { stop: new Set([...STOP_BASE, ...auto]), auto };
}

function compute(SPEC, override) {
  const { rules, tuning } = resolve(override);
  const pen = (id, n) => penaltyOf(rules, id, n);
  const read = (f) => fs.readFileSync(path.join(SPEC, f), 'utf8');
  // 설계서만 필수. 나머지는 선택 — crossref_brain=off 환경에서는 dxr_crossref.json 자체가
  // 생성되지 않는다(run_pipeline_s1only.sh 가 스킵 시 삭제). 없으면 해당 규칙만 쉬고 나머지는 채점한다.
  const readJson = (f, dflt) => {
    try { return JSON.parse(read(f)); } catch (e) { if (e.code === 'ENOENT') return dflt; throw e; }
  };

  const L = read('tc_design.md').split('\n');
  const gaps = readJson('coverage_gaps.json', {});
  const crossref = readJson('dxr_crossref.json', { items: [] });
  const skeleton = readJson('tc_skeleton.json', null);

  const sectionSlice = (title, endRe = /^##\s/) => {
    const hit = title instanceof RegExp ? (l) => title.test(l.trim()) : (l) => l.trim() === title;
    const s = L.findIndex(hit);
    if (s < 0) return [];
    const e = L.findIndex((l, i) => i > s + 2 && endRe.test(l));
    return L.slice(s + 1, e > 0 ? e : L.length);
  };

  // 1) 분류 그룹핑 트리 → 소분류별 마커·검증항목
  const tree = sectionSlice(DESIGN_TREE_RE.section);
  const leaves = [];
  let curMajor = '', curMid = '', cur = null;
  for (const line of tree) {
    const c = classifyDesignLine(line);
    if (c.kind === 'major') { curMajor = c.name; continue; }
    if (c.kind === 'mid') { curMid = c.name; continue; }
    if (c.kind === 'leaf') {
      const { name, markers } = splitLeafMarkers(c.body);
      cur = {
        major: curMajor, mid: curMid, name,
        risk: (markers.find((m) => /HIGH|MEDIUM|LOW/.test(m)) || '[MEDIUM]').replace(/[[\]]/g, ''),
        needImage: markers.some((m) => m.includes('이미지 참조 필요')),
        items: [],
      };
      leaves.push(cur);
      continue;
    }
    if (c.kind === 'item' && cur) {
      cur.items.push({
        stage: c.stage, no: c.seq, text: c.body.replace(/\s*\[J:[^\]]+\]/g, '').trim(),
        jTag: (c.body.match(/\[J:([^\]]+)\]/) || [])[1] || null,
      });
    }
  }

  const { stop, auto: autoStop } = buildStop(leaves);
  const tokenize = (t) => rawTokens(t).filter((w) => !stop.has(w));

  // 2) 검증단계 사전 배분표 → 소분류별 비고
  const allocByLeaf = {};
  sectionSlice('## 검증단계 사전 배분표')
    .filter((l) => /^\|/.test(l) && !/^\|\s*-+/.test(l) && !/대분류/.test(l))
    .map((l) => l.split('|').map((s) => s.trim()).filter((_, i) => i > 0))
    .forEach((r) => { if (r[2]) allocByLeaf[r[2]] = { risk: r[3], note: r[8] || '' }; });

  // 3) 커버리지 매핑 → 기획서 섹션 앵커
  const cmRows = sectionSlice('## 커버리지 매핑')
    .filter((l) => /^\|\s*\d+\s*\|/.test(l))
    .map((l) => l.split('|').map((s) => s.trim()).filter((_, i) => i > 0))
    .map((r) => ({ item: r[1], src: r[2], point: r[3], keywords: (r[4] || '').split(',').map((s) => s.trim()).filter(Boolean), risk: r[5], promo: r[6] || '' }));

  // 4) coverage_gaps subcat(영문키) ↔ 소분류(한글) — 배분표와 동일 순서
  const keyToLeaf = {};
  Object.keys(gaps.floor_by_subcat || {}).forEach((k, i) => { if (leaves[i]) keyToLeaf[k] = leaves[i].name; });
  const gapByLeaf = {};
  (gaps.gaps || []).forEach((g) => {
    const n = keyToLeaf[g.subcat];
    if (n) (gapByLeaf[n] = gapByLeaf[n] || []).push(g);
  });

  // 5) crossref 미해소 → 소분류 매칭 (식별자 1개 또는 비범용 토큰 2개 이상)
  const unresolved = (crossref.items || []).filter((i) => i.branch === 'keep' || i.branch === 'locate');
  const xrefByLeaf = {};
  const anchorByLeaf = {};
  leaves.forEach((lf) => {
    const hay = (lf.name + ' ' + lf.mid + ' ' + lf.major + ' ' + lf.items.map((x) => x.text).join(' ')).toLowerCase();
    xrefByLeaf[lf.name] = unresolved.filter((u) => {
      const hits = tokenize(u.term).filter((w) => matchTok(hay, w));
      return hits.some(isIdent) || hits.length >= 2;
    });
    const hitRows = cmRows.filter((r) => r.keywords.some((k) => k && hay.includes(k.toLowerCase())));
    const depths = hitRows.map((r) => (/^이전 기록/.test(r.src) ? 0 : r.src.split('-').length));
    anchorByLeaf[lf.name] = { max: depths.length ? Math.max(...depths) : 0, srcs: [...new Set(hitRows.map((r) => r.src))], n: hitRows.length };
  });

  // ── 소분류 단위 감점 (히트맵 리포트용) ────────────────────────────────
  const scored = leaves.map((lf) => {
    const reasons = [];
    let score = 100;

    const jPlan = lf.items.filter((i) => i.jTag && /기획/.test(i.jTag));
    const jTodo = lf.items.filter((i) => i.jTag && /추후/.test(i.jTag));
    if (jPlan.length) {
      const p = pen('R1', jPlan.length); score -= p;
      reasons.push({ id: 'R1', d: -p, detail: `${jPlan.length}건 — ${jPlan.map((i) => i.stage + '-' + i.no).join(', ')}` });
    }
    if (lf.needImage) { const p = pen('R2'); score -= p; reasons.push({ id: 'R2', d: -p, detail: '소분류 전체가 이미지 판독 의존' }); }

    const xr = xrefByLeaf[lf.name] || [];
    const keeps = xr.filter((x) => x.branch === 'keep');
    const locs = xr.filter((x) => x.branch === 'locate');
    const xp = xrefPenalty(rules, keeps.length, locs.length);
    if (xp.r3) { score -= xp.r3; reasons.push({ id: 'R3', d: -xp.r3, detail: keeps.map((k) => k.term).join(' / ') }); }
    if (xp.r4) { score -= xp.r4; reasons.push({ id: 'R4', d: -xp.r4, detail: locs.map((k) => k.term).join(' / ') }); }

    const g = gapByLeaf[lf.name] || [];
    if (g.length) {
      const p = pen('R5', g.length);
      score -= p;
      reasons.push({ id: 'R5', d: -p, detail: `${g.length}건 (${[...new Set(g.map((x) => x.gen))].join(',')} / ${[...new Set(g.map((x) => x.stage))].join(',')})` });
    }

    const a = anchorByLeaf[lf.name];
    if (a.max <= 1) { const p = pen('R6'); score -= p; reasons.push({ id: 'R6', d: -p, detail: a.n ? `최대 깊이 ${a.max} (§${a.srcs.join(', §')})` : '커버리지 매핑 앵커 미검출' }); }

    // R7 — 설계기법 적용 '배지'. 점수에는 영향이 없다.
    //   축이 다른 감점을 상쇄하지 않는다는 원칙(2026-07-29 적대 리뷰) 때문에 감점 0일 때만 붙는데,
    //   그러면 100+8 이 클램프돼 실측 3,271건 중 점수 변동이 0건이었다. 보너스인 척하지 말고
    //   "기법이 적용됐다"는 사실만 남긴다.
    const note = (allocByLeaf[lf.name] || {}).note || '';
    if (/ST-\d|DT-\d|BVA|전이 전수|경계/.test(note) && !reasons.some((r) => r.d < 0)) {
      reasons.push({ id: 'R7', d: 0, badge: true, detail: note.slice(0, 60) });
    }

    score = Math.max(0, Math.min(100, score));
    return {
      ...lf, score, grade: gradeOf(score, tuning.bands),
      reasons, anchor: a, note,
      counts: {
        정상: lf.items.filter((i) => i.stage === '정상').length,
        부정: lf.items.filter((i) => i.stage === '부정').length,
        예외: lf.items.filter((i) => i.stage === '예외').length,
      },
      todo: jTodo.length, total: lf.items.length,
    };
  });

  // 섹션 역커버리지 (기획서 오버레이의 역방향 — 원본 파일은 읽기만)
  const bySection = {};
  cmRows.forEach((r) => {
    const top = /^이전 기록/.test(r.src) ? '이전 판본' : r.src.split('-')[0];
    const b = (bySection[top] = bySection[top] || { top, items: 0, anchors: new Set(), risk: { HIGH: 0, MEDIUM: 0, LOW: 0 }, shallow: 0, promoOut: 0 });
    b.items++; b.anchors.add(r.src);
    if (r.risk) b.risk[r.risk] = (b.risk[r.risk] || 0) + 1;
    if (!/^이전 기록/.test(r.src) && r.src.split('-').length === 1) b.shallow++;
    if (r.promo) b.promoOut++;
  });
  const sections = Object.values(bySection)
    .map((b) => ({ ...b, anchors: [...b.anchors].sort(), depth: [...b.anchors].filter((a) => a.split('-').length >= 3).length }))
    .sort((a, b) => (a.top === '이전 판본' ? 1 : b.top === '이전 판본' ? -1 : (+a.top) - (+b.top)));

  // 탐색 차터 후보 = 저확신도 × 고리스크 (리포트 참고용 — 별도 산출물 아님, 07-29 보류 결정)
  const RANK = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  const charters = scored
    .map((s) => ({ ...s, priority: (100 - s.score) * RANK[s.risk] }))
    .filter((s) => s.grade === 'C' || s.grade === 'D' || (s.risk === 'HIGH' && s.score < 85))
    .sort((a, b) => b.priority - a.priority);

  // 진단 — 미해소 용어가 있는데 어느 소분류에도 매칭되지 않으면 R3/R4 감점이 통째로 사라진다.
  // 원인은 보통 대조가 용어를 정규화해 쓴 것(`중독·환각` → `중독환각`, `전투/처치` → `전투_처치`).
  // 실측(2026-07-30 1챕터): 이 상태에서 R3 발화 26.2%→0%, A 등급 73.8%→96% 로 조용히 관대해졌다.
  const diag = {
    unresolvedTerms: unresolved.length,
    matchedLeaves: leaves.filter((lf) => (xrefByLeaf[lf.name] || []).length).length,
  };

  // RULES 는 리포트의 라벨 조회용 — 오버라이드가 있으면 실제 적용된 표를 넘긴다.
  return { scored, sections, charters, skeleton, cmRows, RULES: rules, rules, tuning, pen, diag, autoStop, tokenize };
}

// ── TC(항목) 단위 확신도 ────────────────────────────────────────────────
// 소분류 점수 = "이 화면 전체가 얼마나 근거 있나" / 항목 점수 = "이 TC 한 줄이".
//   · 항목 고유 : R1(그 항목의 [J:기획확인]) · R5(그 단계의 gap) · R3/R4(항목 문장 매칭) · R6(항목별 앵커 깊이)
//   · 소분류 상속 : R2(이미지 마커 — 화면 전체 속성)
function computeItems(SPEC, override) {
  const ctx = compute(SPEC, override);
  const { scored, cmRows, tokenize, tuning, pen, rules } = ctx;
  const out = [];

  scored.forEach((lf) => {
    const r2 = lf.reasons.find((r) => r.id === 'R2');
    const r7leaf = /ST-\d|DT-\d|BVA|전이 전수|경계/.test(lf.note || '');
    const xrefs = lf.reasons.filter((r) => r.id === 'R3' || r.id === 'R4');

    lf.items.forEach((it, ii) => {
      const reasons = [];
      let score = 100;
      const hay = (it.text + ' ' + lf.name).toLowerCase();
      // R3/R4 매칭 말뭉치는 별도 — 'text' 로 두면 소분류명이 항목 근거로 새는 것을 막는다.
      const xhay = tuning.itemXrefHaystack === 'text' ? it.text.toLowerCase() : hay;

      // R1 — 그 항목에 직접 붙은 미결 질의만
      if (it.jTag && /기획/.test(it.jTag)) { const p = pen('R1'); score -= p; reasons.push({ id: 'R1', d: -p, detail: `${it.stage}-${it.no}` }); }

      // R2 — 화면 전체가 이미지 의존이면 전 항목 상속
      if (r2) { score += r2.d; reasons.push({ ...r2, inherited: true }); }

      // R5 — 그 항목의 단계에 gap이 걸린 경우만
      const r5 = lf.reasons.find((r) => r.id === 'R5');
      if (r5 && new RegExp(it.stage).test(r5.detail)) { const p = pen('R5'); score -= p; reasons.push({ id: 'R5', d: -p, detail: r5.detail, stage: it.stage }); }

      // R3/R4 — 용어 단위로 항목 문장에 실제 걸리는 것만 (걸린 용어를 terms로 보존).
      // 감점은 소분류와 같은 xrefPenalty 로 계산한다 — 여기서 분기별로 따로 pen() 하면
      // keep·locate 가 각각 기준 감점을 물어 순서 역전이 항목 단위에서 되살아난다.
      const xhit = { R3: [], R4: [] };
      xrefs.forEach((r) => {
        xhit[r.id] = String(r.detail).split(' / ').filter((t) => {
          const tk = tokenize(t).filter((w) => matchTok(xhay, w));
          return tk.some(isIdent) || tk.length >= tuning.itemXrefMinTokens;
        });
      });
      const xp = xrefPenalty(rules, xhit.R3.length, xhit.R4.length);
      [['R3', xp.r3], ['R4', xp.r4]].forEach(([id, p]) => {
        if (!p) return;
        score -= p;
        reasons.push({ id, d: -p, detail: xhit[id].join(' / '), terms: xhit[id].map((t) => t.split(/[（(]/)[0].trim()) });
      });

      // 항목별 기획서 앵커 (커버리지 매핑 키워드 → 원문 섹션 위치)
      const hitRows = cmRows.filter((r) => r.keywords.some((k) => k && hay.includes(k.toLowerCase())));
      let anchors = [...new Set(hitRows.map((r) => r.src))];
      const depths = hitRows.filter((r) => !/^이전 기록/.test(r.src)).map((r) => r.src.split('-').length);
      const maxD = depths.length ? Math.max(...depths) : 0;
      if (!anchors.length) anchors = lf.anchor.srcs;   // 항목 매칭 실패 시 소분류 앵커로 폴백

      // R6 — 이 항목을 콕 집은 앵커가 없거나 1단계뿐일 때
      if (maxD <= 1) { const p = pen('R6'); score -= p; reasons.push({ id: 'R6', d: -p, detail: anchors.length ? `§${anchors.join(' §')}` : '매핑 안 됨' }); }

      // R7 — 배지 (점수 영향 없음, 위 소분류 블록 주석 참조)
      if (r7leaf && !reasons.some((r) => r.d < 0)) {
        reasons.push({ id: 'R7', d: 0, badge: true, detail: (lf.note || '').slice(0, 60), inherited: true });
      }

      score = Math.max(0, Math.min(100, score));
      const unimplemented = !!(it.jTag && /추후/.test(it.jTag));
      out.push({
        leaf: lf.name, major: lf.major, mid: lf.mid, risk: lf.risk,
        stage: it.stage, no: it.no, text: it.text,
        score, grade: unimplemented ? 'N' : gradeOf(score, tuning.bands),
        unimplemented, reasons, anchors,
      });
    });
  });
  // 시트에 찍히는 건 항목 점수다 → 조용한 누락 판정도 항목 기준으로 한다.
  // (소분류는 말뭉치가 화면 전체라 매칭되면서 개별 항목 문장은 하나도 안 걸리는 경우가 있다.)
  ctx.diag = {
    ...ctx.diag,
    matchedItems: out.filter((i) => i.reasons.some((r) => r.id === 'R3' || r.id === 'R4')).length,
  };
  ctx.diag.xrefSilentMiss = ctx.diag.unresolvedTerms > 0 && ctx.diag.matchedItems === 0;
  return { items: out, ...ctx };
}

// ── 스탬핑 진입 게이트 (fail-loud) ──────────────────────────────────────
// 2026-08-16 자동_사냥_기능_v3: 파서가 항목 0건을 내자 시트 전 행이 드리프트로 떨어졌는데
// confidence_apply.js 는 "색칠 0행 · 드리프트 218행"을 **경고 한 줄**로 찍고 rc=0 으로 끝났다.
// finalize.sh 는 그걸 FINAL-0:✓ 로 보고했다. 확신도가 통째로 빠진 시트가 정상 완주로 보인다.
// → 아래 두 조건은 경고가 아니라 실패다. 판정만 여기(순수함수)에 두고 종료는 호출자가 한다.
const STAMP_DRIFT_MAX = 0.5;   // 드리프트가 전체의 절반을 넘으면 매핑이 깨진 것으로 본다
function stampGate({ items = 0, matched = 0, drift = 0, driftMax = STAMP_DRIFT_MAX } = {}) {
  if (!items) {
    return { ok: false, code: 'no_items',
      msg: '설계서에서 TC 항목을 0건 파싱했습니다 — tc_design.md 의 "## 분류 그룹핑 트리" 형식을 확인하세요 (소분류 "- 이름 [리스크] [플랫폼]" / 항목 "→ 정상-1: 본문")' };
  }
  const total = matched + drift;
  if (total && drift / total > driftMax) {
    return { ok: false, code: 'drift',
      msg: `설계와 시트가 어긋납니다 — 점수 없는 행 ${drift}/${total} (${Math.round(drift / total * 100)}%, 허용 ${Math.round(driftMax * 100)}%). 소분류명·검증단계 순번이 설계서와 다른지 확인하세요` };
  }
  return { ok: true };
}

module.exports = { compute, computeItems, RULES, TUNING, STOP_BASE, penaltyOf, xrefPenalty, stampGate, STAMP_DRIFT_MAX };
