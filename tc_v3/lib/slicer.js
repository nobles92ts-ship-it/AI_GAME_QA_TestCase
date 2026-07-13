#!/usr/bin/env node
/**
 * slicer.js — tc-v3: 기획서 원문(confluence_raw.md)을 결정론 분해.
 *
 * 두 산출 (한 파스, 두 소비처):
 *   sections[] — 헤딩 단위 원문 조각. S4 ③기획서대조 렌즈의 슬라이스 입력(파생본 금지, 원문 그대로).
 *   rules[]    — 헤딩 하위 명시 규칙문(리스트 항목). 레버 ② 역추적 원장의 rule_id 앵커.
 *
 * 설계 근거: tc-v3 계획 §4 S4(결정론 슬라이서·헤딩 단위·전문 폴백) / §14 ②(rule_id 조각).
 * 헤딩 규칙: atx(# ~ ######) + setext(윗줄=비어있지 않은 텍스트 & 아랫줄=`===`/`---`).
 *   ⚠ `---` 단독 구분선(윗줄이 빈 줄)은 헤딩 아님 — confluence_raw의 섹션 구분자와 구별.
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

/** @returns {{sections:Array, rules:Array}} */
function slice(text, opts = {}) {
  const minChars = opts.minChars != null ? opts.minChars : 6;
  const ruleDepth = opts.ruleDepth != null ? opts.ruleDepth : 2;
  const lines = text.replace(/\r\n/g, '\n').split('\n');

  // 1) 헤딩 탐지
  const heads = []; // {line, level, title}
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const atx = ln.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (atx) { heads.push({ line: i, level: atx[1].length, title: atx[2].trim() }); continue; }
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

  // 3) 규칙 = 섹션 본문(자기 헤딩~다음 헤딩) 내 리스트 항목. depth ≤ ruleDepth, 내용 ≥ minChars.
  const rules = [];
  for (let s = 0; s < heads.length; s++) {
    const start = heads[s].line + 1; // 헤딩 줄 제외
    const end = s + 1 < heads.length ? heads[s + 1].line : lines.length;
    const secId = 'R-' + (s + 1);
    let n = 0;
    for (let i = start; i < end; i++) {
      const m = lines[i].match(/^(\s*)([*+\-]|\d+[.)])\s+(.+)$/);
      if (!m) continue;
      const indent = m[1].replace(/\t/g, '    ').length;
      const depth = Math.floor(indent / 2) + 1; // 2-space 들여쓰기 = 1단계
      if (depth > ruleDepth) continue;
      const body = m[3].trim();
      if (body.replace(/[![\]()]/g, '').length < minChars) continue; // 짧은 구조 항목(PC/모바일/이미지)만 배제
      if (/^!\[.*\]\(.*\)$/.test(body)) continue; // 순수 이미지
      n++;
      rules.push({ rule_id: secId + '.' + n, sec_id: secId, line: i + 1, depth, text: body });
    }
  }

  return { sections, rules };
}

module.exports = { slice };

// ── CLI ──
if (require.main === module) {
  const [inPath, outPath] = process.argv.slice(2);
  const mc = process.argv.indexOf('--min-chars'); const rd = process.argv.indexOf('--rule-depth');
  if (!inPath || !outPath) { process.stderr.write('사용: slicer.js <confluence_raw.md> <out.json> [--min-chars N] [--rule-depth N]\n'); process.exit(1); }
  if (!fs.existsSync(inPath)) { process.stderr.write('[slicer] 입력 없음: ' + inPath + '\n'); process.exit(1); }
  const opts = {};
  if (mc >= 0) opts.minChars = parseInt(process.argv[mc + 1], 10);
  if (rd >= 0) opts.ruleDepth = parseInt(process.argv[rd + 1], 10);
  const res = slice(fs.readFileSync(inPath, 'utf8'), opts);
  const tmp = outPath + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(res, null, 1)); fs.renameSync(tmp, outPath);
  process.stdout.write(JSON.stringify({ ok: true, sections: res.sections.length, rules: res.rules.length }) + '\n');
  process.exit(0);
}
