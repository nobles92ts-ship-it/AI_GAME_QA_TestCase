#!/usr/bin/env node
/**
 * apply_fix_plan.js — tc-v3 S5: fix_plan(리뷰 판정자 산출)을 tc_snapshot에 결정론 적용.
 *
 * 설계 근거: tc-v3 계획 §4 S5 / §7 "행 추가·삭제 처방 능력" / B1 "ledger 멱등".
 * LLM은 시트를 모른다 — 판정자는 fix_plan(JSON)만 내고, 셀 변형은 이 스크립트가 결정론 수행.
 *
 * 입력 스냅샷 계약(tc_snapshot.json / tc_final 초안 동형):
 *   { headers:[...10], rows:[[A,B,C,D,E,F,G,H,I,J], ...] }  // A=TC ID, 연속행 B~D는 "" 병합
 *
 * fix_plan.json 계약:
 *   { patches: [
 *       { op:"edit_cell", tc_id:"042", col:"F", before:"...", after:"...", reason:"..." },
 *       { op:"add_row", after_tc_id:"042", row:{b,c,d,e,f,g,h?,i?,j?}, reason:"..." },
 *       { op:"delete_row", tc_id:"091", reason:"..." }
 *   ] }
 *
 * 멱등: patch_id(정규화 해시)를 applied_patches.json ledger에 기록 → 재실행 시 적용분 스킵.
 *   (edit_cell은 current==after no-op으로도 멱등, add_row는 ledger로만 멱등)
 * 충돌: edit_cell before 불일치·앵커/대상 tc_id 부재 → 적용 안 함, ledger 미기록(수정 후 재시도 가능), conflicts에 수집.
 *
 * 적용 순서(계획 §4 — 결정론): 원본 tc_id 기준 edit → delete 표시 → add 앵커 삽입 → 삭제 반영 → 삽입 반영 → A열 재번호.
 *
 * CLI: node apply_fix_plan.js <snapshot.json> <fix_plan.json> <out.json> [--ledger <ledger.json>]
 *      종료코드: 0=적용(충돌 0) / 6=충돌 존재(부분 적용, 사람 확인) / 1=입력 오류
 */
'use strict';
const fs = require('fs');
const crypto = require('crypto');

const COL = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7, I: 8, J: 9 };

function patchId(p) {
  // 정규화: 적용 결과를 규정하는 필드만 (reason은 제외 — 문구만 바뀌어도 같은 패치)
  let key;
  if (p.op === 'edit_cell') key = ['edit', p.tc_id, p.col, p.after].join('');
  else if (p.op === 'add_row') key = ['add', p.after_tc_id, JSON.stringify(p.row || {})].join('');
  else if (p.op === 'delete_row') key = ['del', p.tc_id].join('');
  else key = ['?', JSON.stringify(p)].join('');
  return crypto.createHash('sha1').update(key).digest('hex').slice(0, 12);
}

function buildRow(obj) {
  const o = obj || {};
  return ['', o.b || '', o.c || '', o.d || '', o.e || '', o.f || '', o.g || '',
    o.h || '미진행', o.i || '미진행', o.j || ''];
}

/**
 * @returns {{rows, ledger:{applied:string[]}, applied:object[], skipped:object[], conflicts:object[]}}
 */
function applyFixPlan(snapshot, plan, ledgerIn) {
  const rows = snapshot.rows.map(r => r.slice()); // immutable copy
  const ledgerSet = new Set((ledgerIn && ledgerIn.applied) || []);
  const applied = [], skipped = [], conflicts = [];
  const deletes = new Set();       // tc_id
  const inserts = [];              // {anchor, row, pid}

  const findIdx = id => rows.findIndex(r => r[COL.A] === id);

  for (const p of plan.patches || []) {
    const pid = patchId(p);
    if (ledgerSet.has(pid)) { skipped.push({ pid, op: p.op, reason: 'ledger_hit' }); continue; }

    if (p.op === 'edit_cell') {
      const ci = COL[p.col];
      if (ci === undefined) { conflicts.push({ pid, op: p.op, reason: 'bad_col', col: p.col }); continue; }
      const i = findIdx(p.tc_id);
      if (i < 0) { conflicts.push({ pid, op: p.op, tc_id: p.tc_id, reason: 'tc_id_not_found' }); continue; }
      const cur = rows[i][ci];
      if (cur === p.after) { applied.push({ pid, op: p.op, tc_id: p.tc_id, col: p.col, noop: true }); ledgerSet.add(pid); continue; }
      if (p.before != null && cur !== p.before) {
        conflicts.push({ pid, op: p.op, tc_id: p.tc_id, col: p.col, reason: 'before_mismatch', current: cur, expected: p.before });
        continue;
      }
      rows[i][ci] = p.after;
      applied.push({ pid, op: p.op, tc_id: p.tc_id, col: p.col });
      ledgerSet.add(pid);
    } else if (p.op === 'delete_row') {
      if (findIdx(p.tc_id) < 0) { conflicts.push({ pid, op: p.op, tc_id: p.tc_id, reason: 'tc_id_not_found' }); continue; }
      deletes.add(p.tc_id);
      applied.push({ pid, op: p.op, tc_id: p.tc_id });
      ledgerSet.add(pid);
    } else if (p.op === 'add_row') {
      if (findIdx(p.after_tc_id) < 0) { conflicts.push({ pid, op: p.op, after_tc_id: p.after_tc_id, reason: 'anchor_not_found' }); continue; }
      inserts.push({ anchor: p.after_tc_id, row: buildRow(p.row), pid });
      applied.push({ pid, op: p.op, after_tc_id: p.after_tc_id });
      ledgerSet.add(pid);
    } else {
      conflicts.push({ pid, op: p.op, reason: 'unknown_op' });
    }
  }

  // 삭제 반영
  let out = rows.filter(r => !deletes.has(r[COL.A]));
  // 삽입 반영 — 앵커 tc_id의 (삭제 후) 현재 위치 뒤에, 같은 앵커는 patch 순서 유지
  for (const ins of inserts) {
    const at = out.findIndex(r => r[COL.A] === ins.anchor);
    if (at < 0) { conflicts.push({ pid: ins.pid, op: 'add_row', after_tc_id: ins.anchor, reason: 'anchor_removed' }); continue; }
    out.splice(at + 1, 0, ins.row);
  }
  // A열 재번호 (연속 3자리) — 삽입·삭제로 시프트된 ID 정합
  out = out.map((r, i) => { const c = r.slice(); c[COL.A] = String(i + 1).padStart(3, '0'); return c; });

  return { rows: out, ledger: { applied: [...ledgerSet] }, applied, skipped, conflicts };
}

module.exports = { applyFixPlan, patchId, COL };

// ── CLI ──
if (require.main === module) {
  const [snapPath, planPath, outPath] = process.argv.slice(2);
  const li = process.argv.indexOf('--ledger');
  const ledgerPath = li >= 0 ? process.argv[li + 1] : null;
  if (!snapPath || !planPath || !outPath) {
    process.stderr.write('사용: apply_fix_plan.js <snapshot.json> <fix_plan.json> <out.json> [--ledger <ledger.json>]\n');
    process.exit(1);
  }
  let snap, plan, ledger = null;
  try { snap = JSON.parse(fs.readFileSync(snapPath, 'utf8')); }
  catch (e) { process.stderr.write('[apply_fix_plan] snapshot 파싱 실패: ' + e.message + '\n'); process.exit(1); }
  try { plan = JSON.parse(fs.readFileSync(planPath, 'utf8')); }
  catch (e) { process.stderr.write('[apply_fix_plan] fix_plan 파싱 실패: ' + e.message + '\n'); process.exit(1); }
  if (ledgerPath && fs.existsSync(ledgerPath)) {
    try { ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')); } catch { ledger = null; }
  }
  const res = applyFixPlan(snap, plan, ledger);
  const outSnap = Object.assign({}, snap, { rows: res.rows, totalRows: res.rows.length });
  const tmp = outPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(outSnap, null, 1)); fs.renameSync(tmp, outPath);
  if (ledgerPath) { const lt = ledgerPath + '.tmp'; fs.writeFileSync(lt, JSON.stringify(res.ledger, null, 1)); fs.renameSync(lt, ledgerPath); }
  process.stdout.write(JSON.stringify({
    ok: res.conflicts.length === 0, rows: res.rows.length,
    applied: res.applied.length, skipped: res.skipped.length, conflicts: res.conflicts.length,
    conflict_detail: res.conflicts,
  }) + '\n');
  process.exit(res.conflicts.length === 0 ? 0 : 6);
}
