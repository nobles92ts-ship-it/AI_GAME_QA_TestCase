#!/usr/bin/env node
/**
 * crossref_delta_merge.js — 델타 대조 결과 병합기 (결정론·멱등)
 *
 * 델타 대조 에이전트가 낸 결과를 원본 dxr_crossref.json 에 흡수한다.
 * 원본이 없으면 새로 만든다(대조 스킵 런에서 델타만 도는 경우 대비).
 *
 * 멱등: item.id 기준. 같은 id 가 이미 있으면 덮어쓴다(재실행 안전).
 * counts 는 병합 후 전량 재계산 — 손으로 더하지 않는다(카운터 단일화).
 *
 * --input <delta_in.json> (2026-09-11): 입력 필드(term·tc_id·context)는 수집기가 소유한다.
 *   에이전트가 term 을 고쳐 써도 id 로 수집 원문을 되돌린다 — 패널 필터(crossref_labels_annotate.js)가
 *   term 완전일치로 답 있는 질문을 빼므로, 한 글자만 달라져도 그 질문은 답이 있는데도 조용히 남는다
 *   (실측: 과거 델타 114건 중 1건 변형).
 *
 * usage: crossref_delta_merge.js <dxr_crossref.json> <delta_result.json> [--origin S4|S7] [--input <delta_in.json>]
 * exit: 0=병합 완료 / 1=오류(호출측이 비차단 처리)
 */
'use strict';
const fs = require('fs');

function readJSON(p, def) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return def; }
}

function recount(items, discovered) {
  const c = { in: items.length, apply: 0, locate: 0, discover: (discovered || []).length, keep: 0 };
  for (const it of items) {
    const b = it && it.branch;
    if (b === 'apply' && it.approved === true) c.apply++;
    else if (b === 'apply') c.locate++;          // approved:false 는 locate 취급 (tc-대조.md §1.3 ㉠)
    else if (b === 'locate') c.locate++;
    else if (b === 'discover') c.discover++;
    else c.keep++;                               // keep · 미분류 전부 keep
  }
  return c;
}

function main() {
  const target = process.argv[2];
  const deltaPath = process.argv[3];
  const oi = process.argv.indexOf('--origin');
  const origin = oi >= 0 && process.argv[oi + 1] ? process.argv[oi + 1] : 'delta';
  const ii = process.argv.indexOf('--input');
  const input = ii >= 0 && process.argv[ii + 1] ? readJSON(process.argv[ii + 1], null) : null;

  if (!target || !deltaPath) {
    console.error('usage: crossref_delta_merge.js <dxr_crossref.json> <delta_result.json> [--origin S4|S7] [--input <delta_in.json>]');
    process.exit(1);
  }
  if (!fs.existsSync(deltaPath)) {
    console.error('[delta_merge] 델타 결과 없음 — 병합 스킵');
    process.exit(1);
  }

  const delta = readJSON(deltaPath, null);
  if (!delta) { console.error('[delta_merge] 델타 결과 파싱 불가'); process.exit(1); }
  const inById = new Map(((input && input.items) || []).map(x => [x && x.id, x]));
  let restored = 0;
  const dItems = (delta.items || []).map(it => {
    const src = it && inById.get(it.id);
    if (!src) return { ...it, delta: true, origin };
    if (src.term !== it.term) restored++;
    return { ...it, term: src.term, tc_id: src.tc_id, context: src.context, delta: true, origin };
  });

  const base = readJSON(target, null) || { source_run: '', items: [], discovered: [], counts: {} };
  base.items = Array.isArray(base.items) ? base.items : [];
  base.discovered = Array.isArray(base.discovered) ? base.discovered : [];

  const byId = new Map(base.items.map(it => [it && it.id, it]));
  let added = 0, replaced = 0;
  for (const it of dItems) {
    if (!it || !it.id) continue;
    if (byId.has(it.id)) { replaced++; } else { added++; }
    byId.set(it.id, it);
  }
  base.items = [...byId.values()];
  for (const d of (delta.discovered || [])) base.discovered.push(d);
  base.counts = recount(base.items, base.discovered);

  fs.writeFileSync(target, JSON.stringify(base, null, 2), 'utf8');
  const c = base.counts;
  console.log(`[delta_merge] origin=${origin} 추가=${added} 갱신=${replaced}${input ? ` term복원=${restored}` : ''} → in=${c.in} apply=${c.apply} locate=${c.locate} discover=${c.discover} keep=${c.keep}`);
  process.exit(0);
}

main();
