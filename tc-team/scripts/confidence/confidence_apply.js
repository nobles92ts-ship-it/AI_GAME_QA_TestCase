#!/usr/bin/env node
/**
 * confidence_apply.js — TC별 확신도를 라이브 시트에 스탬핑 (S7 FINAL-0)
 *
 * 하는 일 (판단 0 — S1~S2가 남긴 신호를 확정된 행에 옮겨 적기만):
 *   1. A열(TC ID) 색: D=빨강 #F4C7C3 · C=노랑 #FCE8B2 · A/B/N=무색
 *   2. A열 메모(색 있는 행만): 점수 → QA 참고 → 깎인 이유 → 기획서 위치(§)
 *   3. confidence.json 저장 (spec 폴더 — 기계 정본)
 *
 * 안전 규약 (적대 리뷰 반영 2026-07-29):
 *   - 멱등: 적용 전 A열 데이터범위 배경을 흰색으로 초기화 후 다시 칠한다
 *   - 메모 보호: "TC N점" 시그니처가 있는 메모(=우리 것)나 빈 칸만 갱신·삭제.
 *     사람이 단 메모는 건드리지 않고 경고만 남긴다
 *   - non-blocking: 실패해도 뒤 단계(FINAL-1·2·3·5)를 막지 않는다 (finalize.sh가 ✗ 기록 후 계속)
 *   - fail-loud (2026-08-16): 항목 0건 · 드리프트 과반은 경고가 아니라 rc=2. 시트는 손대지 않는다.
 *     판정은 confidence_core.stampGate (순수함수 — test/confidence.test.js가 잠근다)
 *
 * 사용: node confidence_apply.js --spec <specs/기능명 폴더> [--sheet-id ID] [--tab 탭명]
 *       (미지정 시 spec/sheet_info.txt 의 SHEET_ID·TAB_NAME 사용)
 */
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { getAuthClient } = require(path.resolve(__dirname, '../../../scripts/util/google_auth'));
const { computeItems, stampGate, mapRowsToItems } = require('./confidence_core');

// ── 인자 ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : ''; };
const SPEC = opt('--spec');
if (!SPEC || !fs.existsSync(SPEC)) { console.error('사용법: --spec <specs/기능명 폴더>'); process.exit(1); }

const info = {};
try {
  fs.readFileSync(path.join(SPEC, 'sheet_info.txt'), 'utf8').split('\n')
    .forEach((l) => { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) info[m[1]] = m[2].trim().replace(/\r$/, ''); });
} catch (e) { /* sheet_info 없으면 인자 필수 */ }
const SPREADSHEET_ID = opt('--sheet-id') || info.SHEET_ID;
const TAB = opt('--tab') || info.TAB_NAME;
if (!SPREADSHEET_ID || !TAB) { console.error('SHEET_ID/TAB_NAME 을 찾을 수 없음 (sheet_info.txt 또는 인자)'); process.exit(1); }

const BG = {
  D: { red: 0.957, green: 0.780, blue: 0.765 }, // #F4C7C3
  C: { red: 0.988, green: 0.910, blue: 0.698 }, // #FCE8B2
};
const WHITE = { red: 1, green: 1, blue: 1 };
const OUR_NOTE = /^TC \d+점/;                    // 우리 메모 시그니처 — 이 외엔 절대 안 건드림

// ── 메모 문안 (전부 현장 표현 — 형근님 지정 순서: 점수→참고→이유→경로) ──
const nameOf = (terms, n = 2) => {
  const h = terms.slice(0, n).map((t) => `「${t}」`).join('·');
  return terms.length > n ? `${h} 외 ${terms.length - n}건` : h;
};
const reasonLine = (r) => {
  switch (r.id) {
    case 'R1': return '기획서에 답이 안 적혀 있습니다';
    case 'R2': return '기획서에 글 설명이 없고 그림만 있습니다';
    case 'R3': return `${nameOf(r.terms || [])}와 연결되어 있는데, 기획서에 그 내용이 없습니다`;
    case 'R4': return `${nameOf(r.terms || [])} 데이터의 실제 값을 아직 확인하지 못했습니다`;
    case 'R5': return `'${r.stage}' 단계 테스트가 다른 곳보다 적습니다`;
    case 'R6': return '기획서에서 이 동작을 콕 집어 설명한 곳이 없습니다';
    default: return r.id;
  }
};
const actionLine = (r) => {
  switch (r.id) {
    case 'R1': return '기획팀에 먼저 물어보고 시작하세요';
    case 'R2': return '기획서 그림을 띄워놓고 게임 화면과 하나씩 비교하세요';
    case 'R3': return `${nameOf(r.terms || [])} 실제 동작을 직접 확인하세요`;
    case 'R4': return `${nameOf(r.terms || [])}에서 실제 값을 확인하고 진행하세요`;
    case 'R5': return `'${r.stage}' 단계에서 빠진 경우가 없는지 더 찾아보세요`;
    case 'R6': return '기획서에 없는 세부 동작이라 직접 눌러보며 확인하세요';
    default: return '';
  }
};
const sortAnchors = (a) => a.slice().sort((x, y) => {
  const px = x.split('-').map(Number), py = y.split('-').map(Number);
  for (let i = 0; i < Math.max(px.length, py.length); i++) {
    const d = (px[i] || 0) - (py[i] || 0); if (d) return d;
  }
  return 0;
});
function noteOf(it) {
  const neg = it.reasons.filter((r) => r.d < 0);
  const L = [`TC ${it.score}점  (100점 만점)`];
  const acts = [...new Set(neg.map(actionLine).filter(Boolean))];
  if (acts.length) { L.push('', 'QA 참고'); acts.forEach((a) => L.push(`  · ${a}`)); }
  L.push('', '점수가 깎인 이유');
  neg.forEach((r) => L.push(`  ${r.d}점  ${reasonLine(r)}`));
  const anc = sortAnchors((it.anchors || []).filter((a) => !/^이전 기록/.test(a))).slice(0, 5);
  L.push('', '기획서 위치');
  L.push(anc.length ? `  §${anc.join(' · §')}` : '  (기획서에서 위치를 특정하지 못함)');
  return L.join('\n');
}

// 게이트 실패 = 시트 미변경 종료. 색·메모 초기화(멱등 리셋)조차 하기 전에 빠져나온다 —
// 항목 0건으로 진행하면 전 행의 기존 색·메모를 지우고 아무것도 다시 칠하지 못한다.
const gateFail = (g, extra) => {
  console.error(`[확신도] ✗ 스탬핑 중단 (${g.code}) — ${g.msg}`);
  if (extra) console.error(`[확신도]   ${extra}`);
  console.error(`[확신도]   시트는 변경하지 않았습니다: 탭 "${TAB}"`);
  process.exit(2);
};

(async () => {
  const t0 = Date.now();
  const { items, scored } = computeItems(SPEC);
  const g0 = stampGate({ items: items.length });
  if (!g0.ok) gateFail(g0, `설계서: ${path.join(SPEC, 'tc_design.md')} (소분류 ${scored.length}건 / 항목 ${items.length}건)`);
  const auth = await getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sm = meta.data.sheets.find((s) => s.properties.title === TAB);
  if (!sm) { console.error(`[확신도] 탭 "${TAB}" 없음`); process.exit(1); }
  const GID = sm.properties.sheetId;

  // 값 + 기존 메모를 한 번에 회수 (메모 보호 판정용)
  const grid = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID, ranges: [`${TAB}!A1:J`], includeGridData: true,
    fields: 'sheets(data(rowData(values(formattedValue,note))))',
  });
  const rd = grid.data.sheets[0].data[0].rowData || [];
  const rows = rd.map((r) => (r.values || []).map((v) => v ? (v.formattedValue || '') : ''));
  const oldNotes = rd.map((r) => ((r.values || [])[0] || {}).note || '');

  // ── 행 매핑: 소분류 구간 → 검증단계별 순번 (판정은 confidence_core 의 순수함수) ──
  const { perRow, drift } = mapRowsToItems(rows, items);

  const g1 = stampGate({ items: items.length, matched: perRow.length, drift: drift.length });
  if (!g1.ok) gateFail(g1, `예: ${drift.slice(0, 3).map((d) => `${d.tcid}(${d.leaf})`).join(' · ')}`);

  const dist = perRow.reduce((a, p) => { a[p.it.grade] = (a[p.it.grade] || 0) + 1; return a; }, {});
  const colored = perRow.filter((p) => BG[p.it.grade]);

  // ── 요청: ① A열 배경 초기화(멱등) → ② C/D 색 → ③ 메모(보호 규약) ──
  const requests = [{
    repeatCell: {
      range: { sheetId: GID, startRowIndex: 1, endRowIndex: rows.length, startColumnIndex: 0, endColumnIndex: 1 },
      cell: { userEnteredFormat: { backgroundColor: WHITE } }, fields: 'userEnteredFormat.backgroundColor',
    },
  }];
  const sorted = colored.slice().sort((a, b) => a.row - b.row);
  let i = 0;
  while (i < sorted.length) {
    const g = sorted[i].it.grade;
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].row === sorted[j].row + 1 && sorted[j + 1].it.grade === g) j++;
    requests.push({ repeatCell: {
      range: { sheetId: GID, startRowIndex: sorted[i].row, endRowIndex: sorted[j].row + 1, startColumnIndex: 0, endColumnIndex: 1 },
      cell: { userEnteredFormat: { backgroundColor: BG[g] } }, fields: 'userEnteredFormat.backgroundColor',
    } });
    i = j + 1;
  }

  const desired = new Map(colored.map((p) => [p.row, noteOf(p.it)]));
  const protectedRows = [];
  const writes = [];                    // {row, note}
  for (let r = 1; r < rows.length; r++) {
    const want = desired.get(r) || '';
    const have = oldNotes[r] || '';
    if (have && !OUR_NOTE.test(have)) { if (want) protectedRows.push(r + 1); continue; }  // 사람 메모 — 불가침
    if (have !== want) writes.push({ row: r, note: want });
  }
  let w = 0;
  while (w < writes.length) {                                   // 연속 구간 묶어 updateCells
    let x = w;
    while (x + 1 < writes.length && writes[x + 1].row === writes[x].row + 1) x++;
    requests.push({ updateCells: {
      range: { sheetId: GID, startRowIndex: writes[w].row, endRowIndex: writes[x].row + 1, startColumnIndex: 0, endColumnIndex: 1 },
      rows: writes.slice(w, x + 1).map((y) => ({ values: [{ note: y.note }] })), fields: 'note',
    } });
    w = x + 1;
  }

  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests } });

  // ── confidence.json (기계 정본) ──
  const out = {
    feature: info.FEATURE_NAME || path.basename(SPEC), sheet_id: SPREADSHEET_ID, tab: TAB,
    generated_at: new Date().toISOString(),
    summary: { dist, colored: colored.length, total: perRow.length },
    drift,
    items: perRow.map((p) => ({
      row: p.row + 1, tcid: p.tcid, leaf: p.it.leaf, stage: p.it.stage, no: p.it.no,
      score: p.it.score, grade: p.it.grade,
      reasons: p.it.reasons.map((r) => ({ id: r.id, d: r.d, detail: r.detail || '' })),
      anchors: p.it.anchors || [],
    })),
  };
  fs.writeFileSync(path.join(SPEC, 'confidence.json'), JSON.stringify(out, null, 1), 'utf8');

  // ── 요약 (finalize가 완료 보고에 회수) ──
  const top = perRow.filter((p) => p.it.grade === 'D').sort((a, b) => a.it.score - b.it.score).slice(0, 3);
  console.log(`[확신도] A ${dist.A || 0} · B ${dist.B || 0} · C ${dist.C || 0} · D ${dist.D || 0} · N ${dist.N || 0} (총 ${perRow.length}) — 색칠 ${colored.length}행`);
  if (top.length) console.log(`[확신도] 최우선 검토: ${top.map((p) => `${p.tcid} ${p.it.leaf} ${p.it.stage}-${p.it.no} (${p.it.score}점)`).join(' · ')}`);
  if (drift.length) console.log(`[확신도] 설계 외 행 ${drift.length}건(점수 없음·드리프트): ${drift.map((d) => d.tcid).join(', ')}`);
  if (protectedRows.length) console.log(`[확신도] ⚠ 사람 메모 보호로 미기재 ${protectedRows.length}행: ${protectedRows.join(', ')}`);
  console.log(`[확신도] 산출물: ${path.join(SPEC, 'confidence.json')} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
})().catch((e) => { console.error('[확신도] 실패:', e.message); process.exit(1); });
