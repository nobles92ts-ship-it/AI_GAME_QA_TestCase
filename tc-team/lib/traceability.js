#!/usr/bin/env node
/**
 * traceability.js — tc-v3 레버 ②: 기획서 → TC 역추적 원장 + 커버리지 차단 게이트.
 *
 * 설계 근거: tc-v3 계획 §14 ② / §7 CRITICAL "원문 대조의 산출물화" / C-12의 상류판(기획서→TC).
 * slicer.rules(원문 규칙 앵커) + coverage(설계 단계 rule_id 태깅) + exclusions(제외 화이트리스트)
 *   → 역매핑 표 {rule_id → [tc_ids], status} + 미커버 게이트.
 *
 * status: covered(≥1 TC) / excluded(제외 화이트리스트 사유) / uncovered(둘 다 아님 → 게이트 위반)
 * 제외 사유 화이트리스트: 임의 누락 방지 — 정해진 사유만 허용.
 *
 * CLI: traceability.js <rules.json|slices.json> <coverage.json> [<exclusions.json>] <out.json>
 *      exit 0=커버리지 완전 / 8=미커버 존재(차단)
 */
'use strict';
const fs = require('fs');

// M-021(이관감사 2026-07-16): '추후구현' 제거 — v2 tc-생성.md:271 "추후구현도 TC 작성(J=추후 구현·H/I=N/A)" 승계.
// 추후구현 규칙은 제외 불가 → 미커버 시 S5 봉합 루프(add_row)가 TC를 생성해야 한다.
const EXCLUSION_REASONS = ['타기획서', '비TC성서술', '중복규칙'];

/**
 * 래퍼 허용: 원장 생성이 LLM 산출이라 `{coverage:[...]}` / `{exclusions:[...]}` 형태로 오는 일이 잦다.
 * 예전엔 exclusions 래퍼가 곧장 TypeError로 체인을 세웠다(2026-07-29 월드맵 런). 배열·래퍼 둘 다 받는다.
 */
function unwrap(j, key) {
  if (Array.isArray(j)) return j;
  if (j && Array.isArray(j[key])) return j[key];
  return j;
}

/**
 * @param rules      [{rule_id, sec_id, text}]           slicer.rules
 * @param coverage   {rule_id: [tc_id,...]} | [{rule_id, tc_ids}] | {coverage:[...]}
 * @param exclusions [{rule_id, reason}] | {exclusions:[...]}   reason ∈ EXCLUSION_REASONS
 */
function buildLedger(rules, coverage, exclusions = []) {
  const cov = unwrap(coverage, 'coverage');
  const ex = unwrap(exclusions, 'exclusions');
  const covMap = Array.isArray(cov)
    ? Object.fromEntries(cov.map(c => [c.rule_id, c.tc_ids || []]))
    : (cov || {});
  const exMap = Array.isArray(ex)
    ? Object.fromEntries(ex.map(e => [e.rule_id, e.reason]))
    : (ex || {});

  const mapped = [];
  const uncovered = [];
  const badExclusion = [];

  for (const r of rules) {
    const tcs = covMap[r.rule_id] || [];
    const exReason = exMap[r.rule_id];
    let status;
    if (tcs.length > 0) status = 'covered';
    else if (exReason) {
      status = 'excluded';
      if (!EXCLUSION_REASONS.includes(exReason)) badExclusion.push({ rule_id: r.rule_id, reason: exReason });
    } else { status = 'uncovered'; uncovered.push(r.rule_id); }
    mapped.push({ rule_id: r.rule_id, sec_id: r.sec_id, text: r.text, tc_ids: tcs, status, exclusion: exReason || null });
  }

  // coverage가 존재하지 않는 rule_id를 가리키면 = stale 태깅(설계-기획서 드리프트)
  const ruleIds = new Set(rules.map(r => r.rule_id));
  const danglingCoverage = Object.keys(covMap).filter(rid => !ruleIds.has(rid));

  const gatePass = uncovered.length === 0 && badExclusion.length === 0 && danglingCoverage.length === 0;
  return {
    mapped, uncovered, badExclusion, danglingCoverage,
    summary: {
      rules: rules.length,
      covered: mapped.filter(m => m.status === 'covered').length,
      excluded: mapped.filter(m => m.status === 'excluded').length,
      uncovered: uncovered.length,
      coverage_rate: rules.length ? +(mapped.filter(m => m.status !== 'uncovered').length / rules.length).toFixed(3) : 1,
    },
    gate: { pass: gatePass, uncovered: uncovered.length, bad_exclusion: badExclusion.length, dangling: danglingCoverage.length },
  };
}

module.exports = { buildLedger, EXCLUSION_REASONS };

// ── CLI ──
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 3) { process.stderr.write('사용: traceability.js <rules|slices.json> <coverage.json> [exclusions.json] <out.json>\n'); process.exit(1); }
  const outPath = args[args.length - 1];
  const rulesPath = args[0], covPath = args[1];
  const exPath = args.length >= 4 ? args[2] : null;
  const rj = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
  const rules = Array.isArray(rj) ? rj : (rj.rules || []);
  const coverage = JSON.parse(fs.readFileSync(covPath, 'utf8'));
  const exclusions = exPath && fs.existsSync(exPath) ? JSON.parse(fs.readFileSync(exPath, 'utf8')) : [];
  const res = buildLedger(rules, coverage, exclusions);
  const tmp = outPath + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(res, null, 1)); fs.renameSync(tmp, outPath);
  process.stdout.write(JSON.stringify({ ok: res.gate.pass, ...res.summary, gate: res.gate }) + '\n');
  process.exit(res.gate.pass ? 0 : 8);
}
