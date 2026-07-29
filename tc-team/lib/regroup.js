#!/usr/bin/env node
/**
 * regroup.js — tc-v3 S5 후처리: 분류 그룹(B/C/D) 인접화 (V-17 방어).
 *
 * add_row(커버리지 보강)는 앵커 뒤 삽입이라 같은 (대/중/소) 그룹을 비인접하게 쪼갤 수 있다
 * (create_gsheet validatePreWrite V-17 차단). 이 유틸이 fill-down 그룹키 기준 **최초등장 순서 안정 정렬**로
 * 같은 그룹을 인접화하고 A열을 재번호한다. 결정론·멱등(이미 인접이면 순서 불변).
 *
 * 입력/출력: 10열 스냅샷 { rows:[[A..J]] }. B/C/D는 채워서 출력(create_gsheet가 표시용 dedup 수행).
 */
'use strict';
const fs = require('fs');
const SEP = '\0';

function regroupRows(rows) {
  let b = '', c = '', d = '';
  const keyed = rows.map(r => {
    if (r[1]) { b = r[1]; c = ''; d = ''; }
    if (r[2]) c = r[2];
    if (r[3]) d = r[3];
    return { r, key: b + SEP + c + SEP + d, b, c, d };
  });
  const order = [], groups = new Map();
  for (const k of keyed) {
    if (!groups.has(k.key)) { groups.set(k.key, []); order.push(k.key); }
    groups.get(k.key).push(k);
  }
  const out = [];
  for (const key of order) for (const k of groups.get(key)) {
    const nr = k.r.slice();
    nr[1] = k.b; nr[2] = k.c; nr[3] = k.d; // 채워서 출력(그룹 정합 보장)
    out.push(nr);
  }
  return out.map((r, i) => { const x = r.slice(); x[0] = String(i + 1).padStart(3, '0'); return x; });
}

function isContiguous(rows) {
  let b = '', c = '', d = '';
  const seen = new Set(); let prev = null;
  for (const r of rows) {
    if (r[1]) { b = r[1]; c = ''; d = ''; } if (r[2]) c = r[2]; if (r[3]) d = r[3];
    const key = b + SEP + c + SEP + d;
    if (key !== prev) { if (seen.has(key)) return false; seen.add(key); prev = key; }
  }
  return true;
}

module.exports = { regroupRows, isContiguous };

if (require.main === module) {
  const [inPath, outPath] = process.argv.slice(2);
  if (!inPath || !outPath) { process.stderr.write('사용: regroup.js <snapshot.json> <out.json>\n'); process.exit(1); }
  const snap = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  const before = isContiguous(snap.rows);
  const rows = regroupRows(snap.rows);
  const out = Object.assign({}, snap, { rows, totalRows: rows.length });
  const tmp = outPath + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(out, null, 1)); fs.renameSync(tmp, outPath);
  process.stdout.write(JSON.stringify({ ok: true, rows: rows.length, was_contiguous: before, now_contiguous: isContiguous(rows) }) + '\n');
}
