'use strict';
/**
 * confidence_local.js — 시트 없이 확신도 (사람용은 S7 FINAL-0 이 라이브 시트 격자를 읽어 계산한다).
 *
 * 산식은 tc-team `scripts/confidence/confidence_core.js` 를 그대로 부른다 — 여기엔 사본이 없다.
 * 시트 격자 자리에 S5 확정본 행을 넣고, 매핑 판정(stampGate: 항목 0건·드리프트 과반 = 실패)도 같은 함수로 한다.
 *
 * 사용: node confidence_local.js <specs/기능명 폴더>   → <폴더>/ai_confidence.json
 */
const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('./paths');
const core = require(path.join(PROJECT_ROOT, 'tc-team', 'scripts', 'confidence', 'confidence_core'));
const { readFinal } = require('./tc_rows');

const OUT = 'ai_confidence.json';

function computeLocal(spec) {
  let items;
  try { ({ items } = core.computeItems(spec)); } catch (e) { return { ok: false, code: 'compute_error', msg: e.message }; }
  const g0 = core.stampGate({ items: items.length });
  if (!g0.ok) return { ok: false, code: g0.code, msg: g0.msg };

  const { records } = readFinal(spec);
  const grid = [['TC ID', '대분류', '중분류', '소분류', '검증단계'], ...records.map((r) => [r.id, r.b, r.m, r.s, r.stage])];
  const { perRow, drift } = core.mapRowsToItems(grid, items);
  const g1 = core.stampGate({ items: items.length, matched: perRow.length, drift: drift.length });
  if (!g1.ok) return { ok: false, code: g1.code, msg: g1.msg };

  const dist = perRow.reduce((a, p) => ({ ...a, [p.it.grade]: (a[p.it.grade] || 0) + 1 }), {});
  return {
    ok: true,
    data: {
      source: `${path.basename(spec)}/tcteam_tc_final.json (시트 없음 — tc-team-ai)`,
      generated_at: new Date().toISOString(),
      summary: { dist, total: perRow.length },
      drift,
      items: perRow.map((p) => ({ tcid: p.tcid, grade: p.it.grade, score: p.it.score, anchors: p.it.anchors || [] })),
    },
  };
}

function writeLocal(spec) {
  const r = computeLocal(spec);
  if (r.ok) fs.writeFileSync(path.join(spec, OUT), JSON.stringify(r.data, null, 1), 'utf8');
  return r;
}

module.exports = { OUT, computeLocal, writeLocal };

if (require.main === module) {
  const spec = process.argv[2];
  if (!spec || !fs.existsSync(spec)) { console.error('사용: node confidence_local.js <specs/기능명 폴더>'); process.exit(1); }
  const r = writeLocal(spec);
  if (!r.ok) { console.error(`[확신도] ✗ ${r.code} — ${r.msg}`); process.exit(2); }
  const d = r.data.summary.dist;
  console.log(`[확신도] A ${d.A || 0} · B ${d.B || 0} · C ${d.C || 0} · D ${d.D || 0} · N ${d.N || 0} (총 ${r.data.summary.total}) → ${OUT}`);
}
