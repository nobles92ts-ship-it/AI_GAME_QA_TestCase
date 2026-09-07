#!/usr/bin/env node
/**
 * crossref_stub_audit.js — 대조 '스텁 가드' 오판 검출기 (2026-09-07 신설)
 *
 * 배경: `rules/tc-대조.md` 는 스텁 판정 전에 **ⓑ 내용어 재질의**를 하라고 §1.4·§1.5 에 이미 명시하고,
 *   §1.5 는 2026-07-31 실측 결함(제목 질의 → 메타데이터 헤더 청크 1위 → 스텁 오인 → keep)까지 적어 두었다.
 *   **그런데 2026-09-06 버프디버프 런에서 같은 결함이 다시 났다** — keep 사유가 '스텁'인 3건 중 **2건이 오판**:
 *     · 여자_프리스트_스킬.md      15,268B / 본문 76줄 (v34·개정요지 보유, '믿음' 4회) → "제목+링크뿐인 스텁"
 *     · 토스트_메시지_연출_개선.md  2,949B / 본문 28줄 (요약·3단 레이어 규칙 보유)  → "제목만 있는 스텁"
 *     · 버프_디버프_아이콘_UI.md      887B / 본문  7줄                                → 진짜 스텁(가드 정당)
 *   문구는 이미 있었으므로 **문구를 더 쓰는 것으로는 안 고쳐진다.** 실제 파일을 재어 기계가 반증한다.
 *
 * 하는 일: `dxr_crossref.json` 에서 **branch=keep 이면서 note 가 스텁을 사유로 든 항목**을 뽑아,
 *   note 가 지목한 `.md` 를 Vault 에서 찾아 **본문 줄 수**(메타 줄 제외)를 잰다. 본문이 충분하면 오판 후보다.
 *   크기(B)가 아니라 **본문 줄 수**로 재는 이유 — Vault 문서는 머리말(제목·Confluence·카테고리·⚠주석)이
 *   길어서 바이트만 보면 스텁도 900B 를 넘긴다. 실측 분리도: 진짜 스텁 7줄 vs 오판 28·76줄.
 *
 * ⚠ **비차단이다.** 오판 후보를 알릴 뿐 대조 결과를 고치지 않는다 — 최종 판정은 사람·설계자가 한다.
 *   (자동으로 keep→apply 로 승격시키면 §1.4 가드를 무력화하는 반대편 사고가 난다)
 *
 * 사용: node crossref_stub_audit.js <dxr_crossref.json> [--vault <DXR_Vault>] [--out <audit.json>]
 *                                   [--min-body 15] [--quiet]
 * exit 0=오판 후보 없음 / 3=후보 있음(신호, 차단 아님) / 2=인자·입력 오류
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_VAULT = '{WORK_ROOT}/DXR_Vault';
// 머리말로 취급해 본문에서 제외하는 줄 — 제목·인용 메타·구분선·빈 줄
const META_LINE = /^\s*$|^\s*>|^\s*#|^\s*---\s*$|^\s*관련:/;
// note 가 스텁을 사유로 들었는지
const STUB_REASON = /스텁|§\s*1\.4|본문 분석 보류|제목만|제목\s*\+/;

function die(msg) { console.error(`[stub_audit] ${msg}`); process.exit(2); }
function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

function walk(dir, out) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

function bodyLines(file) {
  try {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => !META_LINE.test(l)).length;
  } catch { return -1; }
}

const src = process.argv[2];
if (!src || src.startsWith('--')) die('사용: node crossref_stub_audit.js <dxr_crossref.json> [--vault <dir>]');
if (!fs.existsSync(src)) die(`입력 없음: ${src}`);

const vault = arg('--vault', DEFAULT_VAULT);
const minBody = parseInt(arg('--min-body', '15'), 10);
const outPath = arg('--out', path.join(path.dirname(src), 'crossref_stub_audit.json'));
const quiet = process.argv.includes('--quiet');

const cx = JSON.parse(fs.readFileSync(src, 'utf8'));
const items = cx.items || [];

// Vault 파일 색인 (basename → 경로). 동명이 있으면 첫 번째만 — 판정은 사람이 하므로 충분하다.
const index = new Map();
for (const f of walk(vault, [])) {
  const b = path.basename(f, '.md');
  if (!index.has(b)) index.set(b, f);
}

const result = { generated: new Date().toISOString().slice(0, 10), source: src, vault, min_body: minBody, checked: 0, suspects: [], genuine: [] };

for (const it of items) {
  if (it.branch !== 'keep') continue;
  const note = String(it.note || '');
  if (!STUB_REASON.test(note)) continue;
  // ⚠ note 전체에서 .md 를 긁으면 안 된다 — 한 note 가 여러 문서를 언급하고 그중 하나만 스텁 주장인 경우가 있다
  // (실측 C1-15: "버프_디버프_정의.md는 …재확인. '토스트_메시지_연출_개선.md'는 …스텁" → 앞 문서까지 오판 후보로 딸려 나왔다).
  // 마침표+공백으로만 끊는다 — 파일명 안의 `.md` 뒤에는 공백이 없어 안전하다.
  const clauses = note.split(/(?<=[.。])\s+/).filter((c) => STUB_REASON.test(c));
  const names = clauses.flatMap((c) => [...c.matchAll(/([^\s'"`「」()]+)\.md/g)].map((m) => m[1]));
  for (const n of new Set(names)) {
    const f = index.get(n);
    if (!f) continue;
    result.checked++;
    const lines = bodyLines(f);
    const row = { id: it.id, term: String(it.term || '').slice(0, 70), doc: n, body_lines: lines, bytes: fs.statSync(f).size, file: f };
    if (lines >= minBody) result.suspects.push(row); else result.genuine.push(row);
  }
}

fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');

if (!quiet) {
  console.log(`[stub_audit] 스텁 사유 keep 검사 ${result.checked}건 — 오판 후보 ${result.suspects.length} / 진짜 스텁 ${result.genuine.length}`);
  for (const s of result.suspects) {
    console.log(`   ⚠ 오판 후보 ${s.id}: ${s.doc}.md 본문 ${s.body_lines}줄(${s.bytes}B) — 스텁이 아니다. ⓑ 내용어 재질의로 재대조할 것`);
  }
  for (const g of result.genuine) {
    console.log(`   · 진짜 스텁 ${g.id}: ${g.doc}.md 본문 ${g.body_lines}줄 — 가드 정당`);
  }
  console.log(`[stub_audit] → ${outPath}`);
}
process.exit(result.suspects.length ? 3 : 0);
