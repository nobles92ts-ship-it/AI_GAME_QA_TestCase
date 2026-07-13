#!/usr/bin/env node
/**
 * ab_compare.js — tc-v3 A/B: v2 탭 vs v3 tc_final 결정론 비교 지표 (계획 Phase 3 정량 게이트).
 *
 * golden_diff는 "구조 차이 감지"만 한다 — A/B는 그 차이가 개선/후퇴인지 판정해야 하므로
 * 정량 지표를 한 번들로 산출한다(품질 판정은 별도 judge agent가 이 번들 위에서 수행):
 *   ① TC 수(총/기본/QA)  ② 콘텐츠 위반(FINAL-4, 양쪽)  ③ 구조(중/소 distinct·검증단계 분포)
 *   ④ 규칙 커버리지(slicer rules 대비 토큰 겹침 근사 — approximate 라벨)
 *
 * CLI: ab_compare.js <v2_snapshot.json> <v3_snapshot.json> <slices.json> [out.json]
 */
'use strict';
const fs = require('fs');
const { checkContent } = require('./content_gate.js');
const { metrics } = require('./golden_diff.js');

function tok(s) { return String(s || '').toLowerCase().replace(/[(),.!?"'\[\]]/g, ' ').split(/\s+/).filter(w => w.length >= 2); }

// 규칙 커버리지 근사: 규칙의 distinctive 토큰이 어떤 TC F에 충분히 나타나면 covered
function coverage(rules, rows, ratio = 0.34) {
  const fTokenSets = rows.map(r => new Set(tok(r[5])));
  let covered = 0; const missed = [];
  for (const rule of rules) {
    const rt = [...new Set(tok(rule.text))].filter(w => !['확인', '되는지', '상태', '경우', '표시', '자동'].includes(w));
    if (!rt.length) { covered++; continue; }
    const hit = fTokenSets.some(fs => rt.filter(t => fs.has(t)).length / rt.length >= ratio);
    if (hit) covered++; else missed.push(rule.rule_id);
  }
  return { total: rules.length, covered, rate: rules.length ? +(covered / rules.length).toFixed(3) : 1, missed };
}

function compare(v2, v3, rules) {
  const g = metrics(v2.rows), n = metrics(v3.rows);
  const c2 = checkContent(v2.rows), c3 = checkContent(v3.rows);
  const cov2 = coverage(rules, v2.rows), cov3 = coverage(rules, v3.rows);
  const pct = (a, b) => b === 0 ? null : +(((a - b) / b) * 100).toFixed(1);
  return {
    counts: {
      total: { v2: g.rowCount, v3: n.rowCount, delta: n.rowCount - g.rowCount, pct: pct(n.rowCount, g.rowCount) },
      basic: { v2: g.basicCount, v3: n.basicCount }, qa: { v2: g.qaCount, v3: n.qaCount },
    },
    content_violations: { v2: c2.violations.length, v3: c3.violations.length },
    structure: { distinctMid: { v2: g.distinctMid, v3: n.distinctMid }, distinctLeaf: { v2: g.distinctLeaf, v3: n.distinctLeaf }, eDist: { v2: g.eDist, v3: n.eDist } },
    coverage_approx: {
      note: '토큰 겹침 근사 — 절대치보다 v2/v3 상대 비교 용도',
      v2: { rate: cov2.rate, covered: cov2.covered, of: cov2.total },
      v3: { rate: cov3.rate, covered: cov3.covered, of: cov3.total },
      v3_only: cov2.missed.filter(r => !cov3.missed.includes(r)),   // v3가 추가로 커버
      v2_only: cov3.missed.filter(r => !cov2.missed.includes(r)),   // v2만 커버(v3 놓침 — 주의)
    },
  };
}

module.exports = { compare, coverage };

if (require.main === module) {
  const [p2, p3, ps, out] = process.argv.slice(2);
  if (!p2 || !p3 || !ps) { process.stderr.write('사용: ab_compare.js <v2.json> <v3.json> <slices.json> [out.json]\n'); process.exit(1); }
  const v2 = JSON.parse(fs.readFileSync(p2, 'utf8'));
  const v3 = JSON.parse(fs.readFileSync(p3, 'utf8'));
  const rules = (JSON.parse(fs.readFileSync(ps, 'utf8')).rules) || [];
  const res = compare(v2, v3, rules);
  if (out) fs.writeFileSync(out, JSON.stringify(res, null, 1));
  process.stdout.write(JSON.stringify(res, null, 1) + '\n');
}
