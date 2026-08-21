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
 *   배제: 모든 셀이 통째로 볼드인 행(문서 중간 반복 헤더) · 첫 셀이 날짜인 행(변경 이력 표) · 이미지 파일명 단독 셀.
 *   셀 안 분할: Confluence 중첩 불릿이 md 변환 시 한 줄로 눌리므로 `공백2칸 이상 + 불릿` 기준으로 쪼갠다
 *   (`줌인 - 줌아웃` 같은 산문 하이픈은 공백 1칸이라 걸리지 않는다).
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

// 셀 하나가 이미지 파일명뿐인지 (예: Icon_WorldMap_FieldBoss.PNG, image-20260724-030246.png)
const IMG_ONLY = /^[\w\s().\-ㄱ-힝]+\.(png|jpe?g|gif|webp|bmp|svg)$/i;

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
 * 표 데이터 행 1줄 → 규칙 문자열 배열 (배제 대상이면 빈 배열).
 * 스키마/데이터 표(enum 값·컬럼명·스트링 키 목록)는 셀이 규칙문이 아니라 '값'이라 분모를 오염시킨다
 * (훈장 실측: 필터 없이 463건 중 상당수가 Common/NameCode/Medal\_UI\_… 류). 아래 3개로 걸러낸다.
 */
function tableRowRules(line, minChars) {
  const cells = line.split('|').slice(1, -1).map((c) => c.trim()).filter(Boolean);
  if (!cells.length) return [];
  if (cells.every((c) => /^\*\*[^*]+\*\*$/.test(c))) return []; // 문서 중간에 반복되는 헤더 행
  if (/^\d{4}-\d{2}-\d{2}$/.test(cells[0])) return [];          // 변경 이력(History) 표
  const out = [];
  for (const cell of cells) {
    const segs = cell.replace(/^[*+\-]\s+/, '').split(/\s{2,}[*+\-]\s+/);
    for (const seg of segs) {
      const t = seg.trim();
      if (!t) continue;
      if (IMG_ONLY.test(t)) continue;
      if (/^!\[.*\]\(.*\)$/.test(t)) continue;
      if (/^\*\*[^*]+\*\*$/.test(t)) continue;   // 볼드만 있는 셀 = 열 라벨(**String**, **보유한 훈장**)
      if (!/[가-힣]/.test(t)) continue;          // 한글 없음 = enum 값·컬럼명·스트링 키·URL
      if (t.replace(/[![\]()*]/g, '').trim().length < minChars) continue;
      out.push(t);
    }
  }
  return out;
}

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
    for (let i = start; i < end; i++) {
      if (tableKind[i] === 'data') {
        for (const t of tableRowRules(lines[i], tableMinChars)) {
          n++;
          rules.push({ rule_id: secId + '.' + n, sec_id: secId, line: i + 1, depth: 1, text: t, from: 'table' });
        }
        continue;
      }
      if (tableKind[i]) continue; // 헤더·구분선
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
