#!/usr/bin/env node
/**
 * ssot_drift_check.js — tc-team SSoT 수치/조건 드리프트 체크
 *
 * 목적: 여러 파일에 복제·동기화되어야 하는 수치/조건/계약이 서로 어긋나지 않았는지 검사.
 *   (예: 리스크 비율 60/49/30 4파일, 옵션 1-A 예외 6종, EVAL-16 5조건, J열 화이트리스트,
 *    직변환 게이트 배선 — 전부 과거 수동 적발됐던 드리프트 부류)
 *
 * ♻ 2026-07-28 재작성: 감시 대상을 구 tc-team-v2 경로에서 현행 tc-team SSoT로 전환.
 *   - 규칙 md = <CLAUDE_HOME>/skills/tc-team/rules/ (07-28 이사 정본)
 *   - 에이전트 = tc-team-* 3종
 *   - S4 런타임 원장 = tc-team/docs/eval_digest.md (신선도 검사 포함)
 *   v2 전용 검사(팀장 md·transition.sh·step_result 계약 등)는 v2 은퇴와 함께 삭제.
 *
 * 실행 시점: doc_reality_lint.js와 동일 (md 수정 세션 마감 + 주 1회).
 * 수정 권한 없음 — 발견·보고만.
 *
 * 사용법: node ssot_drift_check.js [--quiet]
 * 종료코드: 0=정합 / 1=드리프트 발견 / 2=설치 경로 못 찾음
 * 이력: <PROJECT_ROOT>/team/lint_history.log 에 1줄 append
 *
 * 경로 해석(2026-07-29 이식성 작업 — 배포본에서도 돌도록):
 *   PROJECT_ROOT = env TCTEAM_PROJECT_ROOT | 이 파일 기준 ../.. (scripts/util/ → 프로젝트 루트)
 *   CLAUDE_HOME  = env CLAUDE_CONFIG_DIR   | ~/.claude
 *   스킬을 표준 위치 밖에 뒀다면 위 환경변수로 지정한다.
 *
 * 유지보수: 새 드리프트 유형 발견 시 CHECKS에 추가 (회귀 = 검사 패턴 축적).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const norm = (p) => p.replace(/\\/g, '/');
const PROJECT_ROOT = norm(process.env.TCTEAM_PROJECT_ROOT || path.resolve(__dirname, '..', '..'));
const CLAUDE_HOME = norm(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'));
const SKILL_DIR = norm(process.env.TCTEAM_SKILL_DIR || path.join(CLAUDE_HOME, 'skills', 'tc-team'));

const A = `${CLAUDE_HOME}/agents`;
const R = `${SKILL_DIR}/rules`;
const T = `${PROJECT_ROOT}/tc-team`;

// 설치 경로를 못 찾으면 없는 파일을 드리프트로 오보하지 않고 즉시 안내하고 빠진다.
for (const [label, dir] of [['규칙 서랍(rules)', R], ['tc-team 엔진', T]]) {
  if (!fs.existsSync(dir)) {
    process.stdout.write(
      `⚠ ssot_drift_check: ${label} 경로를 찾지 못했습니다 — ${dir}\n` +
      `  환경변수로 지정하세요: TCTEAM_PROJECT_ROOT / CLAUDE_CONFIG_DIR / TCTEAM_SKILL_DIR\n`);
    process.exit(2);
  }
}

const FILES = {
  분석:        `${R}/tc-분석.md`,
  설계:        `${R}/tc-설계.md`,
  검수:        `${R}/tc-설계검수.md`,
  생성:        `${R}/tc-생성.md`,
  리뷰:        `${R}/tc-리뷰.md`,
  학습:        `${R}/tc-학습.md`,
  대조:        `${R}/tc-대조.md`,
  라벨링:      `${R}/라벨링_기준.md`,
  완료처리:    `${R}/완료처리.md`,
  skill:       `${SKILL_DIR}/SKILL.md`,
  designer:    `${A}/tc-team-designer.md`,
  검수에이전트: `${A}/tc-team-설계검수.md`,
  대조에이전트: `${A}/tc-team-대조.md`,
  digest:      `${T}/docs/eval_digest.md`,
};

const text = {};
const missing = [];
for (const [k, p] of Object.entries(FILES)) {
  try { text[k] = fs.readFileSync(p, 'utf8'); }
  catch { missing.push(k); text[k] = ''; }
}

const findings = [];
function need(fileKey, what, test) {
  if (!test) findings.push({ file: fileKey, type: '누락', what });
}
function forbid(fileKey, re, what) {
  const m = text[fileKey].match(re);
  if (m) findings.push({ file: fileKey, type: '금지패턴', what: `${what} — 발견: "${m[0]}"` });
}
function has(fileKey, s) { return text[fileKey].includes(s); }
function hasRe(fileKey, re) { return re.test(text[fileKey]); }
function windowHas(fileKey, anchor, keyword, span = 3000) {
  const t = text[fileKey];
  const i = t.indexOf(anchor);
  if (i < 0) return false;
  return t.slice(i, i + span).includes(keyword);
}

// ── CHECKS ──────────────────────────────────────────────────────────────────

// 1) 리스크 비율 트리오 60/49/30 — 4파일 동기
for (const k of ['설계', '검수', '리뷰', '생성']) {
  for (const v of ['60%', '49%', '30%']) {
    need(k, `리스크 비율 ${v} (4파일 SSoT)`, has(k, v));
  }
}

// 2) 옵션 1-A 미적용 예외 6종 — 설계/생성/리뷰 (v2의 tc-수정.md는 S5 기계화로 폐지)
const OPT1A_ANCHORS = { 설계: '옵션 1-A 미적용 예외', 생성: '옵션 1-A 미적용 예외', 리뷰: '미적용 예외 6종' };
const OPT1A_KEYS = ['기본기능', 'GlobalDefine', '상태 전이', '임계값', '복합', 'fixture'];
for (const [k, anchor] of Object.entries(OPT1A_ANCHORS)) {
  for (const kw of OPT1A_KEYS) {
    need(k, `옵션 1-A 예외 6종 중 "${kw}" (anchor: ${anchor})`, windowHas(k, anchor, kw));
  }
}

// 3) EVAL-16 / V-18 = 5조건
need('리뷰', 'EVAL-16 5가지 충족 문구', has('리뷰', '5가지 모두 충족'));
need('생성', 'V-18 5가지 충족 문구', has('생성', '5가지 모두 충족'));
forbid('리뷰', /4가지 모두 충족/, 'EVAL-16이 4조건으로 회귀');
forbid('생성', /4가지 모두 충족/, 'V-18이 4조건으로 회귀');

// 4) J열 화이트리스트 동기 — 생성/리뷰
for (const k of ['생성', '리뷰']) {
  for (const v of ['추후 구현', '구현 우선순위 낮음', '기획 확인 필요', 'DXBUG']) {
    need(k, `J열 화이트리스트 "${v}"`, has(k, v));
  }
}

// 5) 완료처리 — FINAL-1~6 편성 + finalize.sh 단일 실행기 배선 (07-28 실행기 단일화)
need('완료처리', 'FINAL-1~6 표기', has('완료처리', 'FINAL-1~6'));
need('완료처리', 'finalize.sh 실행기 참조', has('완료처리', 'finalize.sh'));
need('skill', 'S7의 finalize.sh 위임', has('skill', 'finalize.sh'));
{
  // 실행기 실물 존재 (md가 가리키는 기계가 실재하는지)
  for (const p of [`${T}/scripts/finalize.sh`, `${T}/scripts/run_pipeline_full.sh`, `${T}/scripts/run_pipeline_s1only.sh`]) {
    if (!fs.existsSync(p)) findings.push({ file: '완료처리', type: '파일없음', what: `실행기 실물 부재: ${p}` });
  }
}

// 6) 글로벌 Step 번호 — 분석 1~7 / 설계 8~13 + designer 포인터
need('분석', '분석 Step 1~7', has('분석', 'Step 1~7'));
need('설계', '설계 Step 8~13', has('설계', 'Step 8~13'));
need('designer', '분석 Step 1~7 포인터', has('designer', 'Step 1~7'));
need('designer', '설계 Step 8~13 포인터', has('designer', 'Step 8~13'));
for (const k of ['designer', '분석', '설계']) {
  forbid(k, /Step 1~5|Step 6~11|설계 Step [67]\b/, '옛 글로벌 Step 번호 잔재');
}

// 7) 직변환 게이트 배선 (설계 11.5 shift-left + 검수 C-14 이중 그물)
need('설계', 'Step 11.5 직변환 사전 게이트', has('설계', '11.5'));
need('설계', '설계 게이트의 direct_convert 호출', has('설계', 'direct_convert.js'));
need('설계', '설계 게이트 실패 계약 (design_gate_blocked)', has('설계', 'design_gate_blocked'));
need('검수', 'C-14 직변환 기계 게이트', has('검수', 'C-14'));
need('검수', 'C-14의 direct_convert 호출', has('검수', 'direct_convert.js'));
need('검수', 'C-14 blocker 시 needs_fix 강제', has('검수', 'needs_fix=true 강제'));
need('검수', 'C-05 분모 완전성 교차 확인 (P-19 연동)', has('검수', '분모 완전성'));

// 8) 생성 — 직변환·분할 생성 계약 (Step A0 / L4-F8·F9)
need('생성', 'Step A0 직변환 단계', has('생성', 'Step A0'));
need('생성', 'F열/골격 열 그룹 분기', has('생성', '골격 열'));
need('생성', 'Step A ② tc_f_map 분할 생성 규칙 (L4-F9)', has('생성', 'L4-F9'));
need('생성', 'Step A ② 기본기능 1차 문장화 선반영 (L4-F8)', has('생성', 'L4-F8'));
need('생성', '분할 생성 파일명 계약 (tc_f_map_part1)', has('생성', 'tc_f_map_part1'));

// 9) 학습 — 설계 랫칫 패턴 보존
for (const p of ['P-18', 'P-19', 'P-20']) {
  need('학습', `설계 랫칫 패턴 ${p} (Boss_0011 환류)`, has('학습', p));
}

// 10) 면제 형식 단일화 — [근거부족—기획질의] 토큰 동기 (2026-07-28, 7차 회고 유형 D)
//     선언=설계 §3-1 / 집행=생성 V-10·V-16, 리뷰 EVAL-02, 검수 C-11 #8, digest, validate_tc_rows.js EXEMPT_RE
for (const k of ['설계', '생성', '리뷰', '검수', 'digest']) {
  need(k, '면제 토큰 [근거부족—기획질의] (단일 형식 SSoT)', has(k, '근거부족—기획질의'));
}
{
  let vtr = '';
  try { vtr = fs.readFileSync(path.join(__dirname, 'validate_tc_rows.js'), 'utf8'); } catch {}
  if (vtr && !vtr.includes('근거부족')) {
    findings.push({ file: '생성', type: '드리프트', what: 'validate_tc_rows.js에 면제 토큰(EXEMPT_RE) 없음 — md는 면제를 약속하는데 기계가 하드 차단 (원자 배포 위반)' });
  }
}

// 11) 논리 부정문 복제 금지 — 설계(도출)·생성(작성)·리뷰(EVAL-07)·digest 4곳 동기 (2026-07-28)
for (const k of ['설계', '생성', '리뷰', 'digest']) {
  need(k, '논리 부정문 복제 금지 문구', has(k, '논리 부정문') || has(k, '논리적 부정문'));
}

// 12) C-15 연계 기능 승격 게이트 (2026-07-28, 7차 회고 유형 C)
need('검수', 'C-15 연계 기능 승격 게이트', has('검수', 'C-15'));
need('검수', '검수 범위 C-01 ~ C-15 표기', hasRe('검수', /C-01\s*~\s*C-15/));
need('검수에이전트', '검수 범위 C-01~C-15 표기', has('검수에이전트', 'C-01~C-15'));
forbid('검수에이전트', /C-01~C-14/, '검수 범위가 C-14로 회귀 (C-15 승격 게이트 누락)');
need('설계', '연계 기능 TC 승격 게이트 (default-deny)', has('설계', '연계 기능 TC 승격 게이트'));

// 13) 기계 게이트 실재·배선 감시 (2026-07-28 — "문서는 기계 검출이라 주장하는데 배선 없음" 재발 방지)
//     근본 사고: tc-리뷰.md가 EVAL-07을 "검출=기계"로 명시했으나 구현체(V-07d)는 구 v2에만 있고
//     tc-team 체인은 호출한 적이 없어, 완전 동일 중복 3쌍이 라이브 시트까지 도달했다.
{
  const GATES = [
    { file: `${T}/lib/dup_gate.js`, name: 'dup_gate', doc: '리뷰' },
    { file: `${T}/lib/origin_gate.js`, name: 'origin_gate', doc: '분석' },
  ];
  let chain = '', wf = '';
  try { chain = fs.readFileSync(`${T}/scripts/run_pipeline_full.sh`, 'utf8'); } catch {}
  try { wf = fs.readFileSync(`${T}/workflows/tcteam-s4-review.js`, 'utf8'); } catch {}
  for (const g of GATES) {
    if (!fs.existsSync(g.file)) { findings.push({ file: g.doc, type: '파일없음', what: `기계 게이트 실물 부재: ${g.file}` }); continue; }
    if (chain && !chain.includes(`${g.name}.js`)) {
      findings.push({ file: g.doc, type: '드리프트', what: `${g.name}.js가 run_pipeline_full.sh에 미배선 — 규칙서는 기계 검출을 약속하는데 체인이 호출하지 않음(구 V-07d 사고 형상)` });
    }
    need(g.doc, `${g.name} 기계 배선 명시`, has(g.doc, `${g.name}.js`));
  }
  // 리포트 소비자 존재 확인 — 산출물만 만들고 아무도 안 읽으면 데드 산출물
  if (wf) {
    if (!wf.includes('dup_report.json')) findings.push({ file: '리뷰', type: '드리프트', what: 'S4 워크플로우가 dup_report.json을 읽지 않음 — 중복 후보가 데드 산출물' });
    if (!wf.includes('origin_report.json')) findings.push({ file: '분석', type: '드리프트', what: 'S4 워크플로우가 origin_report.json을 읽지 않음 — 원문대조 후보가 데드 산출물' });
  }
}

// 14) eval_digest — S4 런타임 원장 정합 (07-28 적대리뷰 발견: 실질 집행은 digest)
need('digest', 'digest가 EVAL 발췌를 포함', has('digest', 'EVAL'));
forbid('digest', /tc-team-v2[\\/]/, 'digest 출처가 구 v2 경로를 가리킴 (rules 서랍으로 갱신 필요)');
{
  // 신선도: 원본 규칙(리뷰/생성/설계)이 digest보다 새로우면 재생성 필요
  try {
    const dm = fs.statSync(FILES.digest).mtimeMs;
    for (const k of ['리뷰', '생성', '설계']) {
      const sm = fs.statSync(FILES[k]).mtimeMs;
      if (sm > dm) findings.push({ file: 'digest', type: '드리프트', what: `${k}.md가 eval_digest.md보다 새로움 — digest 재생성 필요 (S4는 digest를 집행)` });
    }
  } catch {}
}

// ── 출력 + 이력 ─────────────────────────────────────────────────────────────
const quiet = process.argv.includes('--quiet');
const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
const histLine = `[${ts}] ssot_drift_check | files=${Object.keys(FILES).length} findings=${findings.length}${missing.length ? ' missingFiles=' + missing.join(',') : ''}\n`;
try { fs.appendFileSync(`${PROJECT_ROOT}/team/lint_history.log`, histLine); } catch {}

if (missing.length) {
  for (const k of missing) findings.push({ file: k, type: '파일없음', what: FILES[k] });
}

if (findings.length === 0) {
  if (!quiet) process.stdout.write(`✅ ssot_drift_check: 드리프트 0건 (파일 ${Object.keys(FILES).length}개, 검사 15종 — tc-team 정본)\n`);
  process.exit(0);
}

process.stdout.write(`❌ ssot_drift_check: 드리프트 ${findings.length}건\n`);
for (const f of findings) {
  process.stdout.write(`  - [${f.file}] (${f.type}) ${f.what}\n`);
}
process.exit(1);
