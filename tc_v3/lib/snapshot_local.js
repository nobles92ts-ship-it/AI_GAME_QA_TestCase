#!/usr/bin/env node
/**
 * snapshot_local.js — tc-v3: merge 산출(7열 tc_data)을 업로드 없이 로컬 10열 스냅샷으로 조립.
 *
 * v2는 create_gsheet 업로드 후 read_gsheet_data로 10열 스냅샷을 얻었으나, v3는 업로드 전까지
 * 시트를 만지지 않는다(§4 원칙1) → 7열에서 A(순번)·H·I를 결정론 파생해 로컬 스냅샷 생성.
 * H/I = validate_tc_rows.expectedHI(j, platform, isBasic) — create_gsheet(:122)와 동일 함수.
 *
 * 입력 7열: [대,중,소,검증단계,재현스탭,플랫폼,비고]   출력 10열: [A,B,C,D,E,F,G,H,I,J]
 */
'use strict';
const fs = require('fs');
const { expectedHI } = require('../../scripts/util/validate_tc_rows.js');

const HEADERS = ['TC ID', '대분류', '중분류', '소분류', '검증단계', '재현 스탭', '플랫폼', 'PC 결과', '모바일 결과', '비고'];

function buildSnapshot(data7, sheetName) {
  const rows = data7.map((r, i) => {
    const major = r[0] || '', platform = r[5] || '', note = r[6] || '';
    const hi = expectedHI(note, platform, major === '기본기능');
    return [String(i + 1).padStart(3, '0'), major, r[1] || '', r[2] || '', r[3] || '', r[4] || '', platform, hi.h, hi.i, note];
  });
  return { sheetName: sheetName || '', headers: HEADERS, columnsApplied: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'], totalRows: rows.length, rows };
}

module.exports = { buildSnapshot, HEADERS };

if (require.main === module) {
  const [dataPath, outPath, sheetName] = process.argv.slice(2);
  if (!dataPath || !outPath) { process.stderr.write('사용: snapshot_local.js <tc_data.json(7열)> <out.json> [sheetName]\n'); process.exit(1); }
  const data7 = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const snap = buildSnapshot(data7, sheetName);
  const tmp = outPath + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(snap, null, 1)); fs.renameSync(tmp, outPath);
  process.stdout.write(JSON.stringify({ ok: true, rows: snap.rows.length }) + '\n');
}
