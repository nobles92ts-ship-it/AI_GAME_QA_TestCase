#!/usr/bin/env node
/**
 * crossref_delta_collect.js — 델타 대조 입력 수집기 (결정론)
 *
 * 배경(2026-09-09 오너 지시 "최근에 생기는 것들은 dxr 검색 부터"):
 *   DXR 뇌 대조는 S1→S2 사이에 딱 한 번 돈다. 그런데 「기획 확인 필요」 항목은
 *   S4 적대 리뷰에서도 새로 태어나고, 그것들은 이미 끝난 dxr_crossref.json 에
 *   존재할 수가 없다 — 즉 **뇌에 한 번도 안 물어본 채 사람에게 질의로 나간다.**
 *   이 스크립트는 그 신규분만 골라내 델타 대조의 입력으로 만든다.
 *
 * 모드 2종 (둘 다 돈다 — 오너 선택 "둘 다"):
 *   --mode fixplan : S4→S5 사이. fix_plan.json 이 새로 다는 「기획 확인 필요」.
 *                    여기서 해결되면 답이 S5 적용 경로를 그대로 타서 기대값까지 채워진다.
 *   --mode final   : S6→S7 사이. 최종 TC 전량 중 비고열=「기획 확인 필요」.
 *                    출처가 어디든 100% 걸리는 마지막 그물(사람에게 나가기 직전).
 *
 * 출력: {mode, generated_at, items:[{id, tc_id, term, context}]}
 * exit: 0=수집 있음(대조 실행) / 4=0건(스킵, 정상) / 1=오류(호출측이 비차단 처리)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const TARGET = '기획 확인 필요';

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

function readJSON(p) {
  if (!p || !fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}

/**
 * 이전 런의 대조 결과 꼬리표(`→ [DXR] …`)를 떼어낸다.
 * ⚠ 이게 없으면 crossref_labels_annotate.js 가 패널에 주입한 순간 문자열이 달라져
 *   **이미 물어본 항목을 매번 새 항목으로 다시 묻는다** (2026-09-09 음성 대조에서 실측: 33건이 그대로 재수집).
 *   질의문으로도 부적절하다 — 우리가 붙인 답을 뇌에 되묻게 된다.
 */
function stripAnn(s) {
  return String(s == null ? '' : s).split('\n→ [DXR')[0].trim();
}

/** 대조 중복 판정용 정규화 — 공백·문장부호·따옴표 제거 후 비교 */
function norm(s) {
  return String(s == null ? '' : s)
    .replace(/[\s ]+/g, '')
    .replace(/["'`·,.()\[\]{}<>「」『』:;!?~\-—–_]/g, '')
    .toLowerCase();
}

/** 이미 대조를 거친 항목 집합 (term + note 안의 TC 번호 표기까지 본다) */
function alreadyAsked(crossref) {
  const seen = new Set();
  if (!crossref) return seen;
  for (const it of (crossref.items || [])) {
    if (it && it.term) seen.add(norm(it.term));
    if (it && it.tc_id) seen.add('tc:' + String(it.tc_id));
  }
  return seen;
}

/** fix_plan.json → 신규 「기획 확인 필요」 */
function fromFixPlan(work) {
  const fp = readJSON(path.join(work, 'fix_plan.json'));
  if (!fp) return { err: 'fix_plan.json 없음/파싱불가' };
  const patches = Array.isArray(fp) ? fp : (fp.patches || []);
  // 같은 런의 F열 문장을 문맥으로 붙이기 위해 스냅샷을 참조(있으면)
  const snap = readJSON(path.join(work, 'tcteam_snapshot.json'));
  const byId = new Map();
  for (const r of ((snap && snap.rows) || [])) {
    if (Array.isArray(r) && r[0]) byId.set(String(r[0]), r);
  }

  const out = [];
  for (const p of patches) {
    if (!p || typeof p !== 'object') continue;
    let hit = false;
    // ⚠ 열 문자(J/K)로 매칭하지 않는다 — 2026-09-04 링크열 신설로 비고가 J→K 로 밀렸고,
    //    과거 산출물엔 J 가 남아 있다. 값으로 매칭해야 양쪽 다 잡힌다.
    if (p.op === 'edit_cell' && norm(p.after) === norm(TARGET) && norm(p.before) !== norm(TARGET)) hit = true;
    if (p.op === 'add_row' && Array.isArray(p.row) && p.row.some(c => norm(c) === norm(TARGET))) hit = true;
    if (!hit) continue;

    const row = p.tc_id ? byId.get(String(p.tc_id)) : null;
    const stap = (Array.isArray(p.row) && p.row[5]) || (row && row[5]) || '';
    // 질의문 = 리뷰어가 남긴 사유(무엇이 불명확한지)가 1순위, 없으면 재현스탭
    const term = String(p.reason || stap || '').trim();
    if (!term) continue;
    out.push({
      tc_id: p.tc_id ? String(p.tc_id) : '',
      term,
      context: stap ? String(stap).slice(0, 200) : ''
    });
  }
  return { items: out };
}

/**
 * 사람에게 나가기 직전의 전량 수집:
 *   ① _labels.json 의 「기획확인」 배열 = 「📋 기획 확인 요청」 패널의 실제 원본(= 오너가 말한 "기획 확인 요청 내용")
 *   ② 최종 TC 중 비고열이 「기획 확인 필요」 인 행 (①에 안 올라온 per-TC 플래그까지 훑는다)
 * 둘의 합집합 — 출처가 어디든 사람에게 나가는 것은 전부 뇌를 한 번 거친다.
 */
function fromFinal(work) {
  const out = [];

  // ① 패널 원본
  const labels = readJSON(path.join(work, '_labels.json'));
  for (const q of ((labels && labels['기획확인']) || [])) {
    const term = stripAnn(q);
    if (term) out.push({ tc_id: '', term, context: '_labels.json 기획확인 패널' });
  }

  // ② TC 비고열 플래그
  const cand = ['tcteam_tc_final.json', 'tcteam_snapshot.json'];
  let t = null;
  for (const f of cand) {
    t = readJSON(path.join(work, f));
    if (t) break;
  }
  // _labels.json 을 읽었으면 TC 파일이 없어도 정상 경로(빈 목록 = exit 4 스킵). 둘 다 없을 때만 오류.
  if (!t) return labels ? { items: out } : { err: '_labels.json · tcteam_tc_final.json 모두 없음' };

  const rows = Array.isArray(t) ? t : (t.rows || []);
  const headers = (t && t.headers) || [];
  // ⚠ 비고 위치는 헤더 이름으로 찾는다(열 문자 하드코딩 금지 — 링크열 신설로 J→K 이동 전력).
  const noteIdx = headers.indexOf('비고');
  for (const r of rows) {
    if (!Array.isArray(r)) continue;
    let hit = false;
    if (noteIdx >= 0) hit = norm(r[noteIdx]) === norm(TARGET);
    else hit = r.some(c => norm(c) === norm(TARGET));   // 헤더 없으면 값 스캔으로 폴백
    if (!hit) continue;
    const term = String(r[5] || '').trim();             // 재현 스탭 = 무엇을 못 정했는지의 본문
    if (!term) continue;
    out.push({
      tc_id: String(r[0] || ''),
      term,
      context: [r[1], r[2], r[3]].filter(Boolean).join(' > ')
    });
  }
  return { items: out };
}

function main() {
  const work = arg('work', '');
  const mode = arg('mode', 'final');
  const outPath = arg('out', '');
  if (!work || !outPath) {
    console.error('usage: crossref_delta_collect.js --work <DIR> --mode fixplan|final --out <FILE>');
    process.exit(1);
  }

  const res = mode === 'fixplan' ? fromFixPlan(work) : fromFinal(work);
  if (res.err) {
    console.error('[delta_collect] ' + res.err + ' — 수집 스킵(비차단)');
    process.exit(1);
  }

  const crossref = readJSON(path.join(work, 'dxr_crossref.json'));
  const seen = alreadyAsked(crossref);

  const items = [];
  const dupKeys = new Set();
  for (const it of res.items) {
    const k = norm(it.term);
    if (!k || dupKeys.has(k)) continue;      // 델타 내부 중복
    if (seen.has(k)) continue;               // 이미 대조를 거친 항목 — 다시 묻지 않는다
    if (it.tc_id && seen.has('tc:' + it.tc_id)) continue;
    dupKeys.add(k);
    items.push({ id: (mode === 'fixplan' ? 'D4-' : 'D7-') + (items.length + 1), ...it });
  }

  const payload = { mode, generated_at: new Date().toISOString(), items };
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`[delta_collect] mode=${mode} 원본=${res.items.length} 신규=${items.length}`);
  process.exit(items.length ? 0 : 4);
}

main();
