#!/usr/bin/env node
/**
 * chain_helpers.js — run_pipeline_full.sh 전용 결정론 헬퍼 (2026-07-28)
 *
 * 풀체인(S2~S7)이 쓰는 순수 유틸 모음. 파이프라인 lib/와 분리 이유: 이것들은
 * "체인 오케스트레이션" 소유(추출·검증·조립·대조)지 TC 데이터 가공이 아니다.
 *
 * 서브커맨드:
 *   extract-s3-rules <wf_dir>                    S3 문장화 규칙을 tcteam-s3-fmap.js에서 추출 → stdout
 *   extract-s4-lenses <wf_dir> <workdir>         S4 렌즈 3종을 tcteam-s4-review.js에서 추출 → stdout JSON
 *   ranges <skeleton.json> <out.json>            25행 청크 범위 계산 (SKILL.md S3-② 동일)
 *   validate-chunk <skeleton> <chunk> <s> <e>    fmap 청크 검증 (개수·idx범위·d echo) exit 0/1
 *   assemble-fmap <workdir>                      fmap_chunk_*.json → tc_f_map.json (flat, 전체 연속 검증)
 *   validate-json <file> <kind>                  findings|fixplan|coverage|exclusions|labels 구조 검증
 *   readback-diff <final.json> <dump.json>       S6 read-back: A~G+J 0-diff + #ERROR 검사 exit 0/1
 *   seal-coverage <workdir>                      봉합 후 coverage.json에 신규 tc_id 결정론 병합
 *   final-report <spec> <workdir> <feature>      final_report.txt 작성 (탭·행수·단계시간·FINAL-6)
 *
 * ⚠ 추출(extract-*)은 워크플로우 파일이 단일 소스(SSoT)가 되게 하는 장치다 —
 *   워크플로우의 규칙 텍스트를 고치면 데스크톱(Workflow 팬아웃)과 체인이 같이 바뀐다.
 *   추출 실패는 조용히 폴백하지 않고 즉사한다(fail-fast — 구조 변경 감지).
 */
'use strict';
const fs = require('fs');
const path = require('path');

function die(msg) { console.error('[chain_helpers] ' + msg); process.exit(1); }
function readJ(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { die('JSON 파싱 실패 ' + p + ': ' + e.message); }
}

// 템플릿 리터럴 본문 추출: 시작 마커 뒤 첫 백틱부터, 이스케이프(\`) 아닌 첫 백틱까지
function extractTemplate(src, marker) {
  const mi = src.indexOf(marker);
  if (mi < 0) die('마커 없음: ' + marker + ' — 워크플로우 구조 변경? 추출기 갱신 필요');
  const start = src.indexOf('`', mi);
  if (start < 0) die('백틱 시작 없음: ' + marker);
  let i = start + 1;
  while (i < src.length) {
    if (src[i] === '`' && src[i - 1] !== '\\') break;
    i++;
  }
  if (i >= src.length) die('백틱 종료 없음: ' + marker);
  return src.slice(start + 1, i).replace(/\\`/g, '`');
}

const [cmd, ...a] = process.argv.slice(2);

if (cmd === 'extract-s3-rules') {
  const src = fs.readFileSync(path.join(a[0], 'tcteam-s3-fmap.js'), 'utf8');
  process.stdout.write(extractTemplate(src, 'const RULES ='));

} else if (cmd === 'extract-s4-lenses') {
  const src = fs.readFileSync(path.join(a[0], 'tcteam-s4-review.js'), 'utf8');
  const W = a[1].replace(/\\/g, '/');
  const out = [];
  const re = /key:\s*'(\w+)',\s*focus:/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const focus = extractTemplate(src, m[0]).replace(/\$\{W\}/g, W);
    out.push({ key: m[1], focus });
  }
  if (out.length !== 3) die('렌즈 3종 기대, ' + out.length + '종 추출 — 워크플로우 구조 변경?');
  process.stdout.write(JSON.stringify(out));

} else if (cmd === 'ranges') {
  const s = readJ(a[0]);
  const n = s.rows.length;
  const R = [];
  for (let i = 0; i < n; i += 25) R.push([i, Math.min(i + 25, n)]);
  fs.writeFileSync(a[1], JSON.stringify({ n, ranges: R }));
  console.log(JSON.stringify({ n, chunks: R.length }));

} else if (cmd === 'validate-chunk') {
  const skel = readJ(a[0]);
  const [s, e] = [parseInt(a[2], 10), parseInt(a[3], 10)];
  let ch;
  try { ch = JSON.parse(fs.readFileSync(a[1], 'utf8')); }
  catch (err) { console.log('청크 파일 없음/파싱 실패: ' + err.message); process.exit(1); }
  const rows = ch && ch.rows;
  if (!Array.isArray(rows)) { console.log('rows 배열 아님'); process.exit(1); }
  if (rows.length !== e - s) { console.log(`개수 불일치: ${rows.length} ≠ ${e - s}`); process.exit(1); }
  const skelByIdx = new Map(skel.rows.map(r => [r.idx, r]));
  for (const r of rows) {
    if (typeof r.idx !== 'number' || r.idx < s || r.idx >= e) { console.log('idx 범위 밖: ' + r.idx); process.exit(1); }
    const sk = skelByIdx.get(r.idx);
    if (!sk) { console.log('skeleton에 없는 idx: ' + r.idx); process.exit(1); }
    if (r.d !== sk.d) { console.log(`d echo 불일치 idx=${r.idx}`); process.exit(1); }
    if (typeof r.f !== 'string' || !r.f.trim()) { console.log('f 비어있음 idx=' + r.idx); process.exit(1); }
  }
  console.log('ok');

} else if (cmd === 'assemble-fmap') {
  const W = a[0];
  const skel = readJ(path.join(W, 'tc_skeleton.json'));
  const n = skel.rows.length;
  const all = [];
  for (const f of fs.readdirSync(W)) {
    if (/^fmap_chunk_\d+\.json$/.test(f)) {
      const ch = readJ(path.join(W, f));
      all.push(...(ch.rows || []));
    }
  }
  all.sort((x, y) => x.idx - y.idx);
  if (all.length !== n) die(`fmap 총 개수 ${all.length} ≠ 골격 ${n}`);
  for (let i = 0; i < n; i++) if (all[i].idx !== i) die(`idx 연속성 깨짐: 위치 ${i}에 idx ${all[i].idx}`);
  fs.writeFileSync(path.join(W, 'tc_f_map.json'), JSON.stringify(all, null, 1));
  console.log(JSON.stringify({ ok: true, count: n }));

} else if (cmd === 'validate-json') {
  const j = readJ(a[0]);
  const kind = a[1];
  const bad = (m) => { console.log(m); process.exit(1); };
  if (kind === 'findings') {
    if (!Array.isArray(j.findings)) bad('findings 배열 아님');
    for (const f of j.findings) if (!f.tc_id || !f.severity || !f.issue) bad('finding 필수키 누락');
  } else if (kind === 'fixplan') {
    if (!Array.isArray(j.patches)) bad('patches 배열 아님');
    for (const p of j.patches) {
      if (!['edit_cell', 'add_row', 'delete_row'].includes(p.op)) bad('op 불량: ' + p.op);
      if (!p.reason) bad('reason 누락');
    }
  } else if (kind === 'coverage') {
    if (!Array.isArray(j)) bad('coverage 배열 아님');
    for (const c of j) if (!c.rule_id || !Array.isArray(c.tc_ids)) bad('coverage 항목 불량');
  } else if (kind === 'exclusions') {
    if (!Array.isArray(j)) bad('exclusions 배열 아님');
    for (const x of j) if (!x.rule_id || !['타기획서', '비TC성서술', '중복규칙'].includes(x.reason)) bad('제외 사유 불량: ' + (x && x.reason));
  } else if (kind === 'labels') {
    if (!j || typeof j !== 'object' || !Array.isArray(j['기획확인'])) bad('_labels.json: 기획확인 배열 없음');
  } else bad('알 수 없는 kind: ' + kind);
  console.log('ok');

} else if (cmd === 'readback-diff') {
  // final.json rows: 10열 [A..J] (인덱스 0..9). dump: read_gsheet_data.js 출력 {rows:[[...]]}.
  // tc_id(A열, 숫자 3자리) 조인으로 A~G(0..6)+J(9) 비교 — 헤더/패널 행 오프셋에 강건.
  const fin = readJ(a[0]);
  const dump = readJ(a[1]);
  const finRows = fin.rows || fin;
  const isId = (v) => typeof v === 'string' && /^\d{3}$/.test(v.trim());
  const norm = (v) => String(v == null ? '' : v).replace(/\r\n/g, '\n').trim();
  const dumpById = new Map();
  let errCells = 0;
  // 시트는 동일 분류를 최상단 1회만 표기(dedup, tc-생성 V-07)하고 final.json은 전 행 채움(L4-02 계약).
  // → 덤프의 B/C/D를 fill-down으로 복원한 뒤 비교한다. (2026-07-28: 미적용 시 dedup 행마다 오탐,
  //    훈장시스템_v2 첫 풀체인에서 1023건 오탐으로 발각 — S6이 항상 정지하던 결함)
  const carry = ['', '', ''];
  for (const r of (dump.rows || [])) {
    for (const c of r) if (typeof c === 'string' && (c.includes('#ERROR!') || c.includes('#REF!'))) errCells++;
    if (r.length && isId(String(r[0]))) {
      for (let ci = 1; ci <= 3; ci++) {
        const v = String(r[ci] == null ? '' : r[ci]).trim();
        if (v) carry[ci - 1] = v; else r[ci] = carry[ci - 1];
      }
      dumpById.set(String(r[0]).trim(), r);
    }
  }
  if (errCells) { console.log(`시트 평가 오류 셀 ${errCells}건 (#ERROR!/#REF!)`); process.exit(1); }
  const COLS = [0, 1, 2, 3, 4, 5, 6, 9];
  let diffs = 0;
  for (const fr of finRows) {
    const id = String(fr[0]).trim();
    const dr = dumpById.get(id);
    if (!dr) { console.log('시트에 없는 tc_id: ' + id); diffs++; continue; }
    for (const ci of COLS) {
      if (norm(fr[ci]) !== norm(dr[ci])) {
        if (diffs < 5) console.log(`diff tc_id=${id} col=${'ABCDEFGHIJ'[ci]}: [${norm(fr[ci]).slice(0, 40)}] ≠ [${norm(dr[ci]).slice(0, 40)}]`);
        diffs++;
      }
    }
  }
  if (dumpById.size !== finRows.length) { console.log(`행수 불일치: 시트 ${dumpById.size} ≠ 최종본 ${finRows.length}`); diffs++; }
  if (diffs) { console.log(`read-back diff ${diffs}건`); process.exit(1); }
  console.log('0-diff ok (' + finRows.length + '행)');

} else if (cmd === 'seal-coverage') {
  // 봉합 add_row 적용 후: coverage_seal.json의 f 전문을 tcteam_tc_final.json에서 찾아
  // 신규 tc_id를 회수, coverage.json에 병합 (id 산술 리맵 금지 — 내용 조인, SKILL S5 규칙).
  const W = a[0];
  const fin = readJ(path.join(W, 'tcteam_tc_final.json'));
  const finRows = fin.rows || fin;
  const seal = readJ(path.join(W, 'coverage_seal.json'));
  const cov = readJ(path.join(W, 'coverage.json'));
  const norm = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  const byF = new Map(finRows.map(r => [norm(r[5]), String(r[0]).trim()]));   // F열(5) → tc_id
  const unmatched = [];
  for (const s of seal) {
    const ids = [];
    for (const ft of (s.f_texts || [])) {
      const id = byF.get(norm(ft));
      if (id) ids.push(id); else unmatched.push({ rule_id: s.rule_id, f: String(ft).slice(0, 60) });
    }
    if (ids.length) {
      const ex = cov.find(c => c.rule_id === s.rule_id);
      if (ex) ex.tc_ids = [...new Set([...ex.tc_ids, ...ids])];
      else cov.push({ rule_id: s.rule_id, tc_ids: ids, note: '봉합 루프(add_row)로 커버' });
    }
  }
  fs.writeFileSync(path.join(W, 'coverage.json'), JSON.stringify(cov, null, 1));
  if (unmatched.length) { console.log('f 전문 미매칭: ' + JSON.stringify(unmatched)); process.exit(1); }
  console.log('seal-coverage ok');

} else if (cmd === 'final-report') {
  const [SPEC, W, FEAT] = a;
  // 실제 탭명은 sheet_write가 WORK/sheet_info.txt 에 갱신(_vN 해석) — WORK 우선, SPEC 폴백.
  const readSi = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return ''; } };
  const siW = readSi(path.join(W, 'sheet_info.txt'));
  const siS = readSi(path.join(SPEC, 'sheet_info.txt'));
  const tab = ((siW.match(/^TAB_NAME=(.*)$/m) || siS.match(/^TAB_NAME=(.*)$/m)) || [, FEAT])[1].trim();
  const sheetId = ((siS.match(/^SHEET_ID=(.*)$/m) || siW.match(/^SHEET_ID=(.*)$/m)) || [, ''])[1].trim();
  const fin = readJ(path.join(W, 'tcteam_tc_final.json'));
  const rows = (fin.rows || fin).length;
  let times = '';
  try { times = fs.readFileSync(path.join(W, '.stage_times.txt'), 'utf8').trim(); } catch (e) { /* 없으면 생략 */ }
  const timeLine = times ? times.split('\n').map(l => l.replace('=', ' ')).join(' · ') : '(미기록)';
  const report = [
    `✅ tc-team 풀체인 완료 — 탭 \`${tab}\` · ${rows}행`,
    sheetId ? `https://docs.google.com/spreadsheets/d/${sheetId}/edit` : '',
    `단계 시간(초): ${timeLine}`,
    '',
    '🖼 이미지 매칭(선택): 시각자료가 필요한 TC가 있으면 "/tc-이미지매칭"으로 수동 추가할 수 있습니다. (비-기본기능 10~20% 권장 / 파이프라인 자동 미포함)',
    '🧪 테스트 데이터 셋팅(선택): 테스트 데이터 생성 요청 라벨이 필요하면 "테스트 데이터 라벨링 해줘"로 수동 추가할 수 있습니다. (기준: 같은 폴더 라벨링_기준.md / 파이프라인 자동 미포함)',
  ].filter(Boolean).join('\n');
  fs.writeFileSync(path.join(SPEC, 'final_report.txt'), report);
  console.log('final-report ok');

} else {
  die('알 수 없는 서브커맨드: ' + cmd);
}
