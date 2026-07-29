// gen_pairwise.js — G5: pairwise covering array 결정론 전개
// 알고리즘: AETG 계열 결정론 탐욕 — 행마다 인자 순서대로 "미커버 쌍 최다" 수준 선택 (동률=최소 인덱스).
// 난수 없음 → 같은 입력이면 같은 배열. 전쌍 커버는 종료 조건으로 보장, 크기 상한은 테스트로 검증
// (예: 4인자×3수준 → ≤13, 전조합 81 대비). IPOG 정확 구현 대신 단순·결정론 우선 — 상한 초과 시 교체 후보.

const { PAIRWISE_ROW } = require('./pattern_catalog');

function fill(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
}

// factors: [{name, levels: [string]}] → 행 배열 (수준 인덱스 배열)
function coveringArray(factors) {
  const k = factors.length;
  if (k === 1) return factors[0].levels.map((_, i) => [i]);

  // 미커버 쌍 집합: "fi:li|fj:lj" (fi<fj)
  const uncovered = new Set();
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      for (let li = 0; li < factors[i].levels.length; li++) {
        for (let lj = 0; lj < factors[j].levels.length; lj++) {
          uncovered.add(`${i}:${li}|${j}:${lj}`);
        }
      }
    }
  }
  const pairKey = (i, li, j, lj) => (i < j ? `${i}:${li}|${j}:${lj}` : `${j}:${lj}|${i}:${li}`);

  const rows = [];
  while (uncovered.size > 0) {
    const row = new Array(k).fill(-1);
    // ① 시드: 미커버 쌍에 가장 많이 등장하는 (인자,수준)을 전역 집계로 선택 (동률=최소 인덱스)
    const freq = new Map();
    for (const key of uncovered) {
      for (const part of key.split('|')) freq.set(part, (freq.get(part) || 0) + 1);
    }
    let seed = null, seedN = -1;
    for (let f = 0; f < k; f++) {
      for (let l = 0; l < factors[f].levels.length; l++) {
        const n = freq.get(`${f}:${l}`) || 0;
        if (n > seedN) { seedN = n; seed = [f, l]; }
      }
    }
    row[seed[0]] = seed[1];
    // ② 잔여 인자: (인자×수준) 전수에서 "설정된 인자들과의 미커버 쌍 수" 최대를 반복 선택 (동률=최소 f, 최소 l)
    for (let step = 1; step < k; step++) {
      let best = null, bestGain = -1;
      for (let f = 0; f < k; f++) {
        if (row[f] !== -1) continue;
        for (let l = 0; l < factors[f].levels.length; l++) {
          let gain = 0;
          for (let g = 0; g < k; g++) {
            if (row[g] === -1 || g === f) continue;
            if (uncovered.has(pairKey(f, l, g, row[g]))) gain++;
          }
          if (gain > bestGain) { bestGain = gain; best = [f, l]; }
        }
      }
      row[best[0]] = best[1];
    }
    let newlyCovered = 0;
    for (let i = 0; i < k; i++) {
      for (let j = i + 1; j < k; j++) {
        const key = pairKey(i, row[i], j, row[j]);
        if (uncovered.has(key)) { uncovered.delete(key); newlyCovered++; }
      }
    }
    // 방어: 0쌍 행이면 잔여쌍 하나를 직접 박아 진행 (시드 보장상 통상 도달 불가)
    if (newlyCovered === 0) {
      const [a, b] = [...uncovered][0].split('|');
      const [fi, li] = a.split(':').map(Number);
      const [fj, lj] = b.split(':').map(Number);
      row[fi] = li; row[fj] = lj;
      for (let i = 0; i < k; i++) {
        for (let j = i + 1; j < k; j++) uncovered.delete(pairKey(i, row[i], j, row[j]));
      }
    }
    rows.push(row);
  }
  return rows;
}

function generate(pairwise, subcatsByKey) {
  const cases = [];
  (pairwise || []).forEach((p, pi) => {
    const sub = subcatsByKey.get(p.subcat);
    const rows = coveringArray(p.factors);
    rows.forEach((row, ri) => {
      const assigns = row.map((l, f) => `${p.factors[f].name}=${p.factors[f].levels[l]}`).join(', ');
      cases.push({
        gen: 'G5',
        subcat: p.subcat,
        stage: PAIRWISE_ROW.stage,
        purpose: fill(PAIRWISE_ROW.purpose, { subcat: sub.name, assigns }),
        trace: { source: 'B-6-pairwise', pairwise_index: pi, row_index: ri, name: p.name, levels: row },
      });
    });
  });
  return { cases, skipped: [] };
}

module.exports = { generate, coveringArray };
