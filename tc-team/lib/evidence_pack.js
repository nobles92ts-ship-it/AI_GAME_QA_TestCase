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

// 완료처리(S7) 종료코드. 전달 안 되면 "S7 을 못 봤다"는 뜻이므로 PASS 를 주장하지 않는다.
// [왜] 이 봉투는 오래 verdict:'PASS' 하드코딩이었고 호출측(run_pipeline_full.sh)이 frc 를
//      버렸다. finalize.sh 는 try/continue 정책이라 일부 FINAL 단계가 실패해도 exit 20 으로
//      끝나고 체인은 "전 구간 완료"로 exit 0 한다 — 그 런의 봉투도 PASS 를 찍고 있었다.
//      실물: 자동_사냥_기능_v3_20260816_034645.json (FINAL-0 ✗ 인데 verdict PASS)
const frcRaw = arg('frc', '');
const frc = frcRaw === '' ? null : Number(frcRaw);
const verdict = frc === 0 ? 'PASS' : 'PARTIAL';   // 스키마 허용값: PASS | WARN | FAIL | PARTIAL

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
  verdict,
  summary: (verdict === 'PASS'
    ? `tc-team 전 구간 완료 — ${feature}`
    : `tc-team 완주하되 완료처리 일부 미확인 — ${feature} (S7 rc=${frc === null ? '미전달' : frc})`)
    + (tcCount != null ? ` (TC ${tcCount}행)` : ''),
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
