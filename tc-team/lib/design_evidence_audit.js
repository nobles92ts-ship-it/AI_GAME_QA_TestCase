#!/usr/bin/env node
'use strict';
// Read-only baseline comparison. Semantic source/approval judgment remains with C-06/C-16.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const UNCERTAIN = /가데이터|예시|플레이스홀더|미정|미지정|확인\s*필요|AS-IS|폐기|구형|unspecified|placeholder|\{[^}]*\}/i;
const UNITS = { ms: ['time', 0.001], 초: ['time', 1], s: ['time', 1], 분: ['time', 60], 시간: ['time', 3600], 일: ['time', 86400], '%': ['percent', 1], 개: ['count', 1], 명: ['people', 1], 레벨: ['level', 1] };
const clean = value => String(value).replace(/~~[^~]*~~/g, '').replace(/`/g, '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/^\*([^*]+)\*$/, '$1').trim();
const finding = (severity, code, key, detail, locations = []) => ({ severity, code, key, detail, locations });

function explicitScopes(text) {
  const parts = [];
  for (const match of text.matchAll(/\[((?:PC|AOS|iOS|모바일)(?:\s*[/,·]\s*(?:PC|AOS|iOS|모바일))*)\]/gi)) parts.push(...match[1].split(/[/,·]/));
  for (const match of text.matchAll(/(?:\bscope|적용\s*범위)\s*[:=]\s*([^;,\]\n|]+)/gi)) parts.push(match[1]);
  return [...new Set(parts.map(x => clean(x).toLowerCase()).filter(Boolean))].sort();
}

function scalar(value) {
  const text = clean(value);
  if (UNCERTAIN.test(text)) return null;
  const m = text.match(/^([-+]?\d+(?:\.\d+)?)\s*(ms|시간|레벨|초|분|일|개|명|s|%)?\s*(?:\([^\n]*\)|\[[^\n]*\])?$/);
  if (!m) return null;
  const unit = UNITS[m[2]] || ['', 1];
  const number = Number(m[1]) * unit[1];
  return Number.isFinite(number) ? { number, dimension: unit[0], raw: text } : null;
}

function baselineRows(text, label, findings) {
  const rows = new Map();
  rows.complete = true;
  const headingScopes = new Map();
  let depth = 0, skipDepth = 0, headers = null, fenced = false;
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (/^\s*```/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const h = line.match(/^(#{1,6})\s+(.*)/);
    if (h) {
      for (const level of headingScopes.keys()) if (level >= h[1].length) headingScopes.delete(level);
      const scope = explicitScopes(h[2]);
      if (scope.length) headingScopes.set(h[1].length, scope);
      if (skipDepth && h[1].length <= skipDepth) skipDepth = 0;
      if (depth && h[1].length <= depth) depth = 0;
      if (/GlobalDefine.*(?:키|목록)|A-5[.\s].*GlobalDefine/i.test(h[2])) depth = h[1].length;
      if (depth && /QA|BVA|시험|테스트\s*입력|경계값|예외\s*케이스/i.test(h[2])) skipDepth = h[1].length;
      headers = null;
      continue;
    }
    if (!depth || skipDepth || !/^\s*\|/.test(line)) { headers = null; continue; }
    const cells = line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(clean);
    if (cells.every(x => /^:?-+:?$/.test(x))) continue;
    if (headers === false) continue;
    if (headers === null) { headers = cells; continue; }
    const ki = headers.findIndex(x => /^(키(?:명|\/항목)?|설정\s*키|GlobalDefine\s*키|Key|Name)$/i.test(x));
    const vi = headers.findIndex(x => /^(?:기획서\s*)?(초기값|기본값|설정값|현재값|확정값|Value)(?:[·\s(/].*)?$/i.test(x));
    if (ki < 0 || vi < 0) {
      if (headers !== false) findings.push(finding('REVIEW', 'unsupported_global_table', '', '표 헤더를 기계 판독하지 못함', [`${label}:${index + 1}`]));
      rows.complete = false; headers = false; continue;
    }
    const key = cells[ki] || '';
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) {
      findings.push(finding('REVIEW', 'ambiguous_key', key, '키명·별칭을 추론하지 않음', [`${label}:${index + 1}`]));
      continue;
    }
    const si = headers.findIndex(x => /^(적용\s*범위|scope|범위|플랫폼)$/i.test(x));
    const scopeParts = [...headingScopes.values()].flat().concat(explicitScopes(cells.join(' ')));
    if (si >= 0 && cells[si]) scopeParts.push(cells[si].toLowerCase());
    const scope = [...new Set(scopeParts)].sort().join(',');
    const record = { key, value: UNCERTAIN.test(cells.join(' ')) ? null : scalar(cells[vi] || ''), raw: cells[vi] || '', scope, location: `${label}:${index + 1}` };
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(record);
  }
  return rows;
}

function approvedValues(crossref, findings) {
  const candidates = new Map();
  for (const item of crossref.items || []) {
    if (!item || item.branch !== 'apply' || item.approved !== true || typeof item.source !== 'string' || !item.source.trim()) continue;
    // Never recurse into native_provenance or infer values from term/source filenames.
    const note = typeof item.note === 'string' ? item.note : '';
    const current = note.replace(/~~[^~]*~~/g, '').replace(/`/g, '');
    let parsed = false;
    const pairs = current.matchAll(/\b([A-Za-z][A-Za-z0-9_]{2,})\s*=\s*([-+]?\d+(?:\.\d+)?\s*(?:ms|시간|레벨|초|분|일|개|명|s|%)?)(?=$|[\s,;/.()])/g);
    for (const pair of pairs) {
      parsed = true;
      const before = Math.max(current.lastIndexOf('.', pair.index - 1), current.lastIndexOf(';', pair.index - 1), current.lastIndexOf('\n', pair.index - 1)) + 1;
      const after = current.slice(pair.index + pair[0].length).search(/[;\n]|\.(?:\s|$)/);
      const end = after < 0 ? current.length : pair.index + pair[0].length + after;
      const tail = current.slice(pair.index + pair[0].length);
      if (UNCERTAIN.test(current.slice(before, end)) || /^\s*(?:또는|혹은|->|=>|→|⇒|[~–])|^\s*(?:\/|,|-)\s*[-+]?\d/.test(tail)) {
        findings.push(finding('REVIEW', 'ambiguous_approval_context', pair[1], '승인 note에도 예시·미정 문맥이 있어 명시값을 확정하지 않음', [item.source]));
        continue;
      }
      const value = scalar(pair[2]);
      if (!value) continue;
      const record = { key: pair[1], value, source: item.source, id: item.id || '', note, scope: typeof item.scope === 'string' ? item.scope.trim().toLowerCase() : '' };
      if (!candidates.has(record.key)) candidates.set(record.key, []);
      candidates.get(record.key).push(record);
    }
    if (!parsed && /\b[A-Za-z][A-Za-z0-9_]*\s*=/.test(current)) findings.push(finding('REVIEW', 'unparsed_approval', '', '승인 note의 값 표현을 단일값으로 해석하지 못함', [item.source]));
  }
  const result = new Map();
  for (const [key, records] of candidates) {
    const versions = new Set(records.map(x => JSON.stringify([x.value.number, x.value.dimension, x.scope])));
    if (versions.size > 1) findings.push(finding('REVIEW', 'ambiguous_approval', key, '현재 승인 항목끼리 값/단위가 달라 자동 선택하지 않음', records.map(x => x.source)));
    else result.set(key, records[0]);
  }
  return result;
}

function singleRow(rows, key, label, findings) {
  const records = rows.get(key) || [];
  if (!records.length) return null;
  const versions = new Set(records.map(x => x.value && JSON.stringify([x.value.number, x.value.dimension, x.scope])));
  if (records.some(x => !x.value) || versions.size !== 1) {
    findings.push(finding('REVIEW', 'ambiguous_value', key, `${label}: 복수값·예시·미정은 현재값으로 확정하지 않음`, records.map(x => x.location)));
    return null;
  }
  return records[0];
}

function compare(key, expected, actual, label, findings) {
  const locations = [expected.location || expected.source, actual.location].filter(Boolean);
  const a = expected.value, b = actual.value;
  if ((expected.scope || '') !== (actual.scope || '')) {
    findings.push(finding('REVIEW', 'scope_unverified', key, `${label}: 명시된 적용 범위가 달라 같은 기준으로 비교하지 않음`, locations));
  } else if (a.dimension !== b.dimension && (!a.dimension || !b.dimension)) {
    findings.push(finding('REVIEW', 'unit_unverified', key, `${label}: 단위가 한쪽에 없어 값/단위 일치를 확정하지 않음`, locations));
  } else if (a.dimension !== b.dimension || Math.abs(a.number - b.number) > 1e-9 * Math.max(1, Math.abs(a.number), Math.abs(b.number))) {
    findings.push(finding('HIGH', 'value_mismatch', key, `${label}: ${a.raw} ↔ ${b.raw}`, locations));
  }
}

function provenanceHints(inputs) {
  const rules = { example: /가데이터|예시|플레이스홀더|placeholder|\{\d+\}/i, image: /!\[|\.(?:png|jpg|jpeg|webp)\b/i, unresolved: /미정|확인\s*필요|미구현|AS-IS|TO-BE/i };
  const hints = [];
  for (const [label, text] of Object.entries(inputs)) {
    for (const [kind, pattern] of Object.entries(rules)) {
      const matches = text.split(/\r?\n/).map((line, i) => ({ line, i })).filter(x => pattern.test(x.line));
      for (const x of matches.slice(0, 4)) hints.push({ kind, location: `${label}:${x.i + 1}`, excerpt: x.line.slice(0, 240), total_matching_lines: matches.length });
    }
  }
  return hints;
}

/** Compare declared baseline values only; never edit inputs or settle source semantics. */
function auditEvidence({ analysis, design, crossref = { items: [] }, raw = '' }) {
  if (!crossref || !Array.isArray(crossref.items)) throw new Error('dxr_crossref.items must be an array');
  const findings = [];
  const a = baselineRows(analysis, 'analysis.md', findings);
  const d = baselineRows(design, 'tc_design.md', findings);
  const approved = approvedValues(crossref, findings);
  const keys = new Set([...a.keys(), ...d.keys()]);
  for (const key of keys) {
    const av = singleRow(a, key, 'analysis', findings), dv = singleRow(d, key, 'design', findings);
    if (av && d.complete && !d.has(key)) findings.push(finding('HIGH', 'missing_design_key', key, '분석 GlobalDefine 명시 기준 키가 설계 표에 없음', a.get(key).map(x => x.location)));
    if (av && dv) compare(key, av, dv, '분석→설계', findings);
    if (approved.has(key)) {
      if (av) compare(key, approved.get(key), av, '현재 승인 대조→분석', findings);
      if (dv) compare(key, approved.get(key), dv, '현재 승인 대조→설계', findings);
    }
  }
  for (const key of approved.keys()) if (!keys.has(key)) findings.push(finding('REVIEW', 'unmapped_approval', key, '현재 승인 명시값을 GlobalDefine 표에 연결하지 못함; 별칭/적용 범위를 검수', [approved.get(key).source]));
  return {
    version: 1, mode: 'declared-baseline-consistency', semantic_or_pixel_verification: false,
    approved_values: [...approved.values()], findings,
    summary: { analysis_keys: a.size, design_keys: d.size, approved_values: approved.size, high: findings.filter(x => x.severity === 'HIGH').length, review: findings.filter(x => x.severity === 'REVIEW').length },
    provenance_hints: provenanceHints({ 'confluence_raw.md': raw, 'analysis.md': analysis, 'tc_design.md': design }),
  };
}

/** Re-read current artifacts and write only the audit report beside them. */
function runAudit(spec) {
  const inputs = {}, inputHashes = {};
  for (const name of ['analysis.md', 'tc_design.md', 'confluence_raw.md', 'dxr_crossref.json']) {
    const file = path.join(spec, name);
    if (!fs.existsSync(file)) {
      if (name === 'analysis.md' || name === 'tc_design.md') throw new Error('필수 입력 없음: ' + name);
      continue;
    }
    const bytes = fs.readFileSync(file);
    inputHashes[name] = crypto.createHash('sha256').update(bytes).digest('hex');
    inputs[name] = bytes.toString('utf8');
  }
  const crossref = inputs['dxr_crossref.json'] === undefined ? { items: [] } : JSON.parse(inputs['dxr_crossref.json']);
  const result = auditEvidence({ analysis: inputs['analysis.md'], design: inputs['tc_design.md'], raw: inputs['confluence_raw.md'] || '', crossref });
  result.input_hashes = inputHashes;
  fs.writeFileSync(path.join(spec, 'design_evidence_audit.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
  return result;
}

module.exports = { auditEvidence, runAudit };
if (require.main === module) {
  try {
    if (process.argv.length !== 3) throw new Error('사용: design_evidence_audit.js <spec-directory>');
    const report = runAudit(path.resolve(process.argv[2]));
    console.log(JSON.stringify({ ...report.summary, semantic_or_pixel_verification: false }));
    process.exit(report.summary.high ? 4 : 0);
  } catch (error) { console.error('[design_evidence_audit] ' + error.message); process.exit(1); }
}
