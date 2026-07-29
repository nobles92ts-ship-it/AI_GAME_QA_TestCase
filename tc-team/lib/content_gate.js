#!/usr/bin/env node
/**
 * content_gate.js — tc-v3 S5: 로컬 콘텐츠 차단 게이트 (FINAL-4 지표 중 업로드 전 판정 가능분).
 *
 * v2 FINAL-4(run_pipeline.sh:437-450)의 정확 복제 — 단 역할 분리(계획 §4 S5/S6):
 *   여기(S5·로컬): 추상표현(F) · Output Format 잔류(임의 셀) · G열 enum · J열 화이트리스트
 *   S6(시트 평가): #ERROR!  — 수식 평가 후에만 발생하므로 업로드 후 재덤프에서 검사 (여기 제외)
 *
 * v2 대비 승격: v2는 완료처리 단계 게이트 → v3는 업로드 前 차단(미검증 업로드 원천 차단, tc_final.ok 발급 전).
 * 입력: tc_snapshot/tc_final 동형 { rows:[[A..J], ...] } — F=idx5, G=idx6, J=idx9.
 *
 * CLI: content_gate.js <snapshot.json>   → stdout JSON, exit 0=PASS / 7=위반
 */
'use strict';
const fs = require('fs');

const ABSTRACT = /올바르게|(?<!비)정상적으로|적절히|제대로|문제없이/;   // run_pipeline.sh:442 정확 승계
const G_ENUM = ['PC', '모바일', 'PC/모바일'];                            // tc-생성.md:60 / :444
const J_WHITELIST = ['', '추후 구현', '구현 우선순위 낮음', '기획 확인 필요']; // :445
const DXBUG = /^DXBUG-\d+/;
// ── v2 규칙 (2026-07-12, A/B 주변감지 환류) ──
// 위임표현: 미확정 스펙을 외부 문서에 위임 — J='기획 확인 필요' 플래그 없으면 차단, 있으면 경고(의도적 잔존 허용)
const DELEGATION = /스펙대로|규칙대로|정책대로|기준대로/;
const J_PLAN_FLAG = '기획 확인 필요';
// '정확히+동사': 기준을 풀어쓰지 않은 유사 추상 — 경고 등급(비차단, 실측 후 승격 검토)
const EXACT_VAGUE = /정확히\s*(갱신|제거|처리|표시|반영|동작)/;
// ── 선행 특수문자 (2026-07-28, 세공 TC019 환류) ──
// Google Sheets는 셀 첫 글자 '를 리터럴 지시자로, = + @를 수식 시작으로 해석해 저장값이 원본과 달라진다.
// 그대로 올리면 S6 Post-Write read-back 대조가 반드시 CRITICAL 실패(exit 5) → 여기서 선차단해 재작업 방지.
const LEADING_SPECIAL = /^\s*['=+@]/;
const TEXT_COLS = [1, 2, 3, 4, 5, 6, 9]; // B~G, J (A=TC ID·H/I=결과값 제외)

function checkContent(rows) {
  const violations = [];
  const warnings = [];
  rows.forEach((r, i) => {
    const tcId = r[0];
    const F = r[5] || '', G = r[6], J = (r[9] || '').trim();
    if (ABSTRACT.test(F)) violations.push({ row: i, tc_id: tcId, type: 'abstract', cell: 'F', value: F });
    if (r.some(v => typeof v === 'string' && v.includes('Output Format:')))
      violations.push({ row: i, tc_id: tcId, type: 'output_format_residue', cell: '*' });
    if (!G_ENUM.includes(G)) violations.push({ row: i, tc_id: tcId, type: 'g_enum', cell: 'G', value: G });
    if (!(J_WHITELIST.includes(J) || DXBUG.test(J))) violations.push({ row: i, tc_id: tcId, type: 'j_whitelist', cell: 'J', value: J });
    if (DELEGATION.test(F)) {
      if (J === J_PLAN_FLAG) warnings.push({ row: i, tc_id: tcId, type: 'delegation_flagged', cell: 'F', value: F });
      else violations.push({ row: i, tc_id: tcId, type: 'delegation_unflagged', cell: 'F', value: F });
    }
    if (EXACT_VAGUE.test(F)) warnings.push({ row: i, tc_id: tcId, type: 'exact_vague', cell: 'F', value: F });
    for (const c of TEXT_COLS) {
      const v = r[c] == null ? '' : String(r[c]);
      if (LEADING_SPECIAL.test(v))
        violations.push({ row: i, tc_id: tcId, type: 'leading_special', cell: String.fromCharCode(65 + c), value: v });
    }
  });
  const byType = {};
  for (const v of violations) byType[v.type] = (byType[v.type] || 0) + 1;
  const warnByType = {};
  for (const w of warnings) warnByType[w.type] = (warnByType[w.type] || 0) + 1;
  return { pass: violations.length === 0, total: rows.length, violations, byType, warnings, warnByType };
}

module.exports = { checkContent, ABSTRACT, G_ENUM, J_WHITELIST, DELEGATION, EXACT_VAGUE };

// ── CLI ──
if (require.main === module) {
  const p = process.argv[2];
  if (!p) { process.stderr.write('사용: content_gate.js <snapshot.json>\n'); process.exit(1); }
  let snap;
  try { snap = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { process.stderr.write('[content_gate] 파싱 실패: ' + e.message + '\n'); process.exit(1); }
  const rows = Array.isArray(snap) ? snap : snap.rows;
  const res = checkContent(rows);
  process.stdout.write(JSON.stringify({ ok: res.pass, total: res.total, violations: res.violations.length, byType: res.byType, warnings: res.warnings.length, warnByType: res.warnByType, detail: res.violations.slice(0, 30) }) + '\n');
  process.exit(res.pass ? 0 : 7);
}
