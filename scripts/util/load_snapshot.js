#!/usr/bin/env node
/**
 * load_snapshot.js — TC 스냅샷/덤프 JSON 공용 로더 (tc-team-v2)
 *
 * 배경 (2026-06-10, Fable 패스 F4-A1):
 *   read_gsheet_data 계열 출력은 {sheetName, headers, rows[]} 형식이고,
 *   일부 덤프 파일은 stdout 인증 메시지(`✔ 인증 ...`)가 JSON 앞에 섞인다.
 *   사용처마다 제각각 파싱하다 STEP 6 하드 가드가 r.values를 찾아
 *   정상 스냅샷(rows)을 0행으로 오판 → 무조건 snapshot_empty fail 회귀가 있었음.
 *   → 파싱을 이 파일 한 곳으로 통일한다.
 *
 * 사용처: STEP 6 하드 가드(행수 검증) · 완료처리 FINAL-4 · /tc-학습-수집 베이스라인 로드
 *
 * CLI:
 *   node load_snapshot.js <파일경로> --count   → 행 수만 출력 (읽기/파싱 실패 시 0, exit 0 유지 — 가드용)
 *   node load_snapshot.js <파일경로>           → {ok, rowCount, sheetName, error} JSON 출력 (실패 시 exit 1)
 *
 * API:
 *   const { loadSnapshot } = require('./load_snapshot.js');
 *   const r = loadSnapshot(path);  // { ok, data, rows, rowCount, error }
 */

const fs = require('fs');

function loadSnapshot(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return { ok: false, error: 'read_fail: ' + e.message, data: null, rows: [], rowCount: 0 };
  }

  // `✔ 인증 ...` 등 프리픽스 제거 — 줄 단위 스캔으로 '{' 또는 '['로 시작하는
  // 각 후보 줄에서 파싱 시도, 실패하면 다음 후보로 진행.
  // ⚠ 문자 인덱스 min 방식 금지 (L4-04 회귀): '[토큰 자동 갱신 완료]' 같은
  //   대괄호 로그 라인이 섞이면 그 '['를 JSON 시작으로 오인해 parse_fail → 0행 오판.
  const candidates = [];
  let offset = 0;
  for (const line of text.split('\n')) {
    const t = line.trimStart();
    if (t.startsWith('{') || t.startsWith('[')) {
      candidates.push(offset + (line.length - t.length));
    }
    offset += line.length + 1;
  }
  if (candidates.length === 0) {
    return { ok: false, error: 'no_json', data: null, rows: [], rowCount: 0 };
  }

  let data = null, found = false, lastErr = null;
  for (const start of candidates) {
    try {
      data = JSON.parse(text.slice(start));
      found = true;
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!found) {
    return { ok: false, error: 'parse_fail: ' + (lastErr ? lastErr.message : 'unknown'), data: null, rows: [], rowCount: 0 };
  }

  // 행 배열 호환: rows(표준) → values(구형) → 최상위 배열
  const rows = Array.isArray(data.rows) ? data.rows
             : Array.isArray(data.values) ? data.values
             : Array.isArray(data) ? data
             : [];

  return { ok: true, data, rows, rowCount: rows.length, error: null };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const file = args.find(a => !a.startsWith('--')) || '';
  const r = loadSnapshot(file);

  if (args.includes('--count')) {
    // 가드용: 항상 숫자 1줄 + exit 0 (실패 = 0행 출력)
    process.stdout.write(String(r.rowCount) + '\n');
    process.exit(0);
  }

  process.stdout.write(JSON.stringify({
    ok: r.ok,
    rowCount: r.rowCount,
    sheetName: (r.data && r.data.sheetName) || null,
    error: r.error,
  }) + '\n');
  process.exit(r.ok ? 0 : 1);
}

module.exports = { loadSnapshot };
