'use strict';
/**
 * rewrite_stage.js — AI 다시 쓰기 팬아웃: 확정본 TC → 전제·조작·기대·관측 (LLM) + 원문 보존 게이트(결정론).
 *
 *  - 청크(기본 25행)마다 LLM 에게 입력 파일을 읽고 출력 파일을 쓰게 한다 — tc-team S3 문장화와 같은 계약.
 *  - 받는 기준: 요청한 id 가 한 번만 나왔고, checkRewrite(원문 보존)를 통과한 행. 조인은 id 로만 한다.
 *  - 못 받은 행만 사유를 붙여 2회차에 다시 보낸다. 2회 뒤에도 못 받으면 폴백 = 원문만 내보낸다(fail-closed).
 *  - 추후 구현 행은 실행하지 않으므로 보내지 않는다.
 *  - 실행기 rc 10(인증)·11(한도)이면 남은 청크를 띄우지 않고 그 코드로 멈춘다 — 띄워 봐야 같이 죽는다.
 */
const fs = require('fs');
const path = require('path');
const { checkRewrite, checkChunk, FIELDS } = require('./rewrite_gate');
const { noteKind } = require('./tc_rows');

const CHUNK_SIZE = 25;
const ATTEMPTS = 2;
const WORK_DIR = 'ai_work';
const OUT = 'ai_rewrite.json';
const ABORT_RC = new Set([10, 11]);

const EXPLAIN = [
  [/^number_missing:(.+)$/, (m) => `원문 숫자 ${m[1]} 이(가) 빠졌다`],
  [/^number_added:(.+)$/, (m) => `원문에 없는 숫자 ${m[1]} 을(를) 더했다`],
  [/^ident_missing:(.+)$/, (m) => `영문 이름 ${m[1]} 이(가) 빠졌다`],
  [/^mark_missing:(.+)$/, (m) => `기호·따옴표 문구 「${m[1]}」를 원문 글자 그대로 옮기지 않았다`],
  [/^polarity_lost$/, () => '원문은 부정(~않는지 · 안 ~는지)인데 기대가 부정문이 아니다'],
  [/^coverage:/, () => '원문의 조건·대상 낱말이 많이 빠졌다'],
  [/^(?:empty|shape|bad_item|too_many):(.+)$/, (m) => `${m[1]} 칸 형식이 틀렸다(문자열 배열, 1~6개)`],
  [/^no_output$/, () => '결과에 이 id 가 없었다'],
  [/^duplicate$/, () => '같은 id 를 두 번 냈다'],
];
const explain = (code) => { for (const [re, fn] of EXPLAIN) { const m = code.match(re); if (m) return fn(m); } return code; };

function buildPrompt({ rulesText, inFile, outFile, count, retryNote }) {
  return [rulesText, '',
    '## 작업',
    `"${inFile}" 파일을 Read 도구로 읽어라. rows 배열의 TC(정확히 ${count}개)를 위 규칙대로 전제·조작·기대·관측으로 나눠 써라.`,
    `결과는 반드시 "${outFile}" 에 아래 형식 JSON으로 Write 도구로 저장하라(다른 파일 생성·수정 금지):`,
    '{"rows":[{"id":"<입력 id 그대로>","전제":["..."],"조작":["..."],"기대":["..."],"관측":["..."]}, ...]}',
    '저장 후 "AI_REWRITE_DONE" 한 줄만 출력하고 종료.',
    ...(retryNote ? ['', retryNote] : [])].join('\n');
}

const inputRow = (r) => ({ id: r.id, 분류: [r.b, r.m, r.s].join(' › '), 검증단계: r.stage, 재현스탭: r.f, 판정보류: noteKind(r) === 'blocked' });
const pick = (row) => Object.fromEntries(FIELDS.map((k) => [k, row[k]]));
const readOut = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; } };

// 한 시도 판정 → { accepted:{id:네 칸}, failed:{id:[사유]}, chunkErrors }
function judgeAttempt(out, pending) {
  const rows = out && Array.isArray(out.rows) ? out.rows : [];
  const count = {};
  rows.forEach((r) => { if (r && typeof r.id === 'string') count[r.id] = (count[r.id] || 0) + 1; });
  const accepted = {};
  const failed = {};
  for (const [id, rec] of pending) {
    if (!count[id]) { failed[id] = ['no_output']; continue; }
    if (count[id] > 1) { failed[id] = ['duplicate']; continue; }
    const row = rows.find((r) => r && r.id === id);
    const res = checkRewrite(rec.f, row);
    // 원문을 같이 적어 둔다 — 내보내기가 확정본 문장과 대 보고, 그 뒤에 바뀌었으면 이 칸을 버린다(md_export rwState)
    if (res.ok) accepted[id] = { ...pick(row), 원문: rec.f }; else failed[id] = res.reasons;
  }
  const chunk = checkChunk([...pending.keys()], out);
  return { accepted, failed, chunkErrors: chunk.ok ? [] : chunk.errors };
}

function retryNote(failed, chunkErrors) {
  return ['⚠ 직전 시도에서 아래 TC 를 받지 못했다. 이번 입력에는 이 TC 들만 있다 — 사유를 고쳐 다시 써라.',
    ...Object.entries(failed).map(([id, rs]) => `- TC-${id}: ${rs.map(explain).join(' / ')}`),
    ...(chunkErrors.length ? [`(형식: ${chunkErrors.slice(0, 5).join(' · ')})`] : [])].join('\n');
}

async function runChunk(k, recs, ctx) {
  let pending = new Map(recs.map((r) => [r.id, r]));
  let failed = {};
  let note = '';
  let outputs = 0;   // 결과가 JSON 으로 읽힌 시도 수 — 0 이면 게이트가 거른 게 아니라 실행기가 못 돌았거나 형식이 틀린 것(러너가 멈춘다)
  const accepted = {};
  for (let a = 1; a <= ATTEMPTS && pending.size; a++) {
    const base = path.join(ctx.work, `c${String(k + 1).padStart(3, '0')}_a${a}`);
    const meta = { chunk: k, attempt: a, inFile: `${base}_in.json`, outFile: `${base}_out.json`, errlog: path.join(ctx.work, `.c${k + 1}_stderr.log`) };
    fs.writeFileSync(meta.inFile, JSON.stringify({ rows: [...pending.values()].map(inputRow) }, null, 1), 'utf8');
    const rc = await ctx.invoke(buildPrompt({ rulesText: ctx.rulesText, inFile: meta.inFile, outFile: meta.outFile, count: pending.size, retryNote: note }), meta);
    if (ABORT_RC.has(rc)) return { abort: rc };
    const out = readOut(meta.outFile);
    if (out) outputs++;
    const j = judgeAttempt(out, pending);
    Object.assign(accepted, j.accepted);
    failed = j.failed;
    pending = new Map([...pending].filter(([id]) => !j.accepted[id]));
    note = retryNote(failed, j.chunkErrors);
    ctx.log(`[AI] 다시 쓰기 청크 ${k + 1} ${a}회차 — 받음 ${Object.keys(j.accepted).length} · 남음 ${pending.size}${rc ? ` (실행기 rc=${rc})` : ''}`);
  }
  return { accepted, fallback: Object.fromEntries([...pending.keys()].map((id) => [id, failed[id] || ['no_output']])), outputs };
}

async function pool(n, par, fn) {
  let next = 0;
  let abort = null;
  const worker = async () => {
    while (abort == null && next < n) { const r = await fn(next++); if (r && r.abort) abort = r.abort; }
  };
  await Promise.all(Array.from({ length: Math.min(par, n) }, worker));
  return abort;
}

/** → { ok:true, data } (ai_rewrite.json 도 씀) | { ok:false, abort: 10|11 } */
async function rewriteStage({ spec, records, rulesText, invoke, par = 4, chunkSize = CHUNK_SIZE, log = () => {} }) {
  const work = path.join(spec, WORK_DIR);
  fs.rmSync(work, { recursive: true, force: true });   // 이 단계 전용 작업 폴더 — 재실행은 처음부터
  fs.mkdirSync(work, { recursive: true });
  const later = records.filter((r) => noteKind(r) === 'later');
  const targets = records.filter((r) => noteKind(r) !== 'later');
  const chunks = [];
  for (let i = 0; i < targets.length; i += chunkSize) chunks.push(targets.slice(i, i + chunkSize));
  log(`[AI] 다시 쓰기 — 대상 ${targets.length}행 · 청크 ${chunks.length}개 · 동시 ${par} (추후 구현 ${later.length}행 제외)`);

  const results = [];
  const ctx = { work, invoke, rulesText, log };
  const abort = await pool(chunks.length, par, async (k) => { results[k] = await runChunk(k, chunks[k], ctx); return results[k]; });
  if (abort != null) return { ok: false, abort };

  const rows = Object.assign({}, ...results.map((r) => r.accepted));
  const fallback = Object.assign({}, ...results.map((r) => r.fallback));
  const skipped = Object.fromEntries(later.map((r) => [r.id, '추후 구현']));
  const data = {
    generated_at: new Date().toISOString(),
    stats: { targets: targets.length, rewritten: Object.keys(rows).length, fallback: Object.keys(fallback).length, skipped: later.length,
      outputs: results.reduce((a, r) => a + r.outputs, 0) },
    rows, fallback, skipped,
  };
  fs.writeFileSync(path.join(spec, OUT), JSON.stringify(data, null, 1), 'utf8');
  return { ok: true, data };
}

module.exports = { OUT, CHUNK_SIZE, rewriteStage, buildPrompt, judgeAttempt, explain };
