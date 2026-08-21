#!/usr/bin/env node
/**
 * Evidence Pack 공통 봉투 기록기 (정본 스키마: {WORK_ROOT}/tool/_registry/evidence_pack.schema.json)
 *
 * 사용: node evidence_pack.js --feature <기능명> --work <WORK> --spec <SPEC> --sheet <ID> --tab <탭>
 * run_pipeline_full.sh 체인 성공 종점에서 best-effort 호출 — 실패해도 체인에 영향 없음(호출측 || 경고).
 * 산출: {WORK_ROOT}/_no_sync/evidence/tc-team/<기능명>_<stamp>.json
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const feature = arg('feature', '?');
const work = arg('work', '');
const spec = arg('spec', '');
const sheet = arg('sheet', '');
const tab = arg('tab', '');

let tcCount = null;
for (const name of ['tc_final.json', 'tcteam_tc_final.json', 'v3_tc_final.json']) {
  try {
    const fin = JSON.parse(fs.readFileSync(path.join(work, name), 'utf-8'));
    tcCount = Array.isArray(fin) ? fin.length
      : Array.isArray(fin.rows) ? fin.rows.length
      : Array.isArray(fin.tcs) ? fin.tcs.length : null;
    if (tcCount != null) break;
  } catch (e) { /* 집계는 선택 — 다음 후보 */ }
}

let confUrl = '';
try {
  const info = fs.readFileSync(path.join(spec, 'sheet_info.txt'), 'utf-8');
  const m = info.match(/^CONFLUENCE_URL=(.+)$/m);
  if (m) confUrl = m[1].trim().replace(/"/g, '');
} catch (e) { /* 없으면 공란 */ }

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const local = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
const stamp = local.replace(/[-:]/g, '').replace('T', '_');
const runId = `${feature}_${stamp}`;

const pack = {
  schema: 'evidence-pack/v1',
  pipeline: 'tc-team',
  run_id: runId,
  verdict: 'PASS', // 체인 성공 종점에서만 호출됨 — 실패 런은 종점에 도달하지 않는다
  summary: `tc-team 전 구간 완료 — ${feature}` + (tcCount != null ? ` (TC ${tcCount}행)` : ''),
  counts: { tc_rows: tcCount },
  env: { node: os.hostname(), target: `시트 ${sheet} · 탭 ${tab}` },
  source: { type: 'confluence', ref: confUrl, revision: '' },
  started_at: '',
  finished_at: local,
  reports: [spec],
  screenshots: [],
  extra: {},
};

const evDir = '{WORK_ROOT}/_no_sync/evidence/tc-team';
fs.mkdirSync(evDir, { recursive: true });
const out = path.join(evDir, runId + '.json');
fs.writeFileSync(out, JSON.stringify(pack, null, 1), 'utf-8');
console.log('[EVIDENCE] ' + out);
