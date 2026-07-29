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

const RULES = [
  { id: 'R1', label: '기획 확인 필요 (미결 질의)', penalty: 45 },
  { id: 'R2', label: '이미지 참조 필요 (텍스트 근거 부재)', penalty: 20 },
  { id: 'R3', label: '외부 의존 미해소 (crossref keep)', penalty: 25 },
  { id: 'R4', label: '외부 의존 위치만 확인 (crossref locate)', penalty: 12 },
  { id: 'R5', label: '커버리지 floor 미달 (gap)', penalty: 15, cap: 30 },
  { id: 'R6', label: '기획서 앵커 얕음 (1단계 섹션)', penalty: 18 },
  { id: 'R7', label: '설계기법 대응 (ST/DT/BVA)', penalty: -8 },
];

// 범용 조사·서술 명사 — 기능 무관 공통 스톱워드 (도메인 단어는 넣지 않는다)
const STOP_BASE = new Set(['화면', '정보', '출력', '확인', '상태', '대상', '참조',
  '여부', '존재', '규칙', '목록', '개수', '동작', '상세', '버튼', '메뉴', '시트', '표기', '순서',
  '입력', '가능', '노출', '보기', '적용', '기능', '항목', '사용', '표시', '시스템']);

const isIdent = (w) => /[A-Za-z]/.test(w);
const rawTokens = (t) => String(t).split(/[（(]/)[0].replace(/[=<>'"[\]]/g, ' ').split(/[\s/·,]+/)
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

function compute(SPEC) {
  const read = (f) => fs.readFileSync(path.join(SPEC, f), 'utf8');
  const readJson = (f) => JSON.parse(read(f));

  const L = read('tc_design.md').split('\n');
  const gaps = readJson('coverage_gaps.json');
  const crossref = readJson('dxr_crossref.json');
  const skeleton = readJson('tc_skeleton.json');

  const sectionSlice = (title, endRe = /^##\s/) => {
    const s = L.findIndex((l) => l.trim() === title);
    if (s < 0) return [];
    const e = L.findIndex((l, i) => i > s + 2 && endRe.test(l));
    return L.slice(s + 1, e > 0 ? e : L.length);
  };

  // 1) 분류 그룹핑 트리 → 소분류별 마커·검증항목
  const tree = sectionSlice('## 분류 그룹핑 트리');
  const leaves = [];
  let curMajor = '', curMid = '', cur = null;
  for (const line of tree) {
    const mMajor = line.match(/^\d+\.\s+\*\*(.+?)\*\*/);
    if (mMajor) { curMajor = mMajor[1]; continue; }
    const mMid = line.match(/^\s+\d+\.\d+\s+(.+?)\s*\(중분류\)/);
    if (mMid) { curMid = mMid[1]; continue; }
    const mLeaf = line.match(/^\s{4,}-\s+(.+?)\s*(\[.*)?$/);
    if (mLeaf) {
      const markers = (mLeaf[2] || '').match(/\[[^\]]+\]/g) || [];
      cur = {
        major: curMajor, mid: curMid, name: mLeaf[1].trim(),
        risk: (markers.find((m) => /HIGH|MEDIUM|LOW/.test(m)) || '[MEDIUM]').replace(/[[\]]/g, ''),
        needImage: markers.some((m) => m.includes('이미지 참조 필요')),
        items: [],
      };
      leaves.push(cur);
      continue;
    }
    const mItem = line.match(/→\s*(정상|부정|예외)-(\d+):\s*(.+)$/);
    if (mItem && cur) {
      cur.items.push({
        stage: mItem[1], no: +mItem[2], text: mItem[3].replace(/\s*\[J:[^\]]+\]/g, '').trim(),
        jTag: (mItem[3].match(/\[J:([^\]]+)\]/) || [])[1] || null,
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
  const unresolved = crossref.items.filter((i) => i.branch === 'keep' || i.branch === 'locate');
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
    if (jPlan.length) { score -= 45; reasons.push({ id: 'R1', d: -45, detail: `${jPlan.length}건 — ${jPlan.map((i) => i.stage + '-' + i.no).join(', ')}` }); }
    if (lf.needImage) { score -= 20; reasons.push({ id: 'R2', d: -20, detail: '소분류 전체가 이미지 판독 의존' }); }

    const xr = xrefByLeaf[lf.name] || [];
    const keeps = xr.filter((x) => x.branch === 'keep');
    const locs = xr.filter((x) => x.branch === 'locate');
    if (keeps.length) { score -= 25; reasons.push({ id: 'R3', d: -25, detail: keeps.map((k) => k.term).join(' / ') }); }
    else if (locs.length) { score -= 12; reasons.push({ id: 'R4', d: -12, detail: locs.map((k) => k.term).join(' / ') }); }

    const g = gapByLeaf[lf.name] || [];
    if (g.length) {
      const p = Math.min(g.length * 15, 30);
      score -= p;
      reasons.push({ id: 'R5', d: -p, detail: `${g.length}건 (${[...new Set(g.map((x) => x.gen))].join(',')} / ${[...new Set(g.map((x) => x.stage))].join(',')})` });
    }

    const a = anchorByLeaf[lf.name];
    if (a.max <= 1) { score -= 18; reasons.push({ id: 'R6', d: -18, detail: a.n ? `최대 깊이 ${a.max} (§${a.srcs.join(', §')})` : '커버리지 매핑 앵커 미검출' }); }

    // R7 보너스는 감점 0일 때만 — 축이 다른 감점을 상쇄시키지 않는다.
    const note = (allocByLeaf[lf.name] || {}).note || '';
    if (/ST-\d|DT-\d|BVA|전이 전수|경계/.test(note) && !reasons.some((r) => r.d < 0)) {
      score += 8; reasons.push({ id: 'R7', d: +8, detail: note.slice(0, 60) });
    }

    score = Math.max(0, Math.min(100, score));
    return {
      ...lf, score, grade: score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : 'D',
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

  return { scored, sections, charters, skeleton, cmRows, RULES, autoStop, tokenize };
}

// ── TC(항목) 단위 확신도 ────────────────────────────────────────────────
// 소분류 점수 = "이 화면 전체가 얼마나 근거 있나" / 항목 점수 = "이 TC 한 줄이".
//   · 항목 고유 : R1(그 항목의 [J:기획확인]) · R5(그 단계의 gap) · R3/R4(항목 문장 매칭) · R6(항목별 앵커 깊이)
//   · 소분류 상속 : R2(이미지 마커 — 화면 전체 속성)
function computeItems(SPEC) {
  const ctx = compute(SPEC);
  const { scored, cmRows, tokenize } = ctx;
  const out = [];

  scored.forEach((lf) => {
    const r2 = lf.reasons.find((r) => r.id === 'R2');
    const r7leaf = /ST-\d|DT-\d|BVA|전이 전수|경계/.test(lf.note || '');
    const xrefs = lf.reasons.filter((r) => r.id === 'R3' || r.id === 'R4');

    lf.items.forEach((it) => {
      const reasons = [];
      let score = 100;
      const hay = (it.text + ' ' + lf.name).toLowerCase();

      // R1 — 그 항목에 직접 붙은 미결 질의만
      if (it.jTag && /기획/.test(it.jTag)) { score -= 45; reasons.push({ id: 'R1', d: -45, detail: `${it.stage}-${it.no}` }); }

      // R2 — 화면 전체가 이미지 의존이면 전 항목 상속
      if (r2) { score -= 20; reasons.push({ ...r2, inherited: true }); }

      // R5 — 그 항목의 단계에 gap이 걸린 경우만
      const r5 = lf.reasons.find((r) => r.id === 'R5');
      if (r5 && new RegExp(it.stage).test(r5.detail)) { score -= 15; reasons.push({ id: 'R5', d: -15, detail: r5.detail, stage: it.stage }); }

      // R3/R4 — 용어 단위로 항목 문장에 실제 걸리는 것만 (걸린 용어를 terms로 보존)
      xrefs.forEach((r) => {
        const terms = String(r.detail).split(' / ');
        const hit = terms.filter((t) => {
          const tk = tokenize(t).filter((w) => matchTok(hay, w));
          return tk.some(isIdent) || tk.length >= 1;
        });
        if (hit.length) {
          score += r.d;
          reasons.push({ id: r.id, d: r.d, detail: hit.join(' / '), terms: hit.map((t) => t.split(/[（(]/)[0].trim()) });
        }
      });

      // 항목별 기획서 앵커 (커버리지 매핑 키워드 → 원문 섹션 위치)
      const hitRows = cmRows.filter((r) => r.keywords.some((k) => k && hay.includes(k.toLowerCase())));
      let anchors = [...new Set(hitRows.map((r) => r.src))];
      const depths = hitRows.filter((r) => !/^이전 기록/.test(r.src)).map((r) => r.src.split('-').length);
      const maxD = depths.length ? Math.max(...depths) : 0;
      if (!anchors.length) anchors = lf.anchor.srcs;   // 항목 매칭 실패 시 소분류 앵커로 폴백

      // R6 — 이 항목을 콕 집은 앵커가 없거나 1단계뿐일 때
      if (maxD <= 1) { score -= 18; reasons.push({ id: 'R6', d: -18, detail: anchors.length ? `§${anchors.join(' §')}` : '매핑 안 됨' }); }

      // R7 — 감점 0일 때만
      if (r7leaf && !reasons.some((r) => r.d < 0)) { score += 8; reasons.push({ id: 'R7', d: +8, detail: (lf.note || '').slice(0, 60), inherited: true }); }

      score = Math.max(0, Math.min(100, score));
      const unimplemented = !!(it.jTag && /추후/.test(it.jTag));
      out.push({
        leaf: lf.name, major: lf.major, mid: lf.mid, risk: lf.risk,
        stage: it.stage, no: it.no, text: it.text,
        score, grade: unimplemented ? 'N' : (score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : 'D'),
        unimplemented, reasons, anchors,
      });
    });
  });
  return { items: out, ...ctx };
}

module.exports = { compute, computeItems, RULES, STOP_BASE };
