#!/usr/bin/env node
/**
 * sync_jtags.js — 시트 J열(비고) → tc_design.md `[J:]` 태그 동기화 (FINAL-0 직전)
 *
 * 왜 있나 (2026-09-04 정예_던전_v2 실측):
 *   확신도 R1(임의 판단 −45)은 **설계서의 `[J:]` 태그로만** 발화한다. 그런데 시트 J열은
 *   S1 이후에도 writer·fixer·사람이 붙인다 — 파이프라인 산출 261행 중 시트 J열 39건 vs
 *   설계서 태그로 R1이 발화한 항목 27건. **12행이 시트엔 「기획 확인 필요」인데 감점은 안 걸렸다.**
 *   확신도가 관대해진 게 아니라 신호를 못 읽은 것이다.
 *
 * 방향은 **시트 → 설계서 한 방향, 추가·승격만** 한다:
 *   - 시트에 J가 있고 설계서에 없거나 다르면 → 설계서 태그를 시트 값으로 맞춘다
 *   - 시트가 빈값인데 설계서에 태그가 있으면 → **지우지 않고 보고만** 한다
 *     (writer가 J열을 안 옮긴 버그일 수 있다. 지우면 감점이 느슨해지고 원인도 사라진다)
 *
 * 채점 입력의 SSoT는 계속 설계서다(confidence_core는 순수하게 설계서만 본다 — 테스트로 잠김).
 * 설계서에 태그가 남아야 "왜 깎였나"가 추적된다. 선례: 07-31 세공시스템개선 53건 신규 태깅.
 *
 * 사용: node sync_jtags.js --spec <specs/기능명> [--sheet-id ID] [--tab 탭명] [--dry]
 */
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { getAuthClient } = require(path.resolve(__dirname, '../../../scripts/util/google_auth'));
const { computeItems, mapRowsToItems } = require('./confidence_core');
const { classifyDesignLine, DESIGN_TREE_RE } =
  require(path.resolve(__dirname, '../../../scripts/util/design_tree_lines'));

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : ''; };
const DRY = args.includes('--dry');
const SPEC = opt('--spec');
if (!SPEC) { console.error('[J동기화] --spec 필요'); process.exit(1); }

const info = (() => {
  const p = path.join(SPEC, 'sheet_info.txt');
  if (!fs.existsSync(p)) return {};
  return Object.fromEntries(fs.readFileSync(p, 'utf-8').split(/\r?\n/)
    .map((l) => l.split('=')).filter((a) => a.length >= 2)
    .map((a) => [a[0].trim(), a.slice(1).join('=').trim()]));
})();
const SPREADSHEET_ID = opt('--sheet-id') || info.SHEET_ID;
const TAB = opt('--tab') || info.TAB_NAME;

const TAGGABLE = new Set(['추후 구현', '구현 우선순위 낮음', '기획 확인 필요']);

(async () => {
  const { items } = computeItems(SPEC);
  if (!items.length) { console.log('[J동기화] 설계 항목 0건 — 건너뜀'); return; }

  const auth = await getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID, range: `${TAB}!A1:K`,
  });
  const rows = res.data.values || [];
  const { perRow } = mapRowsToItems(rows, items);

  // (mid, leaf, stage, no) → 시트 비고열
  // ⚠ 2026-09-04 BTS 열(J) 신설로 비고가 J→K = 인덱스 9→10.
  const COL_NOTE = 10;
  const want = new Map();
  perRow.forEach((p) => {
    const j = ((rows[p.row] || [])[COL_NOTE] || '').trim();
    want.set(`${p.it.mid}\0${p.it.leaf}\0${p.it.stage}\0${p.it.no}`, TAGGABLE.has(j) ? j : '');
  });

  // 설계서 트리를 줄 단위로 훑으며 항목 줄의 태그를 맞춘다
  const file = path.join(SPEC, 'tc_design.md');
  const src = fs.readFileSync(file, 'utf-8');
  const lines = src.split(/\r?\n/);
  const start = lines.findIndex((l) => DESIGN_TREE_RE.section.test(l.trim()));
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^##\s/.test(lines[i])) { end = i; break; }

  let mid = '', leaf = '', added = 0, changed = 0;
  const sheetOnly = [], designOnly = [];
  for (let i = start + 1; i < end; i++) {
    const c = classifyDesignLine(lines[i]);
    if (c.kind === 'mid') { mid = c.name; continue; }
    if (c.kind === 'leaf') { leaf = c.body.replace(/\s*\[.*$/, '').trim(); continue; }
    if (c.kind !== 'item') continue;

    const key = `${mid}\0${leaf}\0${c.stage}\0${c.seq}`;
    if (!want.has(key)) continue;                       // 시트에 대응 행이 없는 설계 항목
    const now = (c.body.match(/\[J:([^\]]+)\]/) || [])[1] || '';
    const next = want.get(key);
    if (now === next) continue;

    if (!next) { designOnly.push(`${leaf} ${c.stage}-${c.seq} (설계=${now})`); continue; }  // 지우지 않는다
    const bare = c.body.replace(/\s*\[J:[^\]]+\]/g, '').trim();
    lines[i] = `→ ${c.stage}-${c.seq}: ${bare} [J:${next}]`;
    (now ? changed++ : added++);
    sheetOnly.push(`${leaf} ${c.stage}-${c.seq} → ${next}`);
  }

  console.log(`[J동기화] 시트→설계서 신규 ${added}건 · 값 변경 ${changed}건 · 설계서에만 남은 태그 ${designOnly.length}건${DRY ? ' (dry-run)' : ''}`);
  sheetOnly.slice(0, 12).forEach((s) => console.log(`   + ${s}`));
  if (sheetOnly.length > 12) console.log(`   … 외 ${sheetOnly.length - 12}건`);
  designOnly.slice(0, 8).forEach((s) => console.log(`   ⚠ 시트 J열 비어 있음(유지·미삭제): ${s}`));

  if (!DRY && (added || changed)) {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    fs.writeFileSync(`${file}.bak_jsync_${stamp}`, src, 'utf-8');
    fs.writeFileSync(file, lines.join('\n'), 'utf-8');
    console.log(`[J동기화] tc_design.md 갱신 (백업 tc_design.md.bak_jsync_${stamp})`);
  }
})().catch((e) => { console.error('[J동기화] 실패:', e.message); process.exit(1); });
