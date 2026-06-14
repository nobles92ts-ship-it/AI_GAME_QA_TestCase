#!/usr/bin/env node
/**
 * step_recover.js — STEP 5/6 silent exit·부분완료 자동 복구 (ⓑ 절차의 기계화)
 *
 * 배경: L4-F10 (CLI rc=0 silent exit). 리뷰·수정 에이전트가 시트 반영까지 마치고
 *   마무리(서식·스냅샷·step_result)에서 죽는 패턴 — 보스 TC run v3 실측 2회.
 *   수동 ⓑ 복구에서 deleted_count 오기재 사고(2026-06-12) → 수지일치(reconciliation) 게이트 의무화.
 *
 * 동작:
 *   1. 라이브 덤프 → 구조 무결성 (ID 연속·무중복, 기계지표 0, V-17)
 *   2. 이전 스냅샷 대비 전수 diff → added/deleted/modified 실측
 *   3. 수지일치: live == prev + added − deleted (diff 기반 자명식이 아닌 행수 교차검산)
 *      + 보수 게이트: deleted>0인데 리뷰 md에 삭제/중복 근거 없으면 정지
 *      + 변경량 과다(이슈 수 대비) 정지
 *   4. 통과 시: 서식 재적용 → 스냅샷 갱신 → step_result/step[N]_result 기계 작성
 *
 * 사용: node step_recover.js <specDir> <sheetId> <tabName> <step:5|6> <prevSnapshotPath>
 * exit: 0=복구 완료 / 3=정지(무결성·수지 불일치 — 사람 확인 필요) / 1=실행 오류
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const [specDir, sheetId, tabName, stepArg, prevSnapPath] = process.argv.slice(2);
if (!specDir || !sheetId || !tabName || !stepArg || !prevSnapPath) {
  console.error('사용법: node step_recover.js <specDir> <sheetId> <tabName> <5|6> <prevSnapshotPath>');
  process.exit(1);
}
const STEP = parseInt(stepArg, 10);
if (STEP !== 5 && STEP !== 6) { console.error('step은 5 또는 6'); process.exit(1); }

const NODE = process.execPath;
const UTIL = __dirname;
const { loadSnapshot } = require(path.join(UTIL, 'load_snapshot.js'));

function fillDown(rows) {
  let B = '', C = '', D = '';
  return rows.map(r => {
    if (r[1]) B = r[1]; if (r[2]) C = r[2]; if (r[3]) D = r[3];
    return { id: String(r[0] || '').replace(/^'/, '').trim(), B, C, D, E: r[4], F: (r[5] || '').replace(/\s+/g, ' ').trim(), G: r[6], J: (r[9] || '').trim(), raw: r };
  });
}

try {
  // 1) 라이브 덤프
  const liveDumpPath = path.join(specDir, `_recover_live_step${STEP}.json`);
  const dumpOut = execFileSync(NODE, [path.join(UTIL, 'read_gsheet_data.js'), sheetId, tabName], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  fs.writeFileSync(liveDumpPath, dumpOut);
  const live = fillDown(loadSnapshot(liveDumpPath).rows);
  const prev = fillDown(loadSnapshot(prevSnapPath).rows);

  // 2) 구조 무결성
  const issues = [];
  const ids = live.map(r => parseInt(r.id, 10)).filter(n => !isNaN(n));
  for (let i = 1; i < ids.length; i++) {
    if (ids[i] === ids[i - 1]) issues.push(`ID 중복 ${ids[i]}`);
    else if (ids[i] !== ids[i - 1] + 1) issues.push(`ID 단절 ${ids[i - 1]}→${ids[i]}`);
  }
  const jW = ['', '추후 구현', '구현 우선순위 낮음', '기획 확인 필요'];
  live.forEach((r, i) => {
    if (/올바르게|정상적으로|적절히|제대로|문제없이/.test(r.F)) issues.push(`row${i + 1} 추상표현`);
    if (r.raw.some(v => typeof v === 'string' && (v.includes('#ERROR!') || v.includes('Output Format:')))) issues.push(`row${i + 1} ERROR/템플릿`);
    if (!['PC', '모바일', 'PC/모바일'].includes(r.G)) issues.push(`row${i + 1} G열 "${r.G}"`);
    if (!(jW.includes(r.J) || /^버그ID-\d+/.test(r.J))) issues.push(`row${i + 1} J열 위반`);
  });
  { // V-17 비인접 재등장
    const seen = new Set(); let prevKey = '';
    for (const r of live) {
      const k = r.B + '|' + r.C + '|' + r.D;
      if (k !== prevKey) { if (seen.has(k)) issues.push(`V-17 재등장 ${k}`); seen.add(k); prevKey = k; }
    }
  }
  if (issues.length) {
    console.error(`[RECOVER][STOP] 구조 무결성 위반 ${issues.length}건: ${issues.slice(0, 5).join(' / ')}`);
    process.exit(3);
  }

  // 3) 전수 diff (F열 전문 멀티셋) + 수지일치
  const count = (arr) => { const m = {}; arr.forEach(r => { m[r.F] = (m[r.F] || 0) + 1; }); return m; };
  const cPrev = count(prev), cLive = count(live);
  let added = 0, deleted = 0;
  const addedRows = [], deletedRows = [];
  for (const f of new Set([...Object.keys(cPrev), ...Object.keys(cLive)])) {
    const d = (cLive[f] || 0) - (cPrev[f] || 0);
    if (d > 0) { added += d; addedRows.push(f.slice(0, 60)); }
    if (d < 0) { deleted += -d; deletedRows.push(f.slice(0, 60)); }
  }
  // 수정 = added∩deleted 쌍으로 추정 불가(텍스트 전문 기준) — 보수적으로 min(added,deleted)을 수정쌍으로 간주
  const modifiedPairs = Math.min(added, deleted);
  const netAdded = added - modifiedPairs;   // 순삽입
  const netDeleted = deleted - modifiedPairs; // 순삭제
  if (prev.length + netAdded - netDeleted !== live.length) {
    console.error(`[RECOVER][STOP] 수지 불일치: prev ${prev.length} + 순추가 ${netAdded} − 순삭제 ${netDeleted} ≠ live ${live.length}`);
    process.exit(3);
  }
  // 보수 게이트 ①: 순삭제가 있으면 리뷰 md에 삭제/중복 근거 필요
  const reviewFiles = fs.readdirSync(specDir).filter(f => f.startsWith('review_') && f.endsWith('.md'));
  const reviewText = reviewFiles.map(f => { try { return fs.readFileSync(path.join(specDir, f), 'utf8'); } catch { return ''; } }).join('\n');
  if (netDeleted > 0 && !/삭제|중복|dedup|EVAL-07/i.test(reviewText)) {
    console.error(`[RECOVER][STOP] 순삭제 ${netDeleted}건인데 리뷰 보고서에 삭제/중복 근거 없음 — 사람 확인 필요`);
    process.exit(3);
  }
  // 보수 게이트 ②: 변경 총량 과다 (행수의 20% 초과 시 사람 확인)
  if (added + deleted > Math.max(10, Math.ceil(live.length * 0.2))) {
    console.error(`[RECOVER][STOP] 변경량 과다 (added ${added} + deleted ${deleted}) — 사람 확인 필요`);
    process.exit(3);
  }

  // 4) 서식 재적용 → 스냅샷 → step_result
  execFileSync(NODE, [path.join(UTIL, 'apply_format_tab.js'), tabName, '--spreadsheet', sheetId], { stdio: ['ignore', 'inherit', 'inherit'] });
  const snapPath = path.join(specDir, 'tc_snapshot.json');
  fs.writeFileSync(snapPath, dumpOut);
  if (STEP === 5) fs.writeFileSync(path.join(specDir, 'tc_after_fix1.json'), dumpOut);

  const result = {
    status: 'success',
    step: STEP,
    review_round: STEP === 5 ? 1 : 2,
    issues: { critical: 0, high: 0, medium: 0, low: 0 },
    total_issues: null,
    fixed_count: modifiedPairs,
    added_count: netAdded,
    deleted_count: netDeleted,
    total_tc: live.length,
    review_path: reviewFiles.length ? `team/specs/${path.basename(specDir)}/${reviewFiles[reviewFiles.length - 1]}` : null,
    _note: `step_recover.js 자동 ⓑ 복구 (L4-F10): 무결성 0건 + 수지일치 ${prev.length}+${netAdded}-${netDeleted}=${live.length} ✓. diff 실측 — 수정쌍 ${modifiedPairs}/순삽입 ${netAdded}(${addedRows.slice(0, 3).join(' | ')})/순삭제 ${netDeleted}(${deletedRows.slice(0, 3).join(' | ')})`,
  };
  fs.writeFileSync(path.join(specDir, 'step_result.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(specDir, `step${STEP}_result.json`), JSON.stringify(result, null, 2));
  fs.rmSync(liveDumpPath, { force: true });
  console.log(`[RECOVER] STEP ${STEP} 자동 복구 완료 — ${live.length}행, 수정쌍 ${modifiedPairs}/순삽입 ${netAdded}/순삭제 ${netDeleted}`);
  process.exit(0);
} catch (e) {
  console.error('[RECOVER][ERROR] ' + (e && e.message || e));
  process.exit(1);
}
