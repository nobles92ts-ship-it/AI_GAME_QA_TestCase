#!/usr/bin/env node
/**
 * dup_gate.js — 중복 TC 검출 게이트 (2026-07-28 신설)
 *
 * 배경: EVAL-07(중복 TC)은 규칙상 "검출=기계"로 명시돼 있었으나 **tc-team 체인에 배선된 적이 없다**.
 *   구현체는 구 v2 `scripts/util/review_precheck.js`(V-07d)에만 있었고 run_pipeline_full.sh는 호출하지 않는다.
 *   그 결과 기능AF_v2 첫 실런에서 QA 본문에 F열 **완전 동일 쌍 3개**(233≡245·234≡246·240≡251)가
 *   시트까지 도달했다(구본은 QA 본문 완전중복 0). "중복 0건"은 측정된 적 없는 값이었다.
 *
 * 정책 — 두 단계로 나눈다 (오탐이 정당한 분리를 죽이지 않게):
 *   ① 완전 동일(정규화 후 F열 일치) = **위반**. 소분류가 달라도 테스터가 두 행을 구별할 수 없으므로
 *      어떤 경우에도 정당하지 않다. exit 1 → 병합/차별화 후 재실행.
 *   ② 유사(토큰 자카드 ≥ threshold) = **후보 리포트**. BVA 상·하한처럼 정당한 유사가 많아 자동 판정 금지 —
 *      S4 판정자 입력으로 넘겨 사람/LLM이 병합 여부를 정한다.
 *   ③ 도장 묶음(유사 쌍을 이은 묶음이 소분류 3곳 이상) = **후보 리포트**. 종료코드에 영향 없음(2026-11-13).
 *
 * 스코프: **QA 본문끼리만**(대분류 "기본기능" 제외). 기본기능 섹션은 기획자 검수용 재기술이라
 *   본문과의 중복이 설계상 의도된 것이다(tc-생성 기본기능 규칙 / eval_digest [공통] EVAL 제외 조항).
 *   ⚠ 단 기본기능 **내부**끼리의 완전 동일은 의도가 아니므로 검사한다.
 *
 * 사용: node dup_gate.js <snapshot|tc_final.json> [--out <report.json>] [--threshold 0.85]
 * exit 0=완전동일 0건 / 1=완전동일 발견(차단) / 2=인자·입력 오류
 */

const fs = require('fs');

// 정규화: 구두점·공백 차이만 제거. 조사/어미는 건드리지 않는다(의미 손실 방지).
function norm(s) {
  return String(s == null ? '' : s)
    .replace(/[“”"'`]/g, '')
    .replace(/[()（）\[\]{}]/g, ' ')
    .replace(/[.,·:;!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(s) {
  return new Set(norm(s).split(' ').filter(t => t.length > 1));
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

function checkDuplicates(rows, threshold = 0.85) {
  const exact = [];
  const similar = [];

  // 그룹: QA 본문 / 기본기능 — 교차 비교는 하지 않는다(설계상 의도된 재기술)
  const groups = {
    qa: rows.filter(r => r[1] !== '기본기능'),
    basic: rows.filter(r => r[1] === '기본기능'),
  };

  for (const [scope, list] of Object.entries(groups)) {
    // ① 완전 동일 — 정규화 문자열 해시로 O(n)
    const byText = new Map();
    for (const r of list) {
      const k = norm(r[5]);
      if (!k) continue;
      if (!byText.has(k)) byText.set(k, []);
      byText.get(k).push(r);
    }
    for (const [text, group] of byText) {
      if (group.length > 1) {
        exact.push({
          scope,
          tc_ids: group.map(r => String(r[0])),
          text,
          classes: group.map(r => `${r[1]}>${r[2]}>${r[3]}`),
        });
      }
    }

    // ② 유사 — 완전 동일로 이미 잡힌 것은 제외
    const exactIds = new Set(exact.flatMap(e => (e.scope === scope ? e.tc_ids : [])));
    const cand = list.filter(r => !exactIds.has(String(r[0])));
    const toks = cand.map(r => ({ r, t: tokens(r[5]) }));
    for (let i = 0; i < toks.length; i++) {
      for (let j = i + 1; j < toks.length; j++) {
        const score = jaccard(toks[i].t, toks[j].t);
        if (score >= threshold) {
          similar.push({
            scope,
            tc_ids: [String(toks[i].r[0]), String(toks[j].r[0])],
            score: Math.round(score * 100) / 100,
            same_class: `${toks[i].r[1]}>${toks[i].r[2]}>${toks[i].r[3]}` === `${toks[j].r[1]}>${toks[j].r[2]}>${toks[j].r[3]}`,
            texts: [toks[i].r[5], toks[j].r[5]],
          });
        }
      }
    }
  }

  similar.sort((a, b) => b.score - a.score);
  return { exact, similar, stamps: stampClusters(rows, similar) };
}

// ③ 도장 묶음 (2026-11-13) — 유사 쌍을 이어 붙인 묶음 중 **소분류 3곳 이상**에 걸친 것만 낸다. 비차단(리포트).
//   배경: 유사는 쌍 목록이라 판정자가 읽을 수 없는 크기가 된다(1액트 dup_report_final.json 3.5MB).
//   같은 틀 문장을 이름만 바꿔 여러 소분류에 찍은 「도장」은 쌍이 아니라 묶음으로 봐야 보인다.
//   ⚠ 정당한 축 전개(구간별 기준값 등)도 잡힌다 — 그래서 위반이 아니라 후보다. 판정은 S4 EVAL-07.
const STAMP_MIN_CLASSES = 3; // 고른 값 — 2곳은 BVA 상·하한·소형/대형 같은 정당한 짝이 대부분이라 뺀다
function stampClusters(rows, similar) {
  const byId = new Map(rows.map(r => [String(r[0]), r]));
  const parent = new Map();
  const find = x => {
    let p = x;
    while (parent.get(p) !== p) p = parent.get(p);
    parent.set(x, p);
    return p;
  };
  for (const s of similar) {
    for (const id of s.tc_ids) if (!parent.has(id)) parent.set(id, id);
    parent.set(find(s.tc_ids[0]), find(s.tc_ids[1]));
  }
  const clusters = new Map();
  for (const id of parent.keys()) {
    const root = find(id);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(id);
  }
  const stamps = [];
  for (const ids of clusters.values()) {
    const members = ids.map(id => byId.get(id)).filter(Boolean);
    const classes = new Set(members.map(r => `${r[1]}>${r[2]}>${r[3]}`));
    if (classes.size < STAMP_MIN_CLASSES) continue;
    stamps.push({
      scope: members[0][1] === '기본기능' ? 'basic' : 'qa',
      size: members.length,
      classes: classes.size,
      stages: [...new Set(members.map(r => r[4]))],
      text: members[0][5],
      tc_ids: members.map(r => String(r[0])),
    });
  }
  stamps.sort((a, b) => b.size - a.size);
  return stamps;
}

module.exports = { checkDuplicates, stampClusters, norm, tokens, jaccard };

if (require.main === module) {
  const a = process.argv.slice(2);
  const src = a[0];
  if (!src) {
    process.stderr.write('사용: dup_gate.js <snapshot|tc_final.json> [--out <report.json>] [--threshold 0.85]\n');
    process.exit(2);
  }
  const outIdx = a.indexOf('--out');
  const thIdx = a.indexOf('--threshold');
  const out = outIdx >= 0 ? a[outIdx + 1] : null;
  const threshold = thIdx >= 0 ? parseFloat(a[thIdx + 1]) : 0.85;

  let rows;
  try {
    const j = JSON.parse(fs.readFileSync(src, 'utf8'));
    rows = Array.isArray(j) ? j : j.rows;
    if (!Array.isArray(rows)) throw new Error('rows 배열 없음');
  } catch (e) {
    process.stderr.write(`[dup_gate] 입력 읽기 실패: ${e.message}\n`);
    process.exit(2);
  }

  const res = checkDuplicates(rows, threshold);
  const summary = {
    ok: res.exact.length === 0,
    total: rows.length,
    exact: res.exact.length,
    similar: res.similar.length,
    stamps: res.stamps.length,
    stamp_rows: res.stamps.reduce((n, s) => n + s.size, 0),
    threshold,
  };
  if (out) fs.writeFileSync(out, JSON.stringify({ ...summary, ...res }, null, 1));
  console.log(JSON.stringify(summary));

  for (const e of res.exact) {
    console.log(`  [완전동일] ${e.tc_ids.join('≡')} (${e.scope}) — ${e.text.slice(0, 60)}`);
  }
  if (res.similar.length) {
    console.log(`  [유사 후보] ${res.similar.length}쌍 (판정=S4, 상위 3)`);
    for (const s of res.similar.slice(0, 3)) {
      console.log(`    ${s.tc_ids.join('↔')} score=${s.score}${s.same_class ? ' 동일분류' : ''}`);
    }
  }
  if (res.stamps.length) {
    console.log(`  [도장 묶음] ${summary.stamps}개 · ${summary.stamp_rows}행 (같은 틀이 소분류 ${STAMP_MIN_CLASSES}곳 이상 — 판정=S4, 상위 3)`);
    for (const s of res.stamps.slice(0, 3)) {
      console.log(`    ${s.size}행·소분류 ${s.classes}곳 — ${String(s.text).slice(0, 60)}`);
    }
  }
  process.exit(res.exact.length ? 1 : 0);
}
