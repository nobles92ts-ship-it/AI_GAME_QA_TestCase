#!/usr/bin/env node
/**
 * design_gate.js — tc-v3 S2: 설계 기계 게이트 (계획 §4 S2 / §9 격리 실행).
 *
 * direct_convert.js `convert`를 게이트로 사용하되 ⚠ 격리 디렉토리 사본에서 실행:
 *   convert는 진입 시 tc_skeleton/tc_f_map/conversion_blocker/f_violations 4종을 무조건 선삭제한다
 *   (direct_convert.js:52-54 실측). 본 specs에서 직접 돌리면 S3 산출물이 파괴됨 → 사본 격리.
 * 게이트 판정: convert exit 0=통과(전개 가능) / 4=설계 결함(blocker, S2 수정 루프) / 그외=오류.
 *
 * C-12 전개율(분석→설계)은 analysis C-1 파싱이 필요 — Phase 2 배선 예정(여기선 convert 게이트만).
 *
 * CLI: design_gate.js <tc_design.md> [--converter <direct_convert.js>] [--node <node.exe>]
 *      exit 0=통과 / 4=blocker / 1=오류
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

// 배포본에서도 돌도록 레이아웃 상대 해석 (tc-team/lib/ → 프로젝트 루트/scripts/util/)
const DEFAULT_CONVERTER = process.env.TCTEAM_CONVERTER
  || path.resolve(__dirname, '..', '..', 'scripts', 'util', 'direct_convert.js');

function runGate(designPath, opts = {}) {
  if (!fs.existsSync(designPath)) return { pass: false, exit: 1, error: '설계 파일 없음: ' + designPath };
  const converter = opts.converter || DEFAULT_CONVERTER;
  const node = opts.node || process.execPath;

  // 격리 사본 디렉토리 (본 specs 불가침)
  const iso = opts.workDir || fs.mkdtempSync(path.join(os.tmpdir(), 'tcv3gate-'));
  fs.mkdirSync(iso, { recursive: true });
  const designCopy = path.join(iso, 'tc_design.md');
  fs.copyFileSync(designPath, designCopy);

  const r = spawnSync(node, [converter, 'convert', designCopy, iso], { encoding: 'utf8' });
  const exit = r.status;
  const out = { exit };

  if (exit === 0) {
    try { const sk = JSON.parse(fs.readFileSync(path.join(iso, 'tc_skeleton.json'), 'utf8'));
      out.pass = true; out.counts = { basic: sk.basic_count, qa: sk.qa_count, total: sk.total, design_hash: sk.design_hash };
    } catch (e) { out.pass = false; out.error = 'skeleton 읽기 실패: ' + e.message; }
  } else if (exit === 4) {
    out.pass = false;
    try { out.blocker = JSON.parse(fs.readFileSync(path.join(iso, 'conversion_blocker.json'), 'utf8')); } catch {}
  } else {
    out.pass = false; out.error = (r.stderr || '').slice(0, 500);
  }

  // 격리 디렉토리 정리 (blocker면 경로 반환해 디버그 가능)
  if (opts.keep || (exit === 4 && !opts.cleanupOnBlock)) out.isolated_dir = iso;
  else { try { fs.rmSync(iso, { recursive: true, force: true }); } catch {} }
  return out;
}

module.exports = { runGate };

if (require.main === module) {
  const designPath = process.argv[2];
  const ci = process.argv.indexOf('--converter'); const ni = process.argv.indexOf('--node');
  if (!designPath) { process.stderr.write('사용: design_gate.js <tc_design.md> [--converter <path>] [--node <path>]\n'); process.exit(1); }
  const res = runGate(designPath, {
    converter: ci >= 0 ? process.argv[ci + 1] : undefined,
    node: ni >= 0 ? process.argv[ni + 1] : undefined,
  });
  process.stdout.write(JSON.stringify(res) + '\n');
  process.exit(res.pass ? 0 : (res.exit === 4 ? 4 : 1));
}
