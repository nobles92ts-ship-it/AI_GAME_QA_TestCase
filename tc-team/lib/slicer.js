#!/usr/bin/env node
/**
 * slicer.js — tc-v3: 기획서 원문(confluence_raw.md)을 결정론 분해.
 *
 * 두 산출 (한 파스, 두 소비처):
 *   sections[] — 헤딩 단위 원문 조각. S4 ③기획서대조 렌즈의 슬라이스 입력(파생본 금지, 원문 그대로).
 *   rules[]    — 헤딩 하위 명시 규칙문(리스트 항목 + 표 데이터 셀). 레버 ② 역추적 원장의 rule_id 앵커.
 *
 * 설계 근거: tc-v3 계획 §4 S4(결정론 슬라이서·헤딩 단위·전문 폴백) / §14 ②(rule_id 조각).
 * 헤딩 규칙: atx(# ~ ######) + setext(윗줄=비어있지 않은 텍스트 & 아랫줄=`===`/`---`)
 *            + 표형 대제목(`| 1. 제목 |` 단일 셀) — Confluence 대제목이 md 변환 시 1행 표가 되는 케이스.
 *   ⚠ `---` 단독 구분선(윗줄이 빈 줄)은 헤딩 아님 — confluence_raw의 섹션 구분자와 구별.
 *   ⚠ 표형 대제목은 셀 1개 + `숫자.` 시작만 인정 — History 등 다열 표의 첫 행 오인식 방지.
 *
 * 표 규칙 추출(2026-07-29 신설): Confluence 기획서는 핵심 스펙이 표 안에 들어가는 경우가 많다
 *   (월드맵 2차 개선 실측: 리스트만 훑으면 36건, 그중 표 유래 0건 — TC 274개 중 ~150개가 앵커 없음).
 *   데이터 행 판별: 표 블록 안에서 구분선(`| --- |`)과 그 윗줄(헤더)을 뺀 나머지.
 *   배제: 모든 셀이 통째로 볼드인 행(문서 중간 반복 헤더) · 첫 셀이 날짜인 행(변경 이력 표) · 이미지 파일명 토큰.
 *   셀 안 분할: Confluence 중첩 불릿이 md 변환 시 한 줄로 눌리므로 `공백2칸 이상 + 불릿` 기준으로 쪼갠다
 *   (`줌인 - 줌아웃` 같은 산문 하이픈은 공백 1칸이라 걸리지 않는다).
 *
 * 표 행 구멍 수리(2026-09-24 감사 L4-01): 칸 단위 추출은 짧은 칸(tableMinChars 미만)을 버려, 칸이 전부 짧은
 *   행(스탯 목록 `| 물리 명중 | 물리 명중 | O |`, O/X 정책 매트릭스, 구간표)이 규칙 0개가 됐다 — 현행 39런 표 데이터
 *   행 20%(295/1,473)가 원장 밖인데 traceability 는 100% 로 통과했다(스탯_리스트_정리_v3: 구현 스탯 21종 TC 0).
 *   → ① 칸 규칙이 0개인 행은 행 단위 규칙 1개(`헤더: 값 · …`, from='table-row')로 남긴다(값에 한글이 있고,
 *        minChars 이상이거나 칸이 2개 이상일 때 — 볼드 첫 칸은 행 키로 넣는다).
 *     ② 칸 규칙에는 규칙이 되지 못한 짧은 칸을 `row`(행 맥락)로 붙인다 — 같은 문구가 다른 행에서 나와도 구분된다
 *        (스킬_강화_시스템 R-20.2≡R-20.3 「O - 스킬 UI 진입」). text 는 종전 그대로라 기존 규칙·소비처는 불변.
 *     칸 규칙이 이미 있는 행에는 행 규칙을 더하지 않는다(규칙 부풀림 방지).
 *
 * CLI: slicer.js <confluence_raw.md> <out.json> [--min-chars N=6] [--rule-depth N=2]
 */
'use strict';
const fs = require('fs');

function isBlank(s) { return !s || !s.trim(); }
function stripMeta(lines) {
  // 상단 팀장 메타 블록(> ...)과 코드펜스는 규칙 추출에서 제외 대상 표시만 (헤딩엔 영향 없음)
  return lines;
}

// 셀 안 이미지 파일명 토큰 (예: Icon_WorldMap_FieldBoss.PNG, image-20260724-030246.png).
// 칸 전체가 아니라 **파일명 토큰만** 뗀다 — 구 IMG_ONLY 는 공백·한글을 허용해 「보스 등장 연출 boss_intro.png」 같은
// 한글 문장 칸을 이미지 단독으로 보고 통째로 버렸다(2026-09-24 감사 L4-01 보강: 42런 12칸).
const IMG_FILE = /\S+\.(?:png|jpe?g|gif|webp|bmp|svg)(?=\s|$)/gi;
const stripImg = (s) => s.replace(IMG_FILE, ' ').replace(/\s+/g, ' ').trim();
const isBoldOnly = (s) => /^\*\*[^*]+\*\*$/.test(s);
const isImgMd = (s) => /^!\[.*\]\(.*\)$/.test(s);
const tableCells = (line) => line.split('|').slice(1, -1).map((c) => c.trim());

/** 각 줄을 표 구조상 무엇인지 분류 → 'sep' | 'header' | 'data' | null */
function classifyTableLines(lines) {
  const kind = new Array(lines.length).fill(null);
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].startsWith('|')) { i++; continue; }
    let j = i;
    while (j < lines.length && lines[j].startsWith('|')) j++;
    for (let k = i; k < j; k++) {
      // 구분선: 셀 내용이 `---`/`:--:` 뿐인 행
      if (/^\|[\s:|-]+\|\s*$/.test(lines[k]) && lines[k].includes('-')) {
        kind[k] = 'sep';
        if (k > i && kind[k - 1] !== 'sep') kind[k - 1] = 'header';
      }
    }
    for (let k = i; k < j; k++) if (!kind[k]) kind[k] = 'data';
    i = j;
  }
  return kind;
}

/**
 * 표 데이터 행 1줄 → { segs, parts } (배제 행이면 둘 다 빈 배열).
 *   segs  = 칸 규칙 문자열(칸·눌린 불릿 단위, 종전 동작 그대로)
 *   parts = 규칙이 되지 못한 짧은 칸 [{head, v}] — 행 맥락(row)·행 단위 규칙의 재료
 * 스키마/데이터 표(enum 값·컬럼명·스트링 키 목록)는 셀이 규칙문이 아니라 '값'이라 분모를 오염시킨다
 * (실측: 필터 없이 463건 중 상당수가 Common/NameCode/&lt;테이블명&gt;\_UI\_… 류). 칸 규칙은 아래 필터로 거른다.
 */
function tableRow(line, headers, minChars) {
  const raw = tableCells(line);
  const cells = raw.filter(Boolean);
  const none = { segs: [], parts: [] };
  if (!cells.length) return none;
  if (cells.every(isBoldOnly)) return none;                // 문서 중간에 반복되는 헤더 행
  if (/^\d{4}-\d{2}-\d{2}$/.test(cells[0])) return none;   // 변경 이력(History) 표
  const aligned = Array.isArray(headers) && headers.length === raw.length;   // 병합 셀로 칸 수가 어긋나면 헤더를 붙이지 않는다
  const segs = [], parts = [];
  raw.forEach((cell, ci) => {
    if (!cell) return;
    let emitted = false;
    for (const seg of cell.replace(/^[*+\-]\s+/, '').split(/\s{2,}[*+\-]\s+/)) {
      const t = stripImg(seg);
      if (!t) continue;
      if (isImgMd(t)) continue;
      if (isBoldOnly(t)) continue;              // 볼드만 있는 셀 = 열 라벨(**String**, **보유한 훈장**)
      if (!/[가-힣]/.test(t)) continue;         // 한글 없음 = enum 값·컬럼명·스트링 키·URL
      if (t.replace(/[![\]()*]/g, '').trim().length < minChars) continue;
      segs.push(t); emitted = true;
    }
    if (emitted) return;
    // 볼드 칸도 넣는다 — 데이터 행의 볼드 첫 칸은 열 라벨이 아니라 행 키다(「**글로벌 쿨타임 중 자동 스킬 대기** | X」).
    // 칸 규칙에서 볼드만 있는 칸을 빼는 종전 규칙은 그대로다(위 isBoldOnly(t)).
    const v = stripImg(cell).replace(/\*\*/g, '').trim();
    if (!v || isImgMd(v)) return;
    parts.push({ head: aligned ? headers[ci] : '', v });
  });
  return { segs, parts };
}
const joinParts = (parts) => parts.map((p) => (p.head ? p.head + ': ' + p.v : p.v)).join(' · ');

/** @returns {{sections:Array, rules:Array}} */
function slice(text, opts = {}) {
  const minChars = opts.minChars != null ? opts.minChars : 6;
  // 표 셀은 라벨·값이 섞여 들어오므로 리스트 항목보다 하한을 높인다(짧은 셀 = 라벨일 확률이 높다).
  const tableMinChars = opts.tableMinChars != null ? opts.tableMinChars : 12;
  const ruleDepth = opts.ruleDepth != null ? opts.ruleDepth : 2;
  const lines = text.replace(/\r\n/g, '\n').split('\n');

  // 1) 헤딩 탐지
  const heads = []; // {line, level, title}
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const atx = ln.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (atx) { heads.push({ line: i, level: atx[1].length, title: atx[2].trim() }); continue; }
    // 표형 대제목: Confluence 대제목이 md 변환 시 `| 1. 제목 |` 1행 표가 된다.
    // 셀 1개 + `숫자.` 시작만 인정 — History(`| 날짜 | 이름 | ... |`) 같은 다열 표는 셀 수로 배제.
    if (ln.startsWith('|')) {
      const cells = ln.split('|').slice(1, -1);
      if (cells.length === 1 && /^\s*\*{0,2}\s*\d+\.\s*\S/.test(cells[0])) {
        heads.push({ line: i, level: 1, title: cells[0].replace(/\*\*/g, '').trim() });
        continue;
      }
    }
    // setext: 윗줄 텍스트(비어있지 않음) + 현재줄이 밑줄
    const under = ln.match(/^\s*(=+|-{2,})\s*$/);
    if (under && i > 0 && !isBlank(lines[i - 1]) && !/^\s*(#{1,6}\s|[*+\-]\s|\d+\.\s|>|\|)/.test(lines[i - 1])) {
      const level = under[1][0] === '=' ? 1 : 2;
      heads.push({ line: i - 1, level, title: lines[i - 1].trim() });
    }
  }
  heads.sort((a, b) => a.line - b.line);

  // 2) 섹션 = 헤딩 → 다음 헤딩 직전. 원문 그대로 보존.
  const sections = [];
  for (let s = 0; s < heads.length; s++) {
    const start = heads[s].line;
    const end = s + 1 < heads.length ? heads[s + 1].line : lines.length;
    const secId = 'R-' + (s + 1);
    const bodyLines = lines.slice(start, end);
    sections.push({ sec_id: secId, level: heads[s].level, heading: heads[s].title, line: start + 1, text: bodyLines.join('\n').trim() });
  }
  // 헤딩 없는 문서: 전체를 단일 섹션
  if (!sections.length) sections.push({ sec_id: 'R-1', level: 1, heading: '(제목 없음)', line: 1, text: text.trim() });

  // 3) 규칙 = 섹션 본문(자기 헤딩~다음 헤딩) 내 리스트 항목 + 표 데이터 셀. depth ≤ ruleDepth, 내용 ≥ minChars.
  const tableKind = classifyTableLines(lines);
  const rules = [];
  for (let s = 0; s < heads.length; s++) {
    const start = heads[s].line + 1; // 헤딩 줄 제외
    const end = s + 1 < heads.length ? heads[s + 1].line : lines.length;
    const secId = 'R-' + (s + 1);
    let n = 0;
    let headers = null;
    for (let i = start; i < end; i++) {
      if (tableKind[i] === 'header') { headers = tableCells(lines[i]).map((c) => c.replace(/\*\*/g, '').trim()); continue; }
      if (tableKind[i] === 'data') {
        const { segs, parts } = tableRow(lines[i], headers, tableMinChars);
        const ctx = joinParts(parts);
        if (segs.length) {
          for (const t of segs) {
            n++;
            const rl = { rule_id: secId + '.' + n, sec_id: secId, line: i + 1, depth: 1, text: t, from: 'table' };
            if (ctx) rl.row = ctx.slice(0, 160);
            rules.push(rl);
          }
        } else if (parts.length) {
          // 칸 규칙 0개 행 → 행 단위 규칙 1개. 값(헤더 제외)에 한글이 있어야 한다 — 한글 없는 스키마·enum 행은 종전대로 제외.
          // 길이는 minChars 이상 **또는 칸 2개 이상**(「| 명중 | 명중 | O |」처럼 이름이 짧은 스탯 행). 칸 1개짜리 짧은 행
          // (「| 예 |」·그림만 가리키는 「**수정 결과** 이미지」)은 종전대로 제외한다.
          const vals = parts.map((p) => p.v).join(' ');
          if (/[가-힣]/.test(vals) && (vals.replace(/[\s·*]/g, '').length >= minChars || parts.length >= 2)) {
            n++;
            rules.push({ rule_id: secId + '.' + n, sec_id: secId, line: i + 1, depth: 1, text: ctx, from: 'table-row' });
          }
        }
        continue;
      }
      if (tableKind[i]) continue; // 구분선
      headers = null;             // 표 밖으로 나왔다 — 다음 표의 헤더와 섞이지 않게
      const m = lines[i].match(/^(\s*)([*+\-]|\d+[.)])\s+(.+)$/);
      if (!m) continue;
      const indent = m[1].replace(/\t/g, '    ').length;
      const depth = Math.floor(indent / 2) + 1; // 2-space 들여쓰기 = 1단계
      if (depth > ruleDepth) continue;
      const body = m[3].trim();
      if (body.replace(/[![\]()]/g, '').length < minChars) continue; // 짧은 구조 항목(PC/모바일/이미지)만 배제
      if (/^!\[.*\]\(.*\)$/.test(body)) continue; // 순수 이미지
      n++;
      rules.push({ rule_id: secId + '.' + n, sec_id: secId, line: i + 1, depth, text: body, from: 'list' });
    }
  }

  return { sections, rules };
}

module.exports = { slice };

// ── CLI ──
if (require.main === module) {
  const [inPath, outPath] = process.argv.slice(2);
  const mc = process.argv.indexOf('--min-chars'); const rd = process.argv.indexOf('--rule-depth');
  const tmc = process.argv.indexOf('--table-min-chars');
  if (!inPath || !outPath) { process.stderr.write('사용: slicer.js <confluence_raw.md> <out.json> [--min-chars N] [--table-min-chars N] [--rule-depth N]\n'); process.exit(1); }
  if (!fs.existsSync(inPath)) { process.stderr.write('[slicer] 입력 없음: ' + inPath + '\n'); process.exit(1); }
  const opts = {};
  if (mc >= 0) opts.minChars = parseInt(process.argv[mc + 1], 10);
  if (tmc >= 0) opts.tableMinChars = parseInt(process.argv[tmc + 1], 10);
  if (rd >= 0) opts.ruleDepth = parseInt(process.argv[rd + 1], 10);
  const res = slice(fs.readFileSync(inPath, 'utf8'), opts);
  const tmp = outPath + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(res, null, 1)); fs.renameSync(tmp, outPath);
  process.stdout.write(JSON.stringify({ ok: true, sections: res.sections.length, rules: res.rules.length }) + '\n');
  process.exit(0);
}
