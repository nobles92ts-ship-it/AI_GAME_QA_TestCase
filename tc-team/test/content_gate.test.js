'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { checkContent } = require('../lib/content_gate.js');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  PASS ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' — ' + e.message); } }

// 10열 [A,B,C,D,E,F,G,H,I,J]
const row = (over = {}) => {
  const r = ['001', 'QA', '중', '소', '정상', '버튼을 누르면 창이 열리는지 확인', 'PC/모바일', '미진행', '미진행', ''];
  if (over.F != null) r[5] = over.F;
  if (over.G != null) r[6] = over.G;
  if (over.J != null) r[9] = over.J;
  if (over.A != null) r[0] = over.A;
  return r;
};

console.log('content_gate.js 테스트');

t('클린 행 = PASS', () => {
  const res = checkContent([row(), row({ A: '002', G: 'PC' }), row({ A: '003', G: '모바일', J: '추후 구현' })]);
  assert.ok(res.pass, JSON.stringify(res.byType));
});

t('추상표현(정상적으로) 차단', () => {
  const res = checkContent([row({ F: '기능이 정상적으로 작동하는지 확인' })]);
  assert.strictEqual(res.pass, false);
  assert.strictEqual(res.byType.abstract, 1);
});

t('추상표현 — 올바르게/적절히/제대로/문제없이 전부 차단', () => {
  for (const w of ['올바르게', '적절히', '제대로', '문제없이']) {
    const res = checkContent([row({ F: `${w} 처리되는지 확인` })]);
    assert.strictEqual(res.pass, false, w);
  }
});

t('lookbehind — "비정상적으로"는 추상 아님(정당 표현)', () => {
  const res = checkContent([row({ F: '입력이 비정상적으로 크면 거부되는지 확인' })]);
  assert.strictEqual(res.byType.abstract, undefined, '비정상적으로는 통과해야');
});

t('Output Format 잔류 차단', () => {
  const res = checkContent([row({ F: "Output Format: '[사전 상태]에서 ~'" })]);
  assert.strictEqual(res.byType.output_format_residue, 1);
});

t('G열 enum 위반 차단 / 3종 허용', () => {
  assert.strictEqual(checkContent([row({ G: '윈도우' })]).byType.g_enum, 1);
  for (const g of ['PC', '모바일', 'PC/모바일']) assert.ok(checkContent([row({ G: g })]).pass, g);
});

t('J열 화이트리스트 — 4종+빈값+DXBUG 허용, 그외 차단', () => {
  for (const j of ['', '추후 구현', '구현 우선순위 낮음', '기획 확인 필요', 'DXBUG-123', 'DXBUG-9']) {
    assert.ok(checkContent([row({ J: j })]).pass, 'allow: ' + j);
  }
  assert.strictEqual(checkContent([row({ J: '아무 메모' })]).byType.j_whitelist, 1);
  assert.strictEqual(checkContent([row({ J: 'DXBUG-abc' })]).byType.j_whitelist, 1, 'DXBUG 뒤 숫자 아니면 위반');
});

t('위반 리포트에 row index + tc_id 포함', () => {
  const res = checkContent([row({ A: '007', G: 'XBOX' })]);
  assert.strictEqual(res.violations[0].tc_id, '007');
  assert.strictEqual(res.violations[0].row, 0);
});

t('J는 trim 후 판정(공백만=빈값 허용)', () => {
  assert.ok(checkContent([row({ J: '   ' })]).pass);
});

// ── v2 규칙 (2026-07-12, A/B 주변감지 환류) ──
t('위임표현 + 무플래그 = 차단(delegation_unflagged)', () => {
  const res = checkContent([row({ F: '저장 정책이 스펙대로 처리되는지 확인' })]);
  assert.strictEqual(res.pass, false);
  assert.strictEqual(res.byType.delegation_unflagged, 1);
});

t('위임표현 + J=기획 확인 필요 = 경고만(통과)', () => {
  const res = checkContent([row({ F: '저장 정책이 스펙대로 처리되는지 확인', J: '기획 확인 필요' })]);
  assert.ok(res.pass, '플래그 있으면 차단 아님');
  assert.strictEqual(res.warnByType.delegation_flagged, 1);
});

t('위임표현 4종(스펙/규칙/정책/기준대로) 전부 감지', () => {
  for (const w of ['스펙대로', '규칙대로', '정책대로', '기준대로']) {
    const res = checkContent([row({ F: `동작이 ${w} 되는지 확인` })]);
    assert.strictEqual(res.byType.delegation_unflagged, 1, w);
  }
});

t("'정확히+동사' = 경고 등급(비차단)", () => {
  const res = checkContent([row({ F: '목록이 정확히 갱신되는지 확인' })]);
  assert.ok(res.pass, '경고는 차단 아님');
  assert.strictEqual(res.warnByType.exact_vague, 1);
});

t("'정확히 동일한 숫자'류(비동사)는 경고 아님", () => {
  const res = checkContent([row({ F: '두 번호가 정확히 동일한 숫자로 표시되는지 확인' })]);
  // '정확히 동일한'은 EXACT_VAGUE(동사 직결)에 안 걸림 — 구체 기준 동반 표현 허용
  assert.strictEqual(res.warnByType.exact_vague, undefined);
});

t('실물 주변감지 v3 tc_final — 통과 + 경고 9(위임6·정확히3) 실측 일치', () => {
  const p = path.resolve(__dirname, '..', 'fixtures', 'proximity_run', 'v3_tc_final.json');
  if (!fs.existsSync(p)) { console.log('    (skip)'); return; }
  const res = checkContent(JSON.parse(fs.readFileSync(p, 'utf8')).rows);
  assert.ok(res.pass, '전부 플래그돼 있어 차단 0이어야: ' + JSON.stringify(res.byType));
  assert.strictEqual(res.warnByType.delegation_flagged, 6);
  assert.strictEqual(res.warnByType.exact_vague, 3);
});

t('실물 주변감지 v2 baseline — 신규 규칙이 무플래그 위임 1건 검출(진양성)', () => {
  const p = path.resolve(__dirname, '..', 'fixtures', 'proximity_run', 'v2_baseline.json');
  if (!fs.existsSync(p)) { console.log('    (skip)'); return; }
  const res = checkContent(JSON.parse(fs.readFileSync(p, 'utf8')).rows);
  assert.strictEqual(res.byType.delegation_unflagged, 1, 'v2 결함 1건을 새 규칙이 잡아야');
});

// ── 실물 스냅샷 스모크 (자동_사냥 — v2 writer 산출, FINAL-4 통과했던 것) ──
t('실물 tc_snapshot.json 게이트 통과(회귀 근거)', () => {
  const p = '{PROJECT_ROOT}/team/specs/자동_사냥_기능/tc_snapshot.json';
  if (!fs.existsSync(p)) { console.log('    (skip — 파일 없음)'); return; }
  const snap = JSON.parse(fs.readFileSync(p, 'utf8'));
  const res = checkContent(snap.rows);
  console.log(`    실물 ${res.total}행 → ${res.pass ? 'PASS' : 'FAIL ' + JSON.stringify(res.byType)}`);
  assert.ok(res.pass, '실물 v2 산출이 content_gate를 통과해야(동등성): ' + JSON.stringify(res.violations.slice(0, 3)));
});

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
