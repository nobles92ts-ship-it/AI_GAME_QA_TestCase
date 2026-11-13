#!/usr/bin/env node
/**
 * answers_merge.js — 기획자 답(기획답변.md)을 그 기능의 **최신 판** 분석서(analysis.md)에 누적한다 (결정론)
 *
 * 배경(2026-11-06 오너 지시):
 *   「질문 답이 답변 .md 로 모이고 있는데 결국 그게 다 모여서 분석서로 쌓여야 해 — 분석서의 퀄리티를 올리는 게 핵심」
 *   「답이 들어올 때마다 계속 쌓아서 v2, v3 ~ v7 최신 것이 가장 최신에 완벽한 분석서가 되도록」
 *   「다른 TC 만들 때 찾을 때도 항상 최신 버전으로」
 *   시트 패널의 답은 요청 발송 자동화({WORK_ROOT}\루프\요청발송\request_send.py)가 specs/<탭>/기획답변.md 에 덧붙인다.
 *   그런데 analysis.md 는 그 답을 몰랐고, 같은 기획서를 다시 돌리면(_v2·_v3 — 새 폴더) 답이 통째로 사라졌다.
 *   실례: 기능BO 답 20건 · 초안_기능BL 답 13건 — 각 _v2 런이 하나도 몰랐다.
 *
 * 같은 기능 = 이름(앞 `초안_`·끝 `_vN`·`_`·공백을 뺀 것)이 같고, 기획서 page id(sheet_info.txt)가 서로 다르지 않은 폴더들.
 *   ⚠ page id 만으로 묶지 않는다 — 한 기획서에서 다른 기능 탭을 뽑은 경우가 있다(기능AS ↔ 기능BK).
 * 최신 판 = 높은 _vN > analysis.md·tc_design.md 가 최근 > 이름순. 뇌 색인(_BRAIN/_specs_canonical.py)과 같은 순서다.
 *
 * 서브커맨드:
 *   sync <SPECS_ROOT>  기능마다 모든 판의 기획답변.md 를 모아 **최신 판** analysis.md 의 「Part D」 절(표식 사이)을 새로 쓴다.
 *                      멱등 — 표식 사이만 바꾼다. 옛 판 폴더는 건드리지 않는다. 요청 발송이 매 실행 끝에 부른다
 *                      (새 판 폴더가 생기면 다음 실행에 누적본이 그리로 옮겨 간다).
 *   collect <SPEC>     같은 기능의 **다른** 판 답을 SPEC/prior_answers.md 로 쓴다 — S1 설계자가 새 분석서에 녹인다
 *                      (tc-분석.md §기획 답변 승계). stdout `prior N` (0 이면 파일을 지운다).
 *
 * 같은 칸에 답이 여러 번 떠졌으면(답 수정) 마지막 것만 쓴다 — 열쇠 = 칸 + 질문 첫 줄.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const BEGIN = '<!-- 기획답변:시작 (lib/answers_merge.js 가 씀 — 손으로 고치지 말 것) -->';
const END = '<!-- 기획답변:끝 -->';
const ANSWER_FILE = '기획답변.md';
const ESSENCE = ['analysis.md', 'tc_design.md'];
// 답 안에 「아직 안 정함」이 있으면 「미정 포함」 — 2026-11-06 실측 답 310건의 미정 표현.
const UNDECIDED = /미정|정해지지|결정되지|아직|추후|예정입니다|논의|협의 후|검토 중|TBD|변경될 수 있/;

function read(p) { try { return fs.readFileSync(p, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }

/** 기획답변.md → [{no, cell, stamp, question, answer}] (같은 칸·같은 질문은 마지막 것만) */
function parseAnswers(text) {
  const out = new Map();
  // request_send.py 는 Windows 텍스트 모드라 CRLF 로 쓴다 — 줄끝을 맞춘 뒤 읽는다(2026-11-06 첫 시험에서 0건).
  const re = /^## (\d+)\. \(([A-Z]+\d+)\) ([0-9-]+ [0-9:]+)\n\*\*질문\*\* ([\s\S]*?)\n\n\*\*답\*\* ([\s\S]*?)(?=\n## \d+\. \(|\s*(?![\s\S]))/gm;
  for (const m of (text || '').replace(/\r\n/g, '\n').matchAll(re)) {
    const [, no, cell, stamp, question, answer] = m;
    const key = cell + '|' + question.split('\n')[0].trim();
    if (out.has(key)) out.delete(key);
    out.set(key, { no, cell, stamp, question: question.trim(), answer: answer.trim() });
  }
  return [...out.values()];
}

// ── 같은 기능 묶기 · 최신 판 ────────────────────────────────────────────────
// 끝의 Jira 키(`_DX10610`)도 뗀다 — 일감 번호를 붙여 만든 분석 폴더(기능BK)와 시트 탭(기능BK)이
// 같은 기능인데 이름이 달라 답이 못 붙었다(11-06). page id 가 갈리면 여전히 다른 기능이다.
const featureName = d => d.replace(/_v\d+$/, '').replace(/_DX\d+$/i, '').replace(/^초안_/, '').replace(/[_\s]/g, '');
const versionOf = d => { const m = d.match(/_v(\d+)$/); return m ? Number(m[1]) : 1; };
function pageId(dir) {
  const m = (read(path.join(dir, 'sheet_info.txt')) || '').match(/CONFLUENCE_URL=\S*?\/pages\/(\d+)/);
  return m ? m[1] : null;
}
function essenceMtime(dir) {
  const t = ESSENCE.map(f => { try { return fs.statSync(path.join(dir, f)).mtimeMs; } catch (e) { return 0; } });
  return Math.max(0, ...t);
}

/** SPECS_ROOT → [[{name, dir, ver, mtime, page}] 최신 먼저] */
function groups(root) {
  const byName = new Map();
  for (const name of fs.readdirSync(root)) {
    const dir = path.join(root, name);
    if (name.startsWith('_') || !fs.statSync(dir).isDirectory()) continue;   // `_` 접두 = 보류·취소·도구(뇌도 강등)
    const f = { name, dir, ver: versionOf(name), mtime: essenceMtime(dir), page: pageId(dir) };
    const k = featureName(name);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(f);
  }
  const out = [];
  for (const list of byName.values()) {
    // 이름이 같아도 page id 가 둘 이상이면 page 별로 가른다. page 를 모르는 폴더는 page 가 하나뿐일 때만 그 묶음에 든다.
    const pages = [...new Set(list.map(f => f.page).filter(Boolean))];
    if (pages.length <= 1) out.push(list);
    else {
      for (const p of pages) out.push(list.filter(f => f.page === p));
      for (const f of list.filter(f => !f.page)) out.push([f]);
    }
  }
  // 정식 은퇴 기록이 있으면 page id 가 달라도 한 기능이다 — 새 판이 옛 탭을 은퇴시키며 `<새 판>/retired_*/retirement_manifest.json`
  // 에 옛 탭 이름을 남긴다. 기획서가 새 페이지로 옮겨진 경우(기능BL_v3 ← 초안_…_v2, 11-06)라 page 규칙이 둘을 갈라
  // 옛 판 답 14건이 최신 판에 안 갔다. 옛 탭 이름과 **같은 이름의 폴더**가 든 묶음을 새 판 묶음에 합친다.
  for (const [oldName, newName] of retirements(root)) {
    const to = out.find(g => g.some(f => f.name === newName));
    const from = out.find(g => g.some(f => f.name === oldName));
    if (to && from && to !== from) { to.push(...from); out.splice(out.indexOf(from), 1); }
  }
  const newest = (a, b) => b.ver - a.ver || b.mtime - a.mtime || a.name.localeCompare(b.name);
  return out.map(g => g.sort(newest));
}

/** [[은퇴한 탭 이름, 은퇴시킨 새 판 폴더 이름]] */
function retirements(root) {
  const out = [];
  for (const name of fs.readdirSync(root)) {
    const dir = path.join(root, name);
    if (name.startsWith('_') || !fs.statSync(dir).isDirectory()) continue;
    for (const sub of fs.readdirSync(dir).filter(s => /^retired_/.test(s))) {
      try {
        const m = JSON.parse(fs.readFileSync(path.join(dir, sub, 'retirement_manifest.json'), 'utf8'));
        const old = (m.targetTab && m.targetTab.title) || (m.oldTarget && m.oldTarget.title);
        if (old && old !== name) out.push([old, name]);
      } catch (e) { /* 기록 없음·깨짐 — 이름·page 규칙대로 */ }
    }
  }
  return out;
}

// ── 그리기 ─────────────────────────────────────────────────────────────────
const quote = s => s.split('\n').map(l => '> ' + l).join('\n');
const status = a => (UNDECIDED.test(a) ? '미정 포함' : '확정');

/** sources = [{name, items}] 최신 판 먼저 */
function render(sources, title) {
  const all = sources.flatMap(s => s.items);
  const done = all.filter(x => !UNDECIDED.test(x.answer)).length;
  const lines = [BEGIN, '', `## ${title}`, '',
    `기획자 답 ${all.length}건(판 ${sources.length}개) · 확정 ${done} · 미정 포함 ${all.length - done}. 원문 = 각 판 폴더의 \`${ANSWER_FILE}\`(시트 패널).`,
    '- **확정** 답은 원문(Part A)보다 나중에 기획자가 정한 사양이다 — C-1 미지정값·C-2 모호 항목에서 같은 것을 다시 묻지 않는다.',
    '- **미정 포함**은 답 안에 「미정·추후·변경될 수 있음」이 있다는 뜻이다 — 정해진 부분만 쓰고, 나머지는 지어내지 말고 미지정으로 둔다.',
    '- 같은 물음에 판마다 답이 다르면 **위에 있는(최신) 판의 답**이 이긴다.', ''];
  let n = 0;
  for (const s of sources) {
    lines.push(`### 판 \`${s.name}\` — ${s.items.length}건`, '');
    for (const x of s.items) {
      lines.push(`#### D-${++n}. ${status(x.answer)} — 패널 ${x.no}번 (${x.cell}, ${x.stamp})`,
        '**질문**', quote(x.question), '', '**답**', quote(x.answer), '');
    }
  }
  lines.push(END);
  return lines.join('\n');
}

function upsert(file, block) {
  const cur = read(file);
  if (cur === null) return 'missing';
  const s = cur.indexOf(BEGIN), e = cur.indexOf(END);
  const next = (s >= 0 && e > s) ? cur.slice(0, s) + block + cur.slice(e + END.length)
    : cur.replace(/\s*$/, '') + '\n\n' + block + '\n';
  if (next === cur) return 'same';
  fs.writeFileSync(file, next);
  return 'written';
}

const sourcesOf = folders => folders
  .map(f => ({ name: f.name, items: parseAnswers(read(path.join(f.dir, ANSWER_FILE))) }))
  .filter(s => s.items.length);

/**
 * 분석 폴더와 이어지지 않은 탭의 답 — 요청 발송이 `<extraDir>/<탭>_기획답변.md` 로 떠 둔 것.
 * 2026-11-06 실측 10탭: 7차 시트에서 만든 TC 를 8차 시트로 옮겨 sheet_info 의 시트 ID 가 달라 연결이 끊겼다(같은 기능).
 * 이름(featureName)으로만 붙인다 — 이름이 같은 묶음이 둘 이상이면(page 가 갈림) 붙이지 않는다.
 * → Map featureName → [{name, items}]
 */
function extraSources(extraDir) {
  const out = new Map();
  if (!extraDir || !fs.existsSync(extraDir)) return out;
  for (const f of fs.readdirSync(extraDir)) {
    const m = f.match(/^(.+)_기획답변\.md$/);
    if (!m) continue;
    const items = parseAnswers(read(path.join(extraDir, f)));
    if (!items.length) continue;
    const k = featureName(m[1]);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push({ name: `시트 탭 ${m[1]} (분석 폴더와 시트가 갈린 탭)`, items });
  }
  return out;
}

function withExtras(gs, extraDir) {
  const ex = extraSources(extraDir);
  const count = new Map();
  for (const g of gs) { const k = featureName(g[0].name); count.set(k, (count.get(k) || 0) + 1); }
  const unplaced = [...ex.keys()].filter(k => count.get(k) !== 1);
  return { extra: g => (count.get(featureName(g[0].name)) === 1 ? ex.get(featureName(g[0].name)) || [] : []), unplaced };
}

/** → {features: [{latest, sources, count, result: written|same|missing}], unplaced: [featureName]} (답이 있는 기능만) */
function sync(root, extraDir) {
  const res = [];
  const gs = groups(root);
  const { extra, unplaced } = withExtras(gs, extraDir);
  for (const g of gs) {
    const sources = [...extra(g), ...sourcesOf(g)];   // 시트가 갈린 탭은 지금 시트 쪽이라 가장 최근 — 맨 위
    if (!sources.length) {
      // 답이 다 없어졌는데(잘못 떠진 답을 지운 경우 — 11-06 「위치 기억 기능」 번호형 패널) 블록이 남아 있으면 걷어낸다.
      const f = path.join(g[0].dir, 'analysis.md');
      const cur = read(f);
      const s = cur ? cur.indexOf(BEGIN) : -1, e = cur ? cur.indexOf(END) : -1;
      if (s >= 0 && e > s) {
        fs.writeFileSync(f, cur.slice(0, s).replace(/\s*$/, '\n') + cur.slice(e + END.length).replace(/^\s*/, ''));
        res.push({ latest: g[0].name, sources: [], count: 0, result: 'removed' });
      }
      continue;
    }
    const latest = g[0];
    const result = upsert(path.join(latest.dir, 'analysis.md'),
      render(sources, 'Part D — 기획 확인 답변 (전 판 누적 · 기획자 확정 사양)'));
    res.push({ latest: latest.name, sources: sources.map(s => s.name), count: sources.reduce((a, s) => a + s.items.length, 0), result });
  }
  return { features: res, unplaced };
}

function collect(spec, extraDir, root = path.dirname(path.resolve(spec))) {
  const out = path.join(spec, 'prior_answers.md');
  const self = path.basename(path.resolve(spec));
  const gs = groups(root);
  const g = gs.find(list => list.some(f => f.name === self)) || [];
  const sources = g.length ? [...withExtras(gs, extraDir).extra(g), ...sourcesOf(g.filter(f => f.name !== self))] : [];
  const count = sources.reduce((a, s) => a + s.items.length, 0);
  if (!count) { fs.rmSync(out, { force: true }); return 0; }
  fs.writeFileSync(out, [`# 같은 기능을 앞서 돌린 판의 기획자 답 — answers_merge.js collect`, '',
    '규칙 = tc-분석.md §기획 답변 승계. 현행 원문(confluence_raw.md)이 그 부분을 바꿨으면 원문이 이긴다.', '',
    render(sources, '이전 판 기획 확인 답변').replace(BEGIN, '').replace(END, '').trim(), ''].join('\n'));
  return count;
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const xi = argv.indexOf('--extra');
  const extraDir = xi >= 0 ? argv.splice(xi, 2)[1] : '';
  const [cmd, arg] = argv;
  try {
    if (!arg) throw new Error('사용법: answers_merge.js sync <SPECS_ROOT> | collect <SPEC>  [--extra <폴더와 이어지지 않은 탭 답 폴더>]');
    if (cmd === 'sync') {
      const { features: r, unplaced } = sync(arg, extraDir);
      for (const x of r.filter(x => x.result !== 'same')) {
        process.stdout.write(x.result === 'removed' ? `갱신 ${x.latest} ← 답 없음 — Part D 걷어냄\n`
          : `${x.result === 'written' ? '갱신' : '분석서 없음'} ${x.latest} ← ${x.sources.join(' + ')} (${x.count}건)\n`);
      }
      if (unplaced.length) process.stdout.write(`붙일 분석 폴더를 못 찾은 탭 답: ${unplaced.join(', ')}\n`);
      process.stdout.write(`sync 기능 ${r.length} · 갱신 ${r.filter(x => x.result === 'written').length} · 분석서 없음 ${r.filter(x => x.result === 'missing').length} · 못 붙인 탭 ${unplaced.length}\n`);
    } else if (cmd === 'collect') {
      process.stdout.write(`prior ${collect(arg, extraDir)}\n`);
    } else throw new Error('알 수 없는 서브커맨드: ' + cmd);
  } catch (e) {
    process.stderr.write(`answers_merge: ${e.message}\n`);
    process.exit(1);
  }
}

module.exports = { parseAnswers, groups, sync, collect, featureName, BEGIN, END, UNDECIDED };
