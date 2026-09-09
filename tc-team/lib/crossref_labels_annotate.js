#!/usr/bin/env node
/**
 * crossref_labels_annotate.js — 기획 확인 요청 패널에 DXR 대조 결과를 주입 (결정론·멱등)
 *
 * 2026-09-09 오너 지시 "최근에 생기는 것들은 dxr 검색 부터" 의 **소비처**.
 * 델타 대조가 dxr_crossref.json 을 채워도 읽는 곳이 없으면 조용한 게이트가 된다 —
 * 여기서 _labels.json(= apply_labeling.js 가 「📋 기획 확인 요청」 패널로 찍는 원본)에
 * 대조 결과를 붙여, 기획자에게 나가는 질문이 다음 셋 중 하나를 달고 나가게 한다:
 *   · [DXR] 정의 있음 — 뇌가 확정 스펙을 찾음(질문 자체가 불필요할 수 있음)
 *   · [DXR] 위치      — 어느 문서를 보면 되는지
 *   · [DXR] 근거 없음  — 뇌에 물어봤고 정말 없더라 (= 진짜 물어볼 값어치가 있는 질문)
 * 세 번째가 핵심이다. 그게 붙어 있어야 "안 찾아보고 물어본 것"과 구분된다.
 *
 * usage: crossref_labels_annotate.js <_labels.json> <dxr_crossref.json>
 * exit: 0=처리(무변경 포함) / 1=입력 없음·오류(호출측이 비차단 처리)
 */
'use strict';
const fs = require('fs');

const MARK = '\n→ [DXR';   // 멱등 판정용 접두 — 이미 붙어 있으면 다시 붙이지 않는다

function readJSON(p, def) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return def; }
}

function norm(s) {
  return String(s == null ? '' : s)
    .replace(/[\s ]+/g, '')
    .replace(/["'`·,.()\[\]{}<>「」『』:;!?~\-—–_]/g, '')
    .toLowerCase();
}

/** 대조 항목 → 패널에 붙일 한 줄 (붙일 게 없으면 null) */
function line(it) {
  const src = String(it.source || '').trim();
  const note = String(it.note || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  if (it.branch === 'apply' && it.approved === true) {
    return `\n→ [DXR] 정의 있음${src ? ` — ${src}` : ''}${note ? `: ${note}` : ''}`;
  }
  if (it.branch === 'locate' || (it.branch === 'apply' && it.approved !== true)) {
    return src ? `\n→ [DXR] 위치 — ${src}${note ? `: ${note}` : ''}` : null;
  }
  if (it.branch === 'keep') {
    return '\n→ [DXR] 근거 없음 (뇌 대조 완료 — 기획 확인 필요)';
  }
  return null;
}

function main() {
  const labelsPath = process.argv[2];
  const crossPath = process.argv[3];
  if (!labelsPath || !crossPath) {
    console.error('usage: crossref_labels_annotate.js <_labels.json> <dxr_crossref.json>');
    process.exit(1);
  }
  const labels = readJSON(labelsPath, null);
  const cross = readJSON(crossPath, null);
  if (!labels || !Array.isArray(labels['기획확인'])) {
    console.error('[labels_annotate] _labels.json 없음/스키마 불일치 — 스킵');
    process.exit(1);
  }
  if (!cross || !Array.isArray(cross.items)) {
    console.error('[labels_annotate] dxr_crossref.json 없음 — 스킵(대조 off 환경 정상 경로)');
    process.exit(1);
  }

  const byTerm = new Map();
  for (const it of cross.items) {
    if (it && it.term) byTerm.set(norm(it.term), it);
  }

  let hit = 0, skipped = 0;
  labels['기획확인'] = labels['기획확인'].map(q => {
    const s = String(q == null ? '' : q);
    if (s.includes(MARK)) { skipped++; return s; }      // 이미 주입됨 — 멱등
    const it = byTerm.get(norm(s));
    if (!it) return s;                                   // 대조 안 된 항목은 손대지 않는다
    const add = line(it);
    if (!add) return s;
    hit++;
    return s + add;
  });

  fs.writeFileSync(labelsPath, JSON.stringify(labels, null, 2), 'utf8');
  console.log(`[labels_annotate] 질의 ${labels['기획확인'].length}건 · 주입 ${hit}건 · 기주입 ${skipped}건`);
  process.exit(0);
}

main();
