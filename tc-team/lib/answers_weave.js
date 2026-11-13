#!/usr/bin/env node
/**
 * answers_weave.js — 기획자 답을 분석서 **본문**에 녹이는 고침안 적용기 (결정론 · 판단은 안 한다)
 *
 * 배경(2026-11-06 오너 「본문에 녹여줘」): answers_merge.js 는 답을 analysis.md 끝 Part D 에 모으기만 한다.
 *   본문(B-4 경계값 · C-1 미지정 목록 · A-5 키 목록 …)에는 여전히 「N (미지정)」이 남아, 분석서를 읽는 사람·에이전트가
 *   본문과 끝을 따로 맞춰야 했다. 어느 줄을 어떻게 고칠지는 LLM 이 고침안(JSON)으로 내고, 이 파일은 **안전하게 붙이기만** 한다.
 *
 * 고침안: {"ops": [
 *   {"ref": "<판> 패널 N번", "old": "<본문에 있는 그대로의 글>", "new": "<바꿀 글 — `(기획답변: <ref>)` 포함>"},
 *   {"ref": "<판> 패널 N번", "note": "<C-2 분석자 코멘트에 붙일 한 줄>"}   // 원문과 답이 다를 때 등
 * ]}
 *
 * 지키는 것(어기면 그 op 만 버리고 사유를 남긴다 — 나머지는 붙인다):
 *   - `### A-2.` ~ `### A-3.` (기획서 원문 보존) 과 Part D(표식 사이)는 **절대 안 고친다** — 원문은 원문이어야 한다.
 *   - old 는 고칠 수 있는 구역에서 **정확히 한 번**만 나와야 한다(0번 = 없는 글, 2번↑ = 어디를 고칠지 모호).
 *   - new 에는 `기획답변:` 출처가 있어야 한다 — 사람이 어느 답에서 왔는지 바로 보게.
 *   - 같은 old 를 두 op 가 고치면 뒤의 것은 버린다.
 * 녹인 답의 ref 와 그 답의 지문(hash)은 같은 폴더 `.answers_woven.json` 에 쌓는다 — 다음에 새 답·바뀐 답만 녹이기 위해.
 * 자동(11-06 「자동으로 해줘」): 루프\요청발송\weave_answers.py 가 15분 주기 끝에 `pending` 으로 안 녹인 답을 찾아
 *   Codex 에게 고침안을 받고 여기 `apply` 로 붙인다.
 *
 * 사용: node answers_weave.js apply <SPEC> <patch.json> [--check]   (--check = 쓰지 않고 판정만)
 *       node answers_weave.js pending <ROOT> [--baseline]          (안 녹인 답 JSON · --baseline = 옛 장부에 지문 채움)
 * stdout 마지막 줄 = `weave 적용 A · 버림 R · 메모 N`. exit 0 = 하나라도 적용 또는 고칠 것 없음 / 1 = 오류
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { BEGIN, END } = require('./answers_merge');

const TAG = '기획답변:';

/** 고칠 수 없는 구역 [시작, 끝) 목록 */
function protectedRanges(text) {
  const out = [];
  // 제목 깊이는 분석서마다 다르다(`## A-2.` / `### A-2.` — 2026-11-06 실측 28개 중 7개가 ##). 원문 안에도 기획서 자체 제목
  // (`# 공지 시스템`, `## 1. 개요`)이 그대로 들어 있어 「다음 제목」으로 끊으면 구역이 몇 줄로 줄어든다.
  // → 분석서 자신의 다음 절 번호(A-3 이후 · B- · C- · Part B~D)까지를 원문 보존 구역으로 본다. A-3 이 없는 분석서도 있다.
  const m = text.match(/^#{2,3} A-2\./m);
  if (m) {
    const body = text.indexOf('\n', m.index) + 1;   // 제목 줄 다음부터 찾는다
    const next = body > 0 ? text.slice(body).search(/^#{1,4} (A-(?:[3-9]|\d\d)\.|[BC]-\d+\.|Part [B-D]\b)/m) : -1;
    out.push([m.index, next >= 0 ? body + next : text.length]);
  }
  const s = text.indexOf(BEGIN), e = text.indexOf(END);
  if (s >= 0 && e > s) out.push([s, e + END.length]);
  return out;
}

function occurrences(text, needle, ranges) {
  const hits = [];
  for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + 1)) {
    if (!ranges.some(([a, b]) => i < b && i + needle.length > a)) hits.push(i);
  }
  return hits;
}

/** Part D 의 답 목록 [{ref, hash}] — ref = `<판> 패널 N번`, hash = 그 답 블록(질문·답·확정 여부·시각) 지문 */
function partD(text) {
  text = text.replace(/\r\n/g, '\n');
  const s = text.indexOf(BEGIN), e = text.indexOf(END);
  if (s < 0 || e < s) return [];
  const out = [];
  let ver = '', cur = null;
  const close = () => { if (cur) out.push({ ref: cur.ref, hash: sha(cur.lines.join('\n').trim()) }); cur = null; };
  for (const ln of text.slice(s, e).split('\n')) {
    const v = ln.match(/^### 판 `(.+)`/);
    if (v) { close(); ver = v[1]; continue; }
    const d = ln.match(/^#### D-\d+\. .* — 패널 (\S+?)번/);
    if (d) { close(); cur = { ref: `${ver} 패널 ${d[1]}번`, lines: [ln] }; continue; }
    if (/^#{1,3} /.test(ln)) { close(); continue; }
    if (cur) cur.lines.push(ln);
  }
  close();
  return out;
}
const sha = t => require('crypto').createHash('sha1').update(t).digest('hex').slice(0, 12);

function readLedger(spec) {
  try { const l = JSON.parse(fs.readFileSync(path.join(spec, '.answers_woven.json'), 'utf8')); return { refs: l.refs || [], hashes: l.hashes || {} }; }
  catch (e) { return { refs: [], hashes: {} }; }
}

/**
 * 아직 본문에 안 녹인 답 — 장부에 없는 ref, 또는 녹인 뒤 답이 바뀐 ref(지문이 다름).
 * 지문이 없는 옛 장부 ref 는 녹인 것으로 본다. baseline=true 면 그런 ref 의 지금 지문을 장부에 채운다(한 번).
 */
function pending(root, { baseline = false } = {}) {
  const out = [];
  for (const name of fs.readdirSync(root).sort()) {
    if (name.startsWith('_') || name.startsWith('.')) continue;
    const spec = path.join(root, name), f = path.join(spec, 'analysis.md');
    if (!fs.existsSync(f)) continue;
    const answers = partD(fs.readFileSync(f, 'utf8'));
    if (!answers.length) continue;
    const led = readLedger(spec), done = new Set(led.refs);
    const todo = answers.filter(a => !done.has(a.ref) || (led.hashes[a.ref] && led.hashes[a.ref] !== a.hash));
    if (baseline) {
      const fill = answers.filter(a => done.has(a.ref) && !led.hashes[a.ref]);
      if (fill.length) {
        const hashes = { ...led.hashes };
        fill.forEach(a => { hashes[a.ref] = a.hash; });
        fs.writeFileSync(path.join(spec, '.answers_woven.json'), JSON.stringify({ refs: led.refs, hashes }, null, 1));
      }
    }
    if (todo.length) out.push({ spec: name, refs: todo.map(a => a.ref) });
  }
  return out;
}

function apply(spec, patch, { check = false } = {}) {
  const file = path.join(spec, 'analysis.md');
  let text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const ops = (patch && patch.ops) || [];
  const applied = [], rejected = [], notes = [];
  const seen = new Set();
  for (const op of ops) {
    if (op.note) { notes.push(op); continue; }
    const why = !op.old || !op.new ? 'old/new 없음'
      : !String(op.new).includes(TAG) ? '출처(기획답변:) 없음'
      : op.old === op.new ? '바뀐 것 없음'
      : seen.has(op.old) ? '같은 글을 두 번 고침' : '';
    if (why) { rejected.push({ ...op, why }); continue; }
    const hits = occurrences(text, op.old, protectedRanges(text));
    if (hits.length !== 1) {
      const inProtected = text.includes(op.old) && !hits.length;
      rejected.push({ ...op, why: inProtected ? '원문 보존·Part D 구역' : hits.length ? `여러 곳(${hits.length})` : '본문에 없음' });
      continue;
    }
    seen.add(op.old);
    text = text.slice(0, hits[0]) + op.new + text.slice(hits[0] + op.old.length);
    applied.push(op);
  }
  // 메모 — C-2 분석자 코멘트 절 끝(다음 ### 앞)에 붙인다. 이미 같은 줄이 있으면 건너뛴다(멱등).
  const noteLines = notes.map(n => `- (${TAG} ${n.ref}) ${String(n.note).trim()}`).filter(l => !text.includes(l));
  if (noteLines.length) {
    const cm = text.match(/^(#{2,3}) C-2\./m);
    if (!cm) notes.forEach(n => rejected.push({ ...n, why: 'C-2 절 없음' }));
    else {
      const body = text.indexOf('\n', cm.index) + 1;
      const nx = body > 0 ? text.slice(body).search(new RegExp(`^#{1,${cm[1].length}} |^<!-- 기획답변:시작`, 'm')) : -1;
      const at = nx >= 0 ? body + nx : text.length;
      text = text.slice(0, at).replace(/\s*$/, '\n') + noteLines.join('\n') + '\n\n' + text.slice(at);
    }
  }
  if (!check && (applied.length || noteLines.length)) {
    fs.writeFileSync(file, text);
    recordWoven(spec, text, [...applied.map(o => o.ref), ...notes.map(n => n.ref), ...((patch && patch.no_change) || [])]);
  } else if (!check && ((patch && patch.no_change) || []).length) {
    recordWoven(spec, text, patch.no_change);   // 고칠 자리가 없다고 본 답도 녹인 것으로 친다 — 안 그러면 매번 다시 부른다
  }
  return { applied, rejected, notes: noteLines.length };
}

/** 장부에 ref 와 그 답의 지금 지문을 남긴다 — 답이 바뀌면 pending 이 다시 잡는다 */
function recordWoven(spec, text, refs) {
  const led = readLedger(spec), now = new Map(partD(text).map(a => [a.ref, a.hash]));
  const hashes = { ...led.hashes };
  refs.forEach(r => { if (now.has(r)) hashes[r] = now.get(r); });
  const all = new Set([...led.refs, ...refs]);
  fs.writeFileSync(path.join(spec, '.answers_woven.json'), JSON.stringify({ refs: [...all].sort(), hashes }, null, 1));
}

if (require.main === module) {
  const [cmd, spec, pf, flag] = process.argv.slice(2);
  try {
    if (cmd === 'pending' && spec) {
      process.stdout.write(JSON.stringify(pending(spec, { baseline: pf === '--baseline' })) + '\n');
      process.exit(0);
    }
    if (cmd !== 'apply' || !spec || !pf) throw new Error('사용법: answers_weave.js apply <SPEC> <patch.json> [--check] | pending <ROOT> [--baseline]');
    const r = apply(spec, JSON.parse(fs.readFileSync(pf, 'utf8')), { check: flag === '--check' });
    for (const x of r.rejected) process.stdout.write(`버림 [${x.why}] ${x.ref}: ${String(x.old || x.note || '').slice(0, 60).replace(/\n/g, ' ')}\n`);
    process.stdout.write(`weave 적용 ${r.applied.length} · 버림 ${r.rejected.length} · 메모 ${r.notes}\n`);
  } catch (e) {
    process.stderr.write(`answers_weave: ${e.message}\n`);
    process.exit(1);
  }
}

module.exports = { apply, protectedRanges, partD, pending };
