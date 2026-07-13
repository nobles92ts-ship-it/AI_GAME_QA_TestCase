#!/usr/bin/env node
/**
 * state_projection.js — tc-v3: state.json 관측 전용 프로젝션 (계획 §5 강등 / §7 MEDIUM).
 *
 * v2 상태기계(transition.sh)는 폐기하되, pipeline_monitor.js/monitor.bat이 읽는 state.json은
 * 동일 스키마로 계속 기록 → 모니터 무개조. v3 스테이지 → v2 state 어휘 매핑(신규 어휘 도입 금지).
 * 최소 스키마(실측): { specs:[{feature,state,review_round}], currentBatch:[...] }  (updated_at은 monitor 미판독)
 *
 * done 무결성 불변식: state=done이면 review_round=2 고정 (v2 tc-팀-v2.md:158 승계).
 *
 * CLI: state_projection.js <state.json> <feature> <state> [--round N] [--batch f1,f2,...]
 */
'use strict';
const fs = require('fs');

// v3 스테이지 → v2 state 어휘 (전환 배선표 §4 S7)
const STAGE_TO_STATE = {
  S0: 'designing', S1: 'designing',
  S2_review: 'design_reviewing', S2_fix: 'design_fixing',
  S3: 'writing', S4: 'reviewing', S5: 'reviewing_fixing', S6: 'reviewing_fixing',
  done: 'done', failed: 'failed',
};
const ALLOWED = new Set(['designing', 'design_reviewing', 'design_fixing', 'writing', 'reviewing', 'reviewing_fixing', 'done', 'failed']);

function project(stateObj, feature, state, round, batch) {
  // 스테이지 별칭 허용
  const st = STAGE_TO_STATE[state] || state;
  if (!ALLOWED.has(st)) throw new Error(`허용되지 않은 state '${state}'(→'${st}') — 신규 어휘 도입 금지(monitor 호환)`);
  let r = round;
  if (st === 'done') r = 2;                 // 무결성 불변식
  if (r == null) r = 0;

  const data = stateObj && typeof stateObj === 'object' ? stateObj : {};
  data.specs = Array.isArray(data.specs) ? data.specs : [];
  const i = data.specs.findIndex(s => s && s.feature === feature);
  const entry = Object.assign({}, i >= 0 ? data.specs[i] : {}, { feature, state: st, review_round: r });
  if (i >= 0) data.specs[i] = entry; else data.specs.push(entry);

  if (batch) {
    const arr = (batch || []).filter(x => x && typeof x === 'string');
    data.currentBatch = arr;
  } else if (!Array.isArray(data.currentBatch)) {
    data.currentBatch = [];
  }
  return data;
}

module.exports = { project, STAGE_TO_STATE, ALLOWED };

if (require.main === module) {
  const [statePath, feature, state] = process.argv.slice(2);
  const ri = process.argv.indexOf('--round'); const bi = process.argv.indexOf('--batch');
  if (!statePath || !feature || !state) { process.stderr.write('사용: state_projection.js <state.json> <feature> <state> [--round N] [--batch f1,f2]\n'); process.exit(1); }
  let cur = {};
  if (fs.existsSync(statePath)) { try { cur = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { cur = {}; } }
  const round = ri >= 0 ? parseInt(process.argv[ri + 1], 10) : null;
  const batch = bi >= 0 ? process.argv[bi + 1].split(',') : null;
  let out;
  try { out = project(cur, feature, state, round, batch); }
  catch (e) { process.stderr.write('[state_projection] ' + e.message + '\n'); process.exit(1); }
  const tmp = statePath + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(out, null, 2)); fs.renameSync(tmp, statePath);
  const e = out.specs.find(s => s.feature === feature);
  process.stdout.write(JSON.stringify({ ok: true, feature, state: e.state, review_round: e.review_round }) + '\n');
}
