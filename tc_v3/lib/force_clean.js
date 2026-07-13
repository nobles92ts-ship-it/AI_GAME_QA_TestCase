#!/usr/bin/env node
/**
 * force_clean.js — tc-v3 「처음부터」(--force) 초기화 (계획 §6 신설 / 결함 #7 봉합).
 *
 * 해시 게이트·마커·카운터가 사용자 "처음부터" 의도를 이기는 결함을 봉합:
 * 파이프라인 잔존물을 삭제해 STEP 1부터 완전 재생성 강제. confluence_raw.md·sheet_info.txt는 보존(원문/설정).
 * 시트의 기존 탭은 불가침(신규 v접미사) — 이 유틸은 로컬 specs만 건드림.
 *
 * 적용 단위 = 기능 1개 (배치 전체 초기화는 호출측이 기능마다 반복). 삭제 전 목록을 stdout으로 보고.
 *
 * CLI: force_clean.js <specDir> [--dry]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const PRESERVE = new Set(['confluence_raw.md', 'sheet_info.txt']);
// 명시 삭제 대상(정확 파일명) + 접두 패턴
const EXACT = [
  'analysis.md', 'tc_design.md', 'design_review.md', 'design_review.json',
  'tc_skeleton.json', 'tc_f_map.json', 'tc_data.json', 'tc_snapshot.json',
  'fix_plan.json', 'tc_final.json', 'tc_final.ok', 'applied_patches.json',
  'traceability.json', 'coverage.json', 'exclusions.json', 'slices.json',
  'conversion_blocker.json', 'f_violations.json', 'upload_verify.json',
  'owner_marker.json', 'precheck_round1.json', 'precheck_round2.json',
  'step_result.json',
];
const PREFIX = ['v3_fmap_part_', 'v3_s', 'step', 'review_']; // v3_s*_attempts.txt, step*_result.json, review_*.md
const SUFFIX_OK = ['.txt', '.json', '.md'];

function planDeletions(specDir) {
  if (!fs.existsSync(specDir)) throw new Error('specDir 없음: ' + specDir);
  const del = [];
  for (const f of fs.readdirSync(specDir)) {
    if (PRESERVE.has(f)) continue;
    const isExact = EXACT.includes(f);
    const isPrefix = PREFIX.some(p => f.startsWith(p)) && SUFFIX_OK.some(s => f.endsWith(s));
    if (isExact || isPrefix) del.push(f);
  }
  return del;
}

function forceClean(specDir, dry) {
  const del = planDeletions(specDir);
  if (!dry) for (const f of del) { try { fs.rmSync(path.join(specDir, f), { force: true }); } catch {} }
  return del;
}

module.exports = { forceClean, planDeletions, PRESERVE };

if (require.main === module) {
  const specDir = process.argv[2];
  const dry = process.argv.includes('--dry');
  if (!specDir) { process.stderr.write('사용: force_clean.js <specDir> [--dry]\n'); process.exit(1); }
  let del;
  try { del = forceClean(specDir, dry); }
  catch (e) { process.stderr.write('[force_clean] ' + e.message + '\n'); process.exit(1); }
  process.stdout.write(JSON.stringify({ ok: true, dry: !!dry, deleted: del.length, files: del, preserved: [...PRESERVE] }) + '\n');
}
