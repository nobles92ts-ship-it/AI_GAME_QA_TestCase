#!/usr/bin/env node
/**
 * golden_diff.js — tc-v3 레버 ③: 골든셋 회귀 비교 (계획 §14 ③).
 *
 * 파이프라인/SSoT 변경 시 골든셋 기능을 재생성 → 동결본과 구조 비교. 품질 드리프트 상시 감지.
 * 비결정(LLM 문장) 우회: 구조 지표는 exact diff, F열 문장은 유사도(임계, advisory).
 *   구조 회귀(행수·기본기능수·검증단계 분포·콘텐츠 위반) = 즉시 실패.
 *
 * CLI: golden_diff.js <golden.json> <new.json> [--sim 0.7]  exit 0=pass / 9=regression
 */
'use strict';
const fs = require('fs');
const { checkContent } = require('./content_gate.js');

const COL = { B: 1, C: 2, D: 3, E: 4, F: 5 };

// 병합(빈값) 그룹핑 채우기 — 연속행 B/C/D 상속
function fillDown(rows) {
  let b = '', c = '', d = '';
  return rows.map(r => {
    if (r[COL.B]) { b = r[COL.B]; c = ''; d = ''; }
    if (r[COL.C]) c = r[COL.C];
    if (r[COL.D]) d = r[COL.D];
    return { b, c, d, e: r[COL.E], f: r[COL.F] || '' };
  });
}

function metrics(rows) {
  const filled = fillDown(rows);
  const eDist = {};
  for (const r of filled) eDist[r.e] = (eDist[r.e] || 0) + 1;
  const distinct = k => new Set(filled.map(r => r[k]).filter(Boolean)).size;
  return {
    rowCount: rows.length,
    basicCount: filled.filter(r => r.b === '기본기능').length,
    qaCount: filled.filter(r => r.b && r.b !== '기본기능').length,
    distinctMid: distinct('c'),
    distinctLeaf: distinct('d'),
    eDist,
    contentViolations: checkContent(rows).violations.length,
  };
}

function tokens(s) { return String(s).toLowerCase().split(/\s+/).filter(Boolean); }
function jaccard(a, b) {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (!A.size && !B.size) return 1;
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

function diff(golden, neu, simThreshold = 0.7) {
  const g = metrics(golden.rows), n = metrics(neu.rows);
  const structuralKeys = ['rowCount', 'basicCount', 'qaCount', 'distinctMid', 'distinctLeaf', 'contentViolations'];
  const deltas = {};
  let structuralRegression = false;
  for (const k of structuralKeys) {
    deltas[k] = { golden: g[k], new: n[k], delta: n[k] - g[k] };
    if (n[k] !== g[k]) structuralRegression = true;
  }
  const eEqual = JSON.stringify(g.eDist) === JSON.stringify(n.eDist);
  if (!eEqual) structuralRegression = true;

  // F열 유사도 (행수 동일할 때만 위치 대응)
  let fSim = null;
  if (g.rowCount === n.rowCount) {
    let identical = 0, simSum = 0;
    for (let i = 0; i < golden.rows.length; i++) {
      const gf = golden.rows[i][COL.F] || '', nf = neu.rows[i][COL.F] || '';
      if (gf === nf) identical++;
      simSum += jaccard(gf, nf);
    }
    const avg = golden.rows.length ? simSum / golden.rows.length : 1;
    fSim = { identical, changed: golden.rows.length - identical, avg_similarity: +avg.toFixed(3), below_threshold: avg < simThreshold };
  }

  const verdict = structuralRegression ? 'regression'
    : (fSim && fSim.below_threshold ? 'advisory_drift' : 'pass');
  return { verdict, structuralRegression, deltas, eDist: { golden: g.eDist, new: n.eDist, equal: eEqual }, fSim };
}

module.exports = { diff, metrics };

if (require.main === module) {
  const [gp, np] = process.argv.slice(2);
  const si = process.argv.indexOf('--sim');
  if (!gp || !np) { process.stderr.write('사용: golden_diff.js <golden.json> <new.json> [--sim 0.7]\n'); process.exit(1); }
  const golden = JSON.parse(fs.readFileSync(gp, 'utf8'));
  const neu = JSON.parse(fs.readFileSync(np, 'utf8'));
  const sim = si >= 0 ? parseFloat(process.argv[si + 1]) : 0.7;
  const res = diff(golden, neu, sim);
  process.stdout.write(JSON.stringify(res, null, 1) + '\n');
  process.exit(res.verdict === 'regression' ? 9 : 0);
}
