#!/usr/bin/env node
/**
 * sheet_write.js — tc-v3 S6: TC 데이터 열(A~J) 유일 기록 (계획 §4 S6 / §7).
 *
 * LLM은 시트를 모른다 — 확정된 tc_final(10열 스냅샷)을 결정론 1회 기록.
 *   1) 10열 스냅샷 → 7열 tc_data [대,중,소,검증단계,재현스탭,플랫폼,비고] (create_gsheet 계약)
 *   2) 탭명 선기록(v접미사 해석) + 소유 마커
 *   3) create_gsheet 업로드 — exit 3(탭 존재) 시: 우리 탭이면 clear-and-rewrite, 아니면 v접미사 bump
 *   4) (CLI) --snapshot-dir로 create_gsheet가 post-write 검증 + 스냅샷 저장
 *
 * 현행 create_gsheet에는 clear-and-rewrite 모드가 없음(동명탭=exit 3 중단) → 이 래퍼가 삭제+재생성으로 구현.
 * 핵심 로직은 createFn/deleteFn 주입으로 오프라인 단위테스트 가능.
 *
 * CLI: sheet_write.js <snapshot.json> <sheetId> <baseTab> <specDir>
 */
'use strict';
const fs = require('fs');
const path = require('path');

const PICK7 = [1, 2, 3, 4, 5, 6, 9]; // A~J(10열) → 대,중,소,검증단계,재현스탭,플랫폼,비고

function to7col(rows) { return rows.map(r => PICK7.map(i => r[i] != null ? r[i] : '')); }

/**
 * 탭명 해석 + 업로드 + clear-and-rewrite. 순수 로직(주입 러너).
 * @param createFn (tab) => {exit}   exit 0 성공 / 3 탭존재 / 4·5 검증오류
 * @param deleteFn (tab) => void
 * @param opts {baseTab, runId, marker, maxSuffix=9}
 * @returns {ok, tab, attempts, action}
 */
function resolveAndWrite(createFn, deleteFn, opts) {
  const { baseTab, runId, marker } = opts;
  const maxSuffix = opts.maxSuffix || 9;
  const attempts = [];

  // 이전 실행(우리 소유 마커)이 있으면 그 탭 재사용 시도 (clear-and-rewrite)
  const candidates = [];
  if (marker && marker.run_id === runId && marker.tab) candidates.push({ tab: marker.tab, owned: true });
  candidates.push({ tab: baseTab, owned: false });
  for (let v = 2; v <= maxSuffix; v++) candidates.push({ tab: `${baseTab}_v${v}`, owned: false });

  for (const c of candidates) {
    let r = createFn(c.tab);
    attempts.push({ tab: c.tab, exit: r.exit });
    if (r.exit === 0) return { ok: true, tab: c.tab, attempts, action: c.owned ? 'rewrote_owned' : 'created' };
    if (r.exit === 3) {
      if (c.owned) { // 우리 탭 — 삭제 후 재기록
        deleteFn(c.tab);
        r = createFn(c.tab);
        attempts.push({ tab: c.tab, exit: r.exit, retry: true });
        if (r.exit === 0) return { ok: true, tab: c.tab, attempts, action: 'clear_and_rewrite' };
        return { ok: false, tab: c.tab, attempts, action: 'rewrite_failed', exit: r.exit };
      }
      continue; // 남의 탭 — 다음 v접미사
    }
    // exit 4/5 = 검증 오류 — 즉시 중단(시트 미변형)
    return { ok: false, tab: c.tab, attempts, action: 'validation_error', exit: r.exit };
  }
  return { ok: false, attempts, action: 'no_free_tab' };
}

module.exports = { to7col, resolveAndWrite, PICK7 };

// ── CLI ──
if (require.main === module) {
  const [snapPath, sheetId, baseTab, specDir] = process.argv.slice(2);
  if (!snapPath || !sheetId || !baseTab || !specDir) {
    process.stderr.write('사용: sheet_write.js <snapshot.json> <sheetId> <baseTab> <specDir>\n'); process.exit(1);
  }
  const { execFileSync } = require('child_process');
  const NODE = process.execPath;
  // 배포본에서도 돌도록 레이아웃 상대 해석 (tc-team/lib/ → 프로젝트 루트/scripts/util/)
  const UTIL = process.env.TCTEAM_UTIL_DIR || path.resolve(__dirname, '..', '..', 'scripts', 'util');
  const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
  const rows = Array.isArray(snap) ? snap : snap.rows;
  const data7 = to7col(rows);
  const dataPath = path.join(specDir, 'tc_data_v3.json');
  fs.writeFileSync(dataPath, JSON.stringify(data7, null, 1));

  const markerPath = path.join(specDir, 'owner_marker.json');
  let marker = null; try { marker = JSON.parse(fs.readFileSync(markerPath, 'utf8')); } catch {}
  const runId = (marker && marker.run_id) || ('run-' + require('crypto').randomBytes(4).toString('hex'));

  const createFn = (tab) => {
    try { execFileSync(NODE, [path.join(UTIL, 'create_gsheet_tc_from_json.js'), tab, sheetId, dataPath, '--snapshot-dir', specDir], { stdio: 'pipe' }); return { exit: 0 }; }
    catch (e) { return { exit: e.status || 1 }; }
  };
  const deleteFn = (tab) => { try { execFileSync(NODE, [path.join(UTIL, 'duplicate_tab.js'), sheetId, tab, '--delete'], { stdio: 'pipe' }); } catch {} };

  const res = resolveAndWrite(createFn, deleteFn, { baseTab, runId, marker });
  if (res.ok) {
    fs.writeFileSync(markerPath, JSON.stringify({ tab: res.tab, run_id: runId, rows: data7.length, action: res.action }, null, 1));
    // sheet_info.txt TAB_NAME 선기록(갱신) — 4필드 보존
    try {
      const si = path.join(specDir, 'sheet_info.txt');
      let t = fs.existsSync(si) ? fs.readFileSync(si, 'utf8') : '';
      if (/^TAB_NAME=/m.test(t)) t = t.replace(/^TAB_NAME=.*$/m, 'TAB_NAME=' + res.tab);
      else t += `\nTAB_NAME=${res.tab}\n`;
      fs.writeFileSync(si, t);
    } catch {}
  }
  process.stdout.write(JSON.stringify(res) + '\n');
  process.exit(res.ok ? 0 : 1);
}
