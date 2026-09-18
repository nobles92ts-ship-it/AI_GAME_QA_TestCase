#!/usr/bin/env node
/**
 * crossref_labels_annotate.js — 기획 확인 요청 패널에서 「답이 이미 있는 질문」을 빼는 필터 (결정론·멱등)
 *
 * 2026-09-11 오너 지시로 전환: "기획 확인 요청에 작성하는 거 좋은데 물어볼 거 없으면 질문하지 않아야 해"
 *   + "[dxr] 이런 건 필요 없어 · 최대한 쉽고 직관적으로 물어봐" (7차 시트 아이템_수집_시스템_개선_2차 시범 적용 → 승인).
 *   구 동작(09-09~11)은 질문 끝에 `→ [DXR] 정의 있음/위치/근거 없음` 꼬리표를 붙이고 항목을 **남겼다** —
 *   기획자는 답이 이미 있는 질문까지 읽었고, 꼬리표는 사람에게 필요 없는 우리 쪽 근거였다.
 *
 * 하는 일은 하나다: 대조가 답을 찾은 질문(`apply` · `approved:true`)을 `_labels.json` 에서 **뺀다.**
 *   남는 질문(`locate` · `keep` · `apply`+`approved:false` · 원장에 없는 항목)은 **한 글자도 바꾸지 않는다**
 *   — FINAL-5a 가 쓴 문장 그대로 5b 로 간다.
 * ⚠ 파일명은 이력상 annotate 로 남아 있다(호출부 crossref_delta.sh · 테스트 · 린터가 이 이름을 가리킨다).
 *   하는 일은 「필터」다 — 이름만 보고 꼬리표를 붙이는 코드로 되돌리지 말 것.
 *
 * 매칭: 패널 문장 ↔ 대조 term 정규화 완전일치. 수집기(crossref_delta_collect.js)가 패널 문장을 그대로 term 으로
 *   넣고, 병합기(--input)가 에이전트가 고쳐 쓴 term 을 수집 원문으로 되돌린다 — 그래서 완전일치가 성립한다.
 *   옛 꼬리표(`\n→ [DXR …`)가 남은 입력(구 런 산출물 재처리)은 떼고 비교·출력한다.
 *
 * ⚠ 뺀 질문은 같은 폴더 `_labels_removed.json` 에 근거(id·출처·메모)와 함께 남긴다 — 매 실행 덮어쓴다.
 *   이유: 꼬리표 시절엔 대조가 과신해 `apply` 를 달아도 질문은 패널에 보였다. 이제는 **조용히 사라진다.**
 *   실측(기능A 2026-09-11): 빠진 6건 중 1건은 대조가 원문에 없는 우선순위를 단정한 판정이었다
 *   (「전부 잠겼을 때 어떤 던전이 선택되나」 — 원문 **모순** 질의인데, 관련 규칙을 찾은 것을 답으로 봤다).
 *   틀린 제거를 사람이 되짚을 수 있는 유일한 기록이다.
 *   파일만 두면 아무도 안 연다 → 1건 이상이면 `.final5_removed.txt` 도 쓴다. chain_helpers.js final-report 가
 *   이것을 완주 보고(final_report.txt)에 **검토 알림**으로 올린다(실패 배너가 아니다 — 런은 성공). 0건이면 지운다.
 *
 * usage: crossref_labels_annotate.js <_labels.json> <dxr_crossref.json>
 * 출력(한 줄 — crossref_delta.sh 가 파싱): [labels_annotate] 질의 Q건 · 판정 J건 · 제거 R건 · 남음 M건
 *   J = 원장에서 판정을 찾은 질의 수. Q>0 인데 J=0 이면 term 불일치(에러 없이 끝나는 조용한 0건) — 호출측이 경고한다.
 *   R=0 은 정상일 수 있다(답을 찾은 질문이 없는 런). 그래서 경고 기준은 R 이 아니라 J 다.
 * exit: 0=처리(무변경 포함) / 1=입력 없음·오류(호출측이 비차단 처리)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const TAIL = '\n→ [DXR';   // 구 동작이 붙이던 꼬리표의 시작 — 여기부터 끝까지 뗀다

function readJSON(p, def) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return def; }
}

function norm(s) {
  return String(s == null ? '' : s)
    .replace(/[\s ]+/g, '')
    .replace(/["'`·,.()\[\]{}<>「」『』:;!?~\-—–_]/g, '')
    .toLowerCase();
}

const stripTail = s => String(s == null ? '' : s).split(TAIL)[0];
const answered = it => Boolean(it) && it.branch === 'apply' && it.approved === true;

/**
 * @param {string[]} questions  _labels.json 「기획확인」 배열
 * @param {object[]} items      dxr_crossref.json items (같은 term 이 여럿이면 뒤에 병합된 판정이 이긴다 — 델타가 원장 끝에 붙는다)
 * @returns {{kept:string[], dropped:{question:string,id:string,source:string,note:string}[],
 *            queried:number, judged:number, removed:number}}
 */
function filterLabels(questions, items) {
  const byTerm = new Map();
  for (const it of items || []) {
    if (it && it.term) byTerm.set(norm(it.term), it);
  }
  let judged = 0;
  const kept = [];
  const dropped = [];
  for (const q of questions || []) {
    const s = stripTail(q);
    const it = byTerm.get(norm(s));
    if (it) judged++;
    if (answered(it)) {
      dropped.push({ question: s, id: String(it.id || ''), source: String(it.source || ''), note: String(it.note || '') });
    } else {
      kept.push(s);
    }
  }
  return { kept, dropped, queried: (questions || []).length, judged, removed: dropped.length };
}

const firstLine = s => String(s).split('\n')[0];
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** 완주 보고 검토 알림 — 사람이 한 번 훑고 과신한 판정을 잡을 수 있게 질문 1줄차와 출처만 싣는다 */
function renderRemovedNotice(dropped) {
  return [
    `🔎 기획확인 패널에서 뺀 질문 ${dropped.length}건 — 대조가 「답 있음」으로 판정해 기획자에게 묻지 않았습니다. 한 번 훑어 주세요(판정이 과신이면 질문이 조용히 사라집니다).`,
    ...dropped.map(x => `   · ${clip(firstLine(x.question), 90)}  ← ${clip(x.source || '(출처 없음)', 70)}`),
    '   전체 근거: _labels_removed.json',
  ].join('\n');
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

  const r = filterLabels(labels['기획확인'], cross.items);
  fs.writeFileSync(labelsPath, JSON.stringify({ ...labels, 기획확인: r.kept }, null, 2), 'utf8');
  const dir = path.dirname(labelsPath);
  fs.writeFileSync(path.join(dir, '_labels_removed.json'),
    JSON.stringify({ _note: '대조가 답을 찾아 기획확인 패널에서 뺀 질문 (crossref_labels_annotate.js · 매 실행 덮어씀)', removed: r.dropped }, null, 2), 'utf8');
  const noticePath = path.join(dir, '.final5_removed.txt');
  if (r.dropped.length) fs.writeFileSync(noticePath, renderRemovedNotice(r.dropped), 'utf8');
  else fs.rmSync(noticePath, { force: true });
  console.log(`[labels_annotate] 질의 ${r.queried}건 · 판정 ${r.judged}건 · 제거 ${r.removed}건 · 남음 ${r.kept.length}건`);
  process.exit(0);
}

module.exports = { filterLabels, renderRemovedNotice, norm, stripTail };

if (require.main === module) main();
