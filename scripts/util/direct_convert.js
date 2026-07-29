#!/usr/bin/env node
/**
 * direct_convert.js — Phase 3 직변환 CLI (2026-06-11)
 *
 * STEP 4의 LLM 전체 필사를 대체: 설계(tc_design.md)를 기계 파싱해 TC 골격을 생성하고,
 * LLM은 F열(재현스탭) 문장화만 담당한다. 파서 SSoT: validate_tc_rows.js (Phase 3 섹션).
 *
 * 명령:
 *   convert <tc_design.md> <specDir> [--allow-compound]
 *     → tc_skeleton.json (골격 B~E/G/J + leaf 본문, design_hash 포함, temp→rename 원자 쓰기)
 *     → 차단 시 conversion_blocker.json 저장 + exit 4 (fail-closed — 통과 금지)
 *     → 재진입 시 기존 중간 산출물(skeleton/f_map/blocker) 무조건 폐기 후 재생성 (L3-3 ③)
 *   merge <specDir>
 *     → tc_skeleton.json + tc_f_map.json([{idx,d,f}] — writer LLM이 F만 작성) → tc_data.json
 *     → 검증: 설계 해시 재대조(L3-3 ②) / 행수 / idx·소분류 echo(off-by-one — L4-F6) / F 비어있음
 *     → F열 내용 위반(V-05 번호 등)은 exit 5 (writer가 해당 행만 재문장화 — L2P3-05 분기)
 *     → 골격 열 위반은 exit 4 (직변환기/설계 결함 — 명시 정지, LLM 패치 금지)
 *
 * exit 계약: 0=성공 / 1=입력·인자 오류 / 4=fail-closed 차단(blocker 저장, 재시도 금지·설계 결함 분류)
 *           / 5=F열 위반(f_violations.json 저장 — 해당 행 재문장화 후 merge 재실행)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  parseDesignTree, parseBasicTable, checkAllotmentStrict, normCatName,
  validatePreWrite, formatViolations,
} = require('./validate_tc_rows.js');

function designHash(text) { return crypto.createHash('sha256').update(text).digest('hex').slice(0, 12); }
function writeAtomic(p, data) { const tmp = p + '.tmp'; fs.writeFileSync(tmp, data); fs.renameSync(tmp, p); } // L3-3 ① 원자 마커
function saveBlocker(specDir, stage, blockers) {
  const out = { stage, blocked_at: new Date().toISOString(), count: blockers.length, blockers };
  writeAtomic(path.join(specDir, 'conversion_blocker.json'), JSON.stringify(out, null, 2));
  console.error(`[DIRECT-CONVERT][BLOCKED:${stage}] ${blockers.length}건 — conversion_blocker.json 저장. fail-closed: 통과 금지, 설계(STEP 3) 재진입 필요 (L3-1)`);
  for (const b of blockers.slice(0, 20)) console.error(`  - [${b.type}] L${b.line || '-'} ${b.msg}`);
  if (blockers.length > 20) console.error(`  … 외 ${blockers.length - 20}건 (conversion_blocker.json 참조)`);
  process.exit(4);
}

const cmd = process.argv[2];

if (cmd === 'convert') {
  const designPath = process.argv[3];
  const specDir = process.argv[4];
  const allowCompound = process.argv.includes('--allow-compound');
  if (!designPath || !specDir) { console.error('사용: direct_convert.js convert <tc_design.md> <specDir> [--allow-compound]'); process.exit(1); }
  if (!fs.existsSync(designPath)) { console.error(`[convert] 설계 파일 없음: ${designPath}`); process.exit(1); }
  if (!fs.existsSync(specDir)) { console.error(`[convert] specDir 없음: ${specDir}`); process.exit(1); }

  // 재진입 폐기 (L3-3 ③): stale 중간 산출물 재사용 금지
  for (const f of ['tc_skeleton.json', 'tc_f_map.json', 'conversion_blocker.json', 'f_violations.json']) {
    try { fs.unlinkSync(path.join(specDir, f)); } catch {}
  }

  const text = fs.readFileSync(designPath, 'utf8');
  const tree = parseDesignTree(text, { allowCompound });
  const basic = parseBasicTable(text);
  const blockers = [...tree.blockers];
  if (!basic.ok) blockers.push({ type: 'basic_table', msg: '기본기능 표 파싱 실패: ' + basic.error });
  if (blockers.length) saveBlocker(specDir, 'parse', blockers);

  const alloc = checkAllotmentStrict(text, tree.leaves);
  const allocBlocking = alloc.issues.filter(i => i.blocking);
  if (allocBlocking.length) saveBlocker(specDir, 'allotment', allocBlocking);

  // P-20: BVA/시간 경계 상·하한 통합 표기 차단 (2026-06-12 — Boss_0011 v3 검수 HIGH의 게이트 shift-left 환류)
  const P20_RE = /초과하거나\s*미만|미만이거나\s*초과|이상이거나\s*이하|이하이거나\s*이상|해제되거나[^,.]{0,20}잔류|잔류하거나[^,.]{0,20}해제/;
  const p20 = [];
  for (const it of [...basic.rows.map(b => ({ text: b.text, line: b.line, d: b.cat3 })), ...tree.leaves.map(l => ({ text: l.text, line: l.line, d: l.cat3 }))]) {
    const m = String(it.text || '').match(P20_RE);
    if (m) p20.push({ type: 'p20_merged_boundary', line: it.line, msg: `(${it.d}) 상·하한 통합 표기 "${m[0]}" — 단위·방향별 2케이스로 분리 필요 (P-20)` });
  }
  if (p20.length) saveBlocker(specDir, 'p20', p20);

  const rows = [];
  for (const b of basic.rows) rows.push({ idx: rows.length, b: b.cat1, c: b.cat2, d: b.cat3, e: b.stage, leaf: b.text, g: b.platform, j: '' });
  for (const lf of tree.leaves) rows.push({ idx: rows.length, b: lf.cat1, c: lf.cat2, d: lf.cat3, e: lf.stage, leaf: lf.text, g: lf.platform, j: lf.j });

  const skeleton = {
    design_hash: designHash(text),
    design_path: path.resolve(designPath).replace(/\\/g, '/'),
    generated_at: new Date().toISOString(),
    basic_count: basic.rows.length,
    qa_count: tree.leaves.length,
    total: rows.length,
    alloc_row_total: alloc.rowTotal,
    notes: alloc.issues.filter(i => !i.blocking).map(i => i.msg),
    rows,
  };
  writeAtomic(path.join(specDir, 'tc_skeleton.json'), JSON.stringify(skeleton, null, 2));
  console.log(JSON.stringify({ ok: true, basic: skeleton.basic_count, qa: skeleton.qa_count, total: skeleton.total, design_hash: skeleton.design_hash }));
  process.exit(0);
}

if (cmd === 'merge') {
  const specDir = process.argv[3];
  if (!specDir) { console.error('사용: direct_convert.js merge <specDir>'); process.exit(1); }
  const skelP = path.join(specDir, 'tc_skeleton.json');
  const fmapP = path.join(specDir, 'tc_f_map.json');
  if (!fs.existsSync(skelP)) { console.error('[merge] tc_skeleton.json 없음 — convert 먼저 실행'); process.exit(1); }
  if (!fs.existsSync(fmapP)) { console.error('[merge] tc_f_map.json 없음 — F열 문장화 결과 필요'); process.exit(1); }
  let skel, fmapRaw;
  try { skel = JSON.parse(fs.readFileSync(skelP, 'utf8')); } catch (e) { console.error('[merge] skeleton 파싱 실패: ' + e.message); process.exit(1); }
  try { fmapRaw = JSON.parse(fs.readFileSync(fmapP, 'utf8')); } catch (e) { console.error('[merge] f_map 파싱 실패: ' + e.message); process.exit(1); }
  const fmap = Array.isArray(fmapRaw) ? fmapRaw : fmapRaw.rows;

  const blockers = [];
  // 설계 해시 재대조 (L3-3 ②) — 설계가 그 사이 수정됐으면 골격은 stale
  try {
    const cur = designHash(fs.readFileSync(skel.design_path, 'utf8'));
    if (cur !== skel.design_hash) blockers.push({ type: 'design_hash_mismatch', msg: `설계 변경 감지 (${skel.design_hash} → ${cur}) — convert부터 재실행 필요 (stale 골격 차단)` });
  } catch (e) { blockers.push({ type: 'design_read_fail', msg: '설계 재읽기 실패: ' + e.message }); }
  if (!Array.isArray(fmap)) blockers.push({ type: 'fmap_shape', msg: 'tc_f_map.json은 [{idx,d,f}] 배열이어야 함' });
  else if (fmap.length !== skel.rows.length) blockers.push({ type: 'count_mismatch', msg: `F맵 ${fmap.length}행 ≠ 골격 ${skel.rows.length}행` });
  if (!blockers.length) {
    for (let i = 0; i < skel.rows.length; i++) {
      const sk = skel.rows[i], fm = fmap[i];
      if (!fm || fm.idx !== sk.idx) { blockers.push({ type: 'idx_shift', msg: `행 ${i} idx 불일치 — off-by-one 시프트 의심 (L4-F6)` }); break; }
      if (normCatName(fm.d || '') !== normCatName(sk.d)) { blockers.push({ type: 'echo_mismatch', msg: `행 ${i} 소분류 echo '${fm.d}' ≠ 골격 '${sk.d}' — 시프트 의심 (L4-F6)` }); break; }
      if (!fm.f || !String(fm.f).trim()) { blockers.push({ type: 'empty_f', msg: `행 ${i} (${sk.d} ${sk.e}-${i}) F 빈값` }); break; }
    }
  }
  if (blockers.length) saveBlocker(specDir, 'merge', blockers);

  const data = skel.rows.map((sk, i) => [sk.b, sk.c, sk.d, sk.e, String(fmap[i].f).trim(), sk.g, sk.j]);

  // 업로드 전 기계 검증 — 열 그룹별 분기 (L2P3-05)
  const pre = validatePreWrite(data, { startRow: 2 });
  if (!pre.ok) {
    const fViol = pre.violations.filter(v => v.col === 'F' && (v.sev === 'CRITICAL' || v.sev === 'HIGH'));
    const skViol = pre.violations.filter(v => v.col !== 'F' && (v.sev === 'CRITICAL' || v.sev === 'HIGH'));
    if (skViol.length) {
      // 골격 열 위반 = 직변환기/설계 결함 — LLM 패치 금지, 명시 정지
      saveBlocker(specDir, 'skeleton_violation', skViol.map(v => ({ type: 'preWrite_' + v.col, line: v.row, msg: `[${v.sev}] ${v.msg}` })));
    }
    if (fViol.length) {
      writeAtomic(path.join(specDir, 'f_violations.json'), JSON.stringify({ count: fViol.length, violations: fViol }, null, 2));
      console.error(`[DIRECT-CONVERT][F-VIOLATION] F열 위반 ${fViol.length}건 — f_violations.json 저장. 해당 행만 재문장화 후 merge 재실행 (exit 5)`);
      console.error(formatViolations(fViol));
      process.exit(5);
    }
  }

  writeAtomic(path.join(specDir, 'tc_data.json'), JSON.stringify(data, null, 1));
  try { fs.unlinkSync(path.join(specDir, 'f_violations.json')); } catch {}
  console.log(JSON.stringify({ ok: true, rows: data.length, out: path.join(specDir, 'tc_data.json').replace(/\\/g, '/'), design_hash: skel.design_hash }));
  process.exit(0);
}

console.error('사용: direct_convert.js <convert|merge> … (상세는 파일 헤더 주석)');
process.exit(1);
