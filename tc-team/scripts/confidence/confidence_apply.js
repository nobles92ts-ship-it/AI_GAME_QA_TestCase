#!/usr/bin/env node
/**
 * confidence_apply.js — TC별 확신도를 라이브 시트에 스탬핑 (S7 FINAL-0)
 *
 * 하는 일 (판단 0 — S1~S2가 남긴 신호를 확정된 행에 옮겨 적기만):
 *   1. A열(TC ID) 색: D=빨강 #F4C7C3 · C=노랑 #FCE8B2 · A/B/N=무색
 *   2. A열 메모(전 행): 점수·등급 → 이 TC를 쓴 이유(근거 §·검증 포인트) → QA 참고 → 깎인 이유
 *      (③④는 감점 있는 행만. 색은 여전히 C/D 만 — 메모 유무와 주의 신호를 분리했다)
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
const { computeItems, stampGate, mapRowsToItems, bareSec } = require('./confidence_core');

// ── 인자 ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : ''; };
const SPEC = opt('--spec');
const CLI = require.main === module;   // require 되면(드라이런·테스트) 시트 접근 없이 문안 함수만 내준다
if (CLI && (!SPEC || !fs.existsSync(SPEC))) { console.error('사용법: --spec <specs/기능명 폴더>'); process.exit(1); }

const info = {};
try {
  fs.readFileSync(path.join(SPEC, 'sheet_info.txt'), 'utf8').split('\n')
    .forEach((l) => { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) info[m[1]] = m[2].trim().replace(/\r$/, ''); });
} catch (e) { /* sheet_info 없으면 인자 필수 */ }
const SPREADSHEET_ID = opt('--sheet-id') || info.SHEET_ID;
const TAB = opt('--tab') || info.TAB_NAME;
if (CLI && (!SPREADSHEET_ID || !TAB)) { console.error('SHEET_ID/TAB_NAME 을 찾을 수 없음 (sheet_info.txt 또는 인자)'); process.exit(1); }

const BG = {
  D: { red: 0.957, green: 0.780, blue: 0.765 }, // #F4C7C3
  C: { red: 0.988, green: 0.910, blue: 0.698 }, // #FCE8B2
};
const WHITE = { red: 1, green: 1, blue: 1 };
const OUR_NOTE = /^TC \d+점/;                    // 우리 메모 시그니처 — 이 외엔 절대 안 건드림

// ── 메모 문안 ────────────────────────────────────────────────────────
// 구조(2026-09-10 개편): ①점수·등급 → ②이 TC를 쓴 이유 → ③QA 참고 → ④깎인 이유
//   · ②는 **전 행 공통**. "이 TC 왜 있지?"는 감점 없는 A/B 에서 더 자주 나오는데
//     예전엔 색칠한 C/D(전체의 23%)에만 메모가 붙어 그 질문에 답할 수 없었다.
//   · ③④는 감점이 있을 때만. 색칠은 종전대로 C/D 에만 한다(주의 신호를 흐리지 않기 위해).
const nameOf = (terms, n = 2) => {
  const h = terms.slice(0, n).map((t) => `「${t}」`).join('·');
  return terms.length > n ? `${h} 외 ${terms.length - n}건` : h;
};
// ⛔ 「기획서에 있으면 이 감점은 무시하세요」 류 문구 금지 (2026-09-11) — 도구가 할 확인을 사람에게
//   떠넘기는 문장이다. 원문은 이미 손에 있으므로 confidence_core.groundOf 가 대조하고, 여기서는 그
//   결과만 적는다. R2·R3 가 감점으로 남은 행 = 이 TC 의 근거 문장을 기획서에서 **찾지 못한** 행이다.
//   (실측 TC 142: 원문 §2-1 에 문장 그대로 있는 TC 가 이 문구와 함께 −65 를 받았다)
// R3/R4 는 **DXR 위키(제2의 뇌) 대조** 결과이고, 대조 입력은 설계의 「기획 확인 필요 항목」이다.
const reasonLine = (r) => {
  switch (r.id) {
    case 'R1': return '기획서에 답이 안 적혀 있습니다';
    // R2 는 기획서에 이미지가 몇 장인지를 재지 않는다 — **설계기가 그 소분류에 '이미지 참조 필요'
    // 마커를 달았는지**를 잰다(2026-09-11 실측: r(마커,발화)=0.845 vs r(본문 이미지,발화)=0.197).
    case 'R2': return '설계 단계에서 이 화면을 「이미지 판독 의존」으로 표시했고, 이 TC의 근거 문장도 기획서 글에서 찾지 못했습니다';
    case 'R3': { const t = nameOf(r.terms || []); return `${t}${josa(t, '과', '와')} 연결되어 있습니다 — 기획 확인이 필요한 미정 항목이고 DXR 위키에도 정의가 없으며, 이 TC의 근거 문장도 기획서에서 찾지 못했습니다`; }
    case 'R4': { const t = nameOf(r.terms || []); return `${t}${josa(t, '은', '는')} 어디 있는지까지만 확인됐고, 실제 값은 아직 못 읽었습니다`; }
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
// 섹션 번호 정렬 — bareSec 로 § 를 벗기고 숫자로 읽는다. 예전엔 `Number('§2')`=NaN 이라
// 전 구간이 동점 처리되어 정렬이 아무 일도 하지 않았다.
const sortAnchors = (a) => a.slice().sort((x, y) => {
  const px = bareSec(x).split('-').map(Number), py = bareSec(y).split('-').map(Number);
  for (let i = 0; i < Math.max(px.length, py.length); i++) {
    const dx = px[i], dy = py[i];
    if (Number.isNaN(dx) || Number.isNaN(dy)) { const c = String(x).localeCompare(String(y)); if (c) return c; break; }
    const d = (dx || 0) - (dy || 0); if (d) return d;
  }
  return 0;
});
// rules/tc-설계.md §381~383 정본 — 임의 요약 금지
const STAGE_KO = { '정상': '기대 동작 성공 경로', '부정': '잘못된 입력·조건 차단 경로', '예외': '경계값·엣지·비정상 상황' };
const GRADE_KO = { A: 'A등급', B: 'B등급', C: 'C등급', D: 'D등급', N: '미구현' };
const clip = (s, n) => { const t = String(s || '').trim(); return t.length > n ? t.slice(0, n - 1) + '\u2026' : t; };
// 설계기가 빈 칸을 '—' · '-' · '없음' 으로 채워 내는 런이 있다. 그대로 찍으면
// `확인   —` 같은 빈 줄이 메모에 남는다 — 읽는 사람에게 아무것도 주지 않는 줄은 쓰지 않는다.
const FILLER = /^(—|–|-|·|\.|N\/A|없음|미정|TBD)$/i;
const real = (v) => { const t = String(v || '').trim(); return t && !FILLER.test(t) ? t : ''; };
// 받침 유무로 조사를 고른다 — 「시간」와 / 「실체」와 처럼 한쪽으로 굳혀 두면 절반이 틀린다.
const josa = (w, withBatchim, without) => {
  const t = String(w).replace(/[^가-힣A-Za-z0-9]+$/, '');
  const c = t.charCodeAt(t.length - 1);
  if (!(c >= 0xac00 && c <= 0xd7a3)) return without;   // 한글이 아니면(영문 식별자 등) 기본형
  return ((c - 0xac00) % 28) ? withBatchim : without;
};

function noteOf(it) {
  const neg = it.reasons.filter((r) => r.d < 0);
  const waived = it.reasons.filter((r) => r.waived);
  const L = [`TC ${it.score}점  (${GRADE_KO[it.grade] || it.grade})`];

  // ── ② 이 TC를 쓴 이유 (전 행) ──
  // 원문 직접 근거가 잡힌 TC 는 **기획서 원문 문장**을 인용한다(confidence_core.groundOf).
  //   커버리지 매핑 요약 행보다 정확하다 — TC 142 는 요약 행이 엉뚱한 §1-1 「시간 충전 버튼 위치」를 가리켰다.
  // 못 잡힌 TC 는 커버리지 매핑의 근거 행으로 폴백한다. 메인 위치 하나 + 나머지는 '추가'.
  const anc = sortAnchors([...new Set((it.anchors || []).map(bareSec))].filter((a) => a && !/^이전 기록/.test(a)));
  const g = it.ground;
  const main = g && g.sec ? bareSec(g.sec) : it.why && it.why.src ? bareSec(it.why.src) : (anc[0] || '');
  L.push('', '이 TC를 쓴 이유');
  if (g) {
    L.push(`  근거   §${main || '?'}${g.label ? ` 「${clip(g.label, 30)}」` : ''} — 기획서 원문 일치 ${g.cov}%`);
    if (real(g.quote)) L.push(`  원문   "${clip(g.quote, 110)}"`);
  } else {
    const whyItem = real(it.why && it.why.item);
    L.push(main ? `  근거   §${main}${whyItem ? '  ' + clip(whyItem, 60) : ''}`
                : '  근거   (기획서에서 위치를 특정하지 못함)');
    const whyPoint = real(it.why && it.why.point);
    if (whyPoint) L.push(`  확인   ${clip(whyPoint, 60)}`);
  }
  // 근거와 같은 섹션의 하위 표기(`§2-1 (1)`·`§2-1 (2)·(5)`)는 되풀이라 뺀다 — 「추가」는 다른 섹션만.
  // 근거가 `2-1, 3-2` 처럼 복합이면 그 구성 섹션도 되풀이다(실물 HUD TC 021: 근거 §2-1, 3-2 · 추가 §2-1 · §3-2).
  // 「추가」는 형근님 지정 형식대로 **섹션 번호만**, 복합 표기(`2-1, 3-2`)는 쪼개고 중복·근거 섹션은 뺀다.
  const base = (a) => String(a).trim().split(/[\s(]/)[0];
  const mainParts = new Set(String(main).split(/\s*,\s*/).map(base));
  const extra = sortAnchors([...new Set(anc.flatMap((a) => String(a).split(/\s*,\s*/)).map(base))]
    .filter((a) => a && !mainParts.has(a))).slice(0, 4);
  if (extra.length) L.push(`  추가   §${extra.join(' · §')}`);
  if (real(it.tech)) L.push(`  기법   ${clip(it.tech, 50)}`);
  // 검증단계는 시트에서 숨김 열이라 사람이 "정상-1"만 보고는 왜 셋으로 갈렸는지 알 수 없다.
  // 정의는 지어내지 않고 rules/tc-설계.md §381~383 을 그대로 인용한다.
  L.push(`  단계   ${it.stage}-${it.no} (${STAGE_KO[it.stage] || '검증 케이스'}) · 리스크 ${it.risk}${it.unimplemented ? ' · 미구현(추후 확인)' : ''}`);

  // ── ③ QA 참고 · ④ 깎인 이유 ──
  // R2 는 2026-09-11 배지로 강등돼 점수에서 빠졌지만, "그림을 봐야 판정되는 화면"이라는 사실은 QA 에게 여전히
  // 쓸모 있다 — 감점 대신 행동 지침으로 남긴다. 원문 근거가 잡힌 TC 는 글이 있으니 이 지침을 달지 않는다.
  const acts = [...new Set(neg.map(actionLine).filter(Boolean))];
  if (it.reasons.some((r) => r.id === 'R2' && r.d === 0 && !r.waived)) {
    acts.push('기획서 그림을 띄워놓고 게임 화면과 하나씩 비교하세요 — 설계 단계에서 「이미지 판독 의존」으로 표시된 화면입니다 (점수 반영 없음)');
  }
  if (acts.length) { L.push('', 'QA 참고'); acts.forEach((a) => L.push(`  · ${a}`)); }
  if (neg.length) {
    L.push('', '점수가 깎인 이유');
    neg.forEach((r) => L.push(`  ${r.d}점  ${reasonLine(r)}`));
  }

  // ── ⑤ 원문 근거 때문에 감점하지 않은 것 — 지우지 않고 사실만 남긴다 ──
  // 같은 화면에 걸린 미정 항목이 정말 이 TC 와 관련 있을 수도 있으므로 숨기지 않는다. 지시문은 쓰지 않는다.
  if (waived.length) {
    L.push('', '감점하지 않은 것 (이 TC는 기획서 원문에 적혀 있음)');
    waived.forEach((r) => {
      if (r.id === 'R2') L.push('  · 설계 단계에서 이 화면을 「이미지 판독 의존」으로 표시했지만, 이 TC는 글로 된 원문이 있습니다');
      else if (r.id === 'R3') L.push(`  · 같은 화면에 걸린 미정 항목(DXR 위키에도 정의 없음): ${nameOf(r.terms || [])}`);
    });
  }
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

const main = async () => {
  const t0 = Date.now();
  const { items, scored, gapUnmapped, diag } = computeItems(SPEC);
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

  // 메모는 전 행, 색은 C/D 만 — 「이 TC 왜 있지?」는 감점 없는 A/B 에서 더 자주 나온다.
  const desired = new Map(perRow.map((p) => [p.row, noteOf(p.it)]));
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
    gap_unmapped: gapUnmapped || [],
    sentence_orphans: (diag && diag.sentenceOrphans) || [],
    items: perRow.map((p) => ({
      row: p.row + 1, tcid: p.tcid, leaf: p.it.leaf, stage: p.it.stage, no: p.it.no,
      score: p.it.score, grade: p.it.grade,
      reasons: p.it.reasons.map((r) => ({ id: r.id, d: r.d, detail: r.detail || '', ...(r.waived ? { waived: true } : {}) })),
      anchors: p.it.anchors || [],
      why: p.it.why || null, tech: p.it.tech || '',
      ground: p.it.ground || null, ground_cov: p.it.groundCov,
    })),
  };
  fs.writeFileSync(path.join(SPEC, 'confidence.json'), JSON.stringify(out, null, 1), 'utf8');

  // ── 요약 (finalize가 완료 보고에 회수) ──
  const top = perRow.filter((p) => p.it.grade === 'D').sort((a, b) => a.it.score - b.it.score).slice(0, 3);
  console.log(`[확신도] A ${dist.A || 0} · B ${dist.B || 0} · C ${dist.C || 0} · D ${dist.D || 0} · N ${dist.N || 0} (총 ${perRow.length}) — 색칠 ${colored.length}행 · 메모 ${desired.size}행`);
  // 원문 근거 — 0 인데 기획서 원문이 있으면 대조가 조용히 죽은 것이다(칸 0 = confluence_raw.md 없음 · 정상 쉼)
  const nGround = perRow.filter((p) => p.it.ground).length;
  console.log(`[확신도] 원문 직접 근거 ${nGround}행 — 이 행들은 R2·R3 를 감점 대신 참고로 적었다`);
  if (top.length) console.log(`[확신도] 최우선 검토: ${top.map((p) => `${p.tcid} ${p.it.leaf} ${p.it.stage}-${p.it.no} (${p.it.score}점)`).join(' · ')}`);
  if (drift.length) console.log(`[확신도] 설계 외 행 ${drift.length}건(점수 없음·드리프트): ${drift.map((d) => d.tcid).join(', ')}`);
  if (protectedRows.length) console.log(`[확신도] ⚠ 사람 메모 보호로 미기재 ${protectedRows.length}행: ${protectedRows.join(', ')}`);
  // 미부착 gap — 이름·근접도 어느 쪽으로도 소분류를 못 정한 커버리지 gap. 그 소분류엔 R5 가 안 걸린다.
  // 예전 위치 조인 시절엔 아무 소분류에나 붙어 이 상태 자체가 보이지 않았다(2026-09-08).
  // 문장형 미정 항목 중 자기 TC 를 못 찾은 것 — 어느 TC 에도 감점되지 않았다. 조용히 사라지지 않게 여기서 드러낸다.
  const orphans = (diag && diag.sentenceOrphans) || [];
  if (orphans.length) {
    console.log(`[확신도] ⚠ 자기 TC 를 못 찾은 문장형 미정 항목 ${orphans.length}건 — 어느 TC 에도 감점하지 않았다: `
      + orphans.slice(0, 3).map((t) => `「${String(t).slice(0, 40)}」`).join(' · ') + (orphans.length > 3 ? ' 외' : ''));
  }
  if ((gapUnmapped || []).length) {
    console.log(`[확신도] ⚠ 소분류 미부착 gap ${gapUnmapped.length}종(R5 미반영): ${gapUnmapped.join(', ')}`
      + ' — candidates.json 의 소분류명이 설계 리프명과 겹치지 않는 경우다. 해당 화면은 커버리지 구멍이 점수에 안 잡힌다.');
  }
  console.log(`[확신도] 산출물: ${path.join(SPEC, 'confidence.json')} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
};

if (CLI) main().catch((e) => { console.error('[확신도] 실패:', e.message); process.exit(1); });
module.exports = { noteOf };
