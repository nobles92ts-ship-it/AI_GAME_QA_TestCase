#!/usr/bin/env node
/**
 * review_precheck.js — 리뷰 기계 EVAL 사전 패스 (Phase1 ②③)
 *
 * 목적: 리뷰1(STEP 5)·리뷰2(STEP 6)의 결정적(기계) EVAL을 LLM 대신 판정해
 *   리뷰 에이전트는 판단형 EVAL + 검출행 분류에만 집중하게 한다.
 *   룰은 validate_tc_rows.js(단일 SSoT)를 require로 공유 — 별도 룰 정의 금지 (D/A-7 기각 사유).
 *
 * EVAL 매핑 (tc-리뷰.md 기준):
 *   round 1 (1차 구조 담당 기계부): EVAL-02(분포·배분표·리스크), 04(G enum), 05(ID),
 *     06(그룹 연속), 08(dedup 표기), 16(기본기능 기계부), 19(분류 계층 ①②③)
 *   round 2 (2차 품질 담당 기계부): EVAL-14(J 화이트리스트), 15("또는" 추출만),
 *     17(J↔H/I — expectedHI 공유), 18a(설계 태그 정규식), 03 보조(추상표현·Output Format)
 *     + 회귀 EVAL-04/05/06 (--added-source의 added_count > 0일 때)
 *
 * 공통 안전 원칙: 판정불가 → silent pass 금지, llm_fallback으로 명시 출력.
 *   스크립트 자체 크래시(rc≠0) 시 팀장은 LLM 전수 판정(현행)으로 폴백 — 파이프라인 비차단.
 *
 * 사용법:
 *   node review_precheck.js --round 1 --input <tc_snapshot.json> --design <tc_design.md> [--out <경로>]
 *   node review_precheck.js --round 2 --input <tc_after_fix1.json> --design <tc_design.md> \
 *        --added-source <step6_result.json> [--out <경로>]
 *   ※ --added-source는 파일 경로 인자 — 파일명 하드코딩 금지 (L2-I5: STEP 5 통합 시 교체 가능해야 함)
 *
 * 종료코드: 0=판정 완료(위반 유무 무관 — 결과는 JSON), 1=크래시/입력 불능
 */

const fs = require('fs');
const path = require('path');
const {
  validateFull, adaptInput, fillDownRecords,
} = require('./validate_tc_rows.js');

// validateFull rule → EVAL 번호 매핑
const RULE_TO_EVAL = {
  'V-03': 'EVAL-04',  // 플랫폼 enum
  'V-02': 'EVAL-05',  // ID 연속·중복
  'V-06': 'EVAL-06',  // 그룹 연속 배치
  'V-23': 'EVAL-19',  // 분류 계층 (동사/진입동작)
  'V-10': 'EVAL-02',  // 분포·배분표
  'V-16r': 'EVAL-02', // 리스크 비율
  'V-16': 'EVAL-16',  // 기본기능
  'V-19': 'EVAL-14',  // J 화이트리스트
  'V-20': 'EVAL-17',  // J↔H/I 정합
  'V-22': 'EVAL-18a', // 설계 태그
  'V-21': 'EVAL-15',  // "또는" 추출
  'V-07d': 'EVAL-07', // PC/모바일 분리쌍 (검출=기계 / 정당성=LLM, v8 사고)
  'V-05': 'EVAL-03',  // 추상 표현/개행/번호 다단계 (보조)
  'V-14': 'EVAL-03',  // Output Format 잔류 (보조)
  'V-15': 'EVAL-09',  // 복합 기대결과 추출 (1NF — 보조)
  'V-12': 'EVAL-02',  // GlobalDefine 키 후보
  'CONTRACT': 'CONTRACT',
};

const ROUND_EVALS = {
  1: ['EVAL-02', 'EVAL-04', 'EVAL-05', 'EVAL-06', 'EVAL-08', 'EVAL-16', 'EVAL-19'],
  2: ['EVAL-14', 'EVAL-15', 'EVAL-17', 'EVAL-18a', 'EVAL-03', 'EVAL-07', 'EVAL-09',
      'EVAL-04', 'EVAL-05', 'EVAL-06'], // 04/05/06은 회귀 모드, 07은 분리쌍 기계부
};

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}

function main() {
  const round = parseInt(arg('--round', '1'), 10);
  const input = arg('--input', null);
  const designPath = arg('--design', null);
  const addedSource = arg('--added-source', null);
  const outPath = arg('--out', null);

  if (!input || ![1, 2].includes(round)) {
    console.error('사용법: node review_precheck.js --round 1|2 --input <json> [--design <md>] [--added-source <json>] [--out <경로>]');
    process.exit(1);
  }

  const full = validateFull(input, { designPath });
  if (full.fatal) {
    console.error('치명: 입력 적재 불능 — ' + full.fatal + ' → 팀장은 LLM 전수 판정으로 폴백');
    process.exit(1);
  }

  // EVAL-08 (dedup 표기 — 시트 덤프 전용): 동일 그룹 연속 중복 표기 검출
  const eval08 = { violations: [], note: null };
  if (round === 1) {
    if (full.caps.source !== 'snapshot') {
      eval08.note = 'tc_data 입력 — 시트 표기 검사 불가 (llm_fallback)';
    } else {
      const ad = adaptInput(input);
      const recs = fillDownRecords(ad.records).records;
      for (let i = 1; i < recs.length; i++) {
        const r = recs[i], p = recs[i - 1];
        if (r.rawD && r.B === p.B && r.C === p.C && r.D === p.D) {
          eval08.violations.push({ sev: 'MEDIUM', rule: 'V-07', row: r.sheetRow, msg: `행 ${r.sheetRow} 동일 그룹 연속 행에 소분류 중복 표기 "${r.rawD}"` });
        }
      }
    }
  }

  // 회귀 모드 (round 2): added-source의 added_count 확인
  let regression = null;
  if (round === 2) {
    if (!addedSource) {
      regression = { mode: 'llm_fallback', note: '--added-source 미제공 — 회귀(EVAL-04/05/06) 범위 판정불가, LLM 폴백 (L2-I5)' };
    } else {
      try {
        const j = JSON.parse(fs.readFileSync(addedSource, 'utf8'));
        const added = j.added_count ?? null;
        if (added === null) regression = { mode: 'llm_fallback', note: `added_count 필드 없음(${path.basename(addedSource)}) — LLM 폴백` };
        else if (added === 0) regression = { mode: 'skip', note: 'added_count=0 — 회귀 검사 불필요' };
        else regression = { mode: 'full_sheet', added_count: added, note: `added_count=${added} — 행 단위 추가 목록이 없어 전체 시트 슈퍼셋으로 회귀 판정 (보수적)` };
      } catch (e) {
        regression = { mode: 'llm_fallback', note: `added-source 읽기 실패(${e.message}) — LLM 폴백` };
      }
    }
  }

  // rule → EVAL 그룹핑 + 라운드 필터
  const wanted = new Set(ROUND_EVALS[round]);
  const evals = {};
  const ensure = (id) => (evals[id] = evals[id] || { status: 'PASS', violations: [], llm: [] });
  for (const id of wanted) ensure(id);

  for (const v of full.violations) {
    const id = RULE_TO_EVAL[v.rule] || 'ETC';
    if (!wanted.has(id) && id !== 'CONTRACT') continue;
    // round 2 회귀 skip 처리
    if (round === 2 && ['EVAL-04', 'EVAL-05', 'EVAL-06'].includes(id) && regression && regression.mode === 'skip') continue;
    ensure(id).violations.push(v);
    if (v.sev === 'CRITICAL' || v.sev === 'HIGH') ensure(id).status = 'FAIL';
    else if (ensure(id).status === 'PASS') ensure(id).status = 'WARN';
  }
  for (const f of full.llmFlags) {
    const id = RULE_TO_EVAL[f.rule] || 'ETC';
    if (!wanted.has(id)) continue;
    ensure(id).llm.push(f);
    if (ensure(id).status === 'PASS') ensure(id).status = 'LLM';
  }
  if (round === 1) {
    const e8 = ensure('EVAL-08');
    e8.violations.push(...eval08.violations);
    if (eval08.violations.length) e8.status = 'WARN';
    if (eval08.note) { e8.status = 'LLM'; e8.llm.push({ rule: 'V-07', reason: eval08.note }); }
  }

  const blocking = full.violations.filter(v => (v.sev === 'CRITICAL' || v.sev === 'HIGH') &&
    (wanted.has(RULE_TO_EVAL[v.rule] || 'ETC') || v.rule === 'CONTRACT')).length;

  const report = {
    round,
    input: path.resolve(input),
    design: designPath ? path.resolve(designPath) : null,
    caps: full.caps,
    stats: full.stats,
    regression,
    evals,
    notes: full.notes,
    llm_only_evals: round === 1
      ? ['EVAL-01(커버리지)', 'EVAL-03 예외6종', 'EVAL-10(섹션 대조)', 'EVAL-12(상태전이)', 'EVAL-16 ⑤인용 정확성', 'EVAL-19 ④셋업 일치']
      : ['EVAL-03 일반', 'EVAL-07(중복)', 'EVAL-09(판단부)', 'EVAL-11(취소선)', 'EVAL-13(결정테이블)', 'EVAL-15 4분류', 'EVAL-18(b) 사람언어'],
    summary: { blocking, llmFlagCount: full.llmFlags.length, generatedAt: new Date().toISOString() },
  };

  const json = JSON.stringify(report, null, 1);
  if (outPath) {
    fs.writeFileSync(outPath, json, 'utf8');
    console.log(`precheck round${round}: blocking=${blocking} llm=${full.llmFlags.length} → ${outPath}`);
  } else {
    console.log(json);
  }
  process.exit(0); // 판정 완료 — 위반 유무는 JSON으로 전달 (rc≠0은 크래시 전용)
}

try {
  main();
} catch (e) {
  console.error('precheck 크래시: ' + (e && e.message) + ' → 팀장은 LLM 전수 판정으로 폴백 (파이프라인 비차단)');
  process.exit(1);
}
