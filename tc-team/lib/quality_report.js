#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { buildLedger, EXCLUSION_REASONS } = require('./traceability');
const { CHECKS, CHECK_NAMES, parseMetadata, executionRows } = require('./execution_metadata');
const LENSES = ['structure', 'quality', 'crossref'];
const percent = n => n === null ? '대상 없음' : (n * 100).toFixed(2) + '%';
const idKey = id => /^\s*(?:TC[- ]?)?0*(\d+)\s*$/i.exec(String(id))?.[1] || String(id);
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const ratio = (n, d) => d ? n / d : null;

/** Recompute source-rule coverage against final TC IDs without changing the legacy gate. */
function coverageView(input, rows, warnings) {
  const rules = Array.isArray(input.slices) ? input.slices : input.slices.rules;
  if (!Array.isArray(rules)) throw new Error('slices.rules 배열 필요');
  const ledger = buildLedger(rules, input.coverage, input.exclusions || []);
  const ids = new Set(rows.map(r => idKey(r[0])));
  if (ids.size !== rows.length) throw new Error('최종 TC ID 중복');
  const mapped = ledger.mapped.map(r => {
    const invalid = r.tc_ids.filter(id => !ids.has(idKey(id)));
    if (invalid.length) warnings.push('존재하지 않는 TC 연결: ' + r.rule_id + ' → ' + invalid.join(', '));
    const tc_ids = r.tc_ids.filter(id => ids.has(idKey(id)));
    if (r.status === 'excluded' && !EXCLUSION_REASONS.includes(r.exclusion)) {
      warnings.push('허용되지 않은 제외: ' + r.rule_id + ' / ' + r.exclusion);
      return { ...r, tc_ids, status: 'uncovered' };
    }
    return { ...r, tc_ids, status: r.status === 'covered' && !tc_ids.length ? 'uncovered' : r.status };
  });
  if (!ledger.gate.pass) warnings.push('기존 추적 게이트 확인 필요: ' + JSON.stringify(ledger.gate));
  const count = status => mapped.filter(r => r.status === status).length;
  const covered = count('covered'), excluded = count('excluded'), uncovered = count('uncovered');
  return { mapped, rules: rules.length, covered, excluded, uncovered, direct_rate: ratio(covered, rules.length),
    scoped_rate: ratio(covered, rules.length - excluded), accounted_rate: ratio(covered + excluded, rules.length), legacy_gate: ledger.gate };
}

/** Aggregate evidence, keeping missing review files distinct from zero findings. */
function reviewView(input) {
  const lenses = {}, findings = [];
  for (const key of LENSES) {
    const value = input.lenses?.[key];
    if (value && !Array.isArray(value.findings)) throw new Error('lens_' + key + '.findings 배열 필요');
    lenses[key] = value ? value.findings.length : null;
    for (const f of value?.findings || []) findings.push({ ...f, lens: key });
  }
  const questions = input.labels === null || input.labels === undefined ? null : input.labels['기획확인'];
  if (questions !== null && !Array.isArray(questions)) throw new Error('_labels.기획확인 배열 필요');
  const applied = input.patches?.applied;
  if (applied !== undefined && !Array.isArray(applied)) throw new Error('applied_patches.applied 배열 필요');
  const dropped = input.dropped?.['뺀질문'] || [], removed = input.removed?.removed || [];
  if (!Array.isArray(dropped) || !Array.isArray(removed)) throw new Error('질문 제외 기록 배열 필요');
  return { lenses, findings, questions, applied_patch_count: applied?.length ?? null,
    dropped_questions: dropped, removed_questions: removed };
}

/** Build a separate read-only view. Existing TC results and classification remain untouched. */
function buildReport(input) {
  if (!Array.isArray(input.rows) || input.rows.some(r => !Array.isArray(r) || r.length !== 10)) throw new Error('최종 TC는 10열 배열이어야 합니다');
  const warnings = [];
  const metadata = parseMetadata(input.design || '', input.source || '');
  if (!metadata) warnings.push('실행 계획 메타데이터 없음 — 기존 런은 판단값을 추정하지 않습니다');
  const coverage = coverageView(input, input.rows, warnings);
  const execution = executionRows(input.rows, metadata, warnings);
  const review = reviewView(input);
  const tree = [];
  for (const row of execution) {
    let node = tree.find(n => JSON.stringify(n.path) === JSON.stringify(row.path));
    if (!node) { node = { path: row.path, tc_ids: [] }; tree.push(node); }
    node.tc_ids.push(row.tc_id);
  }
  const checks = CHECKS.map((id, i) => ({ name: CHECK_NAMES[i], ...(metadata?.checks.find(c => c.id === id) || { id, status: '미기록', reason: '과거 산출물 미기록' }) }));
  const pending = checks.filter(c => c.status === 'needs_info');
  if (pending.length) warnings.push('적용성 확인 필요: ' + pending.map(c => c.name).join(', '));
  const missingReview = LENSES.filter(k => review.lenses[k] === null);
  if (missingReview.length) warnings.push('리뷰 미기록: ' + missingReview.join(', '));
  if (review.questions === null) warnings.push('기획 확인 목록 미기록');
  return { schema_version: 1, feature: input.feature || '', tc_count: input.rows.length, coverage, tree, execution, review, checks,
    warnings, status: warnings.length ? 'review_required' : 'available', source_url: input.source_url || '', input_hashes: input.input_hashes || {},
    execution_status: 'TC 설계 산출물 — 제품 테스트 실행 결과가 아닙니다' };
}

function sections(r) {
  const c = r.coverage;
  return [
    { title: '커버리지', headers: ['지표', '분자/분모', '비율'], rows: [
      ['전체 규칙 TC 직접 연결', `${c.covered}/${c.rules}`, percent(c.direct_rate)],
      ['허용 제외 후 대상 규칙 연결', `${c.covered}/${c.rules - c.excluded}`, percent(c.scoped_rate)],
      ['TC 연결 또는 허용 제외 처리', `${c.covered + c.excluded}/${c.rules}`, percent(c.accounted_rate)],
      ['미커버', c.uncovered, '원문 요구 추출의 완전성은 별도 검토'] ] },
    { title: '기능 트리', headers: ['대 > 중 > 소', '최종 TC'], rows: r.tree.map(n => [n.path.join(' > '), n.tc_ids.join(', ')]) },
    { title: '요구사항 추적·제외·미커버', headers: ['규칙', '원문 위치', '원문 검증요소', '상태', '최종 TC', '제외 사유'],
      rows: c.mapped.map(n => [n.rule_id, n.sec_id || '미기록', n.text, n.status, n.tc_ids.join(', '), n.exclusion || '']) },
    { title: '추가 관점 검토', headers: ['관점', '적용성', '사유·근거', '대상 분류'],
      rows: r.checks.map(n => [n.name, ({ applicable: '해당', not_applicable: '비해당', needs_info: '확인 필요' })[n.status] || n.status,
        [n.reason, n.evidence].filter(Boolean).join(' / '), (n.paths || []).map(p => p.join(' > ')).join('; ')]) },
    { title: '리뷰 상태', headers: ['관점', '지적 수'], rows: LENSES.map(k => [k, r.review.lenses[k] ?? '미기록']) },
    { title: '리뷰 지적', headers: ['관점', '당시 TC', '심각도', '지적', '수정 제안'], rows: r.review.findings.map(n => [n.lens, n.tc_id, n.severity, n.issue, n.suggested_fix]) },
    { title: '기획 확인', headers: ['질문'], rows: r.review.questions === null ? [['미기록 — 질문 0건으로 판정하지 않음']] : r.review.questions.map(q => [q]) },
    { title: '질문 제외 기록', headers: ['질문', '분류', '제외 근거'], rows: r.review.dropped_questions.map(n => [n['질문'], n['갈래'], n['근거']]) },
    { title: '대조 후 질문 제외 기록', headers: ['원장 기록'], rows: r.review.removed_questions.map(n => [JSON.stringify(n)]) },
    { title: '실행 계획', headers: ['최종 TC', '분류', '재현 스탭', '위험도', '실행 우선순위', '우선순위 사유', '요구사항/화면 ID', '선행 의존', '종료 후 정리', '자동화 후보·근거'],
      rows: r.execution.map(n => [n.tc_id, [...n.path, n.stage, n.platform].join(' > '), n.step, n.risk, n.priority, n.priority_reason,
        [...n.requirement_ids, ...n.screen_ids].join(', ') || (n.metadata_recorded ? '원문 ID 미기재' : '미기록'),
        n.dependencies.join('; ') || (n.metadata_recorded ? '없음(작성자 판단)' : '미기록'), n.cleanup.join('; ') || (n.metadata_recorded ? '없음(작성자 판단)' : '미기록'),
        [n.automation.status, n.automation.reason, n.automation.method, n.automation.oracle, n.automation.reset].filter(Boolean).join(' / ')]) },
    { title: '검토 알림', headers: ['내용'], rows: r.warnings.map(x => [x]) },
    { title: '입력 증거 SHA256', headers: ['파일', '해시'], rows: Object.entries(r.input_hashes) },
  ];
}
const mdCell = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '&#124;').replace(/[\r\n]+/g, '<br>');
const html = v => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
function introduction(r) {
  return [r.execution_status, `TC ${r.tc_count}개 · 규칙 ${r.coverage.rules}개 · 연결 ${r.coverage.covered} · 제외 ${r.coverage.excluded} · 미커버 ${r.coverage.uncovered} · 검토 알림 ${r.warnings.length}건`,
    '위험도=실패 영향과 발생가능성, 실행 우선순위=이번 실행 순서, 자동화 후보=구현·실행 완료 아님.',
    `적용 원장에 기록된 패치 ${r.review.applied_patch_count ?? '미기록'}개. 리뷰 지적과 적용 패치는 별도 집계이며 모든 지적이 해결됐다는 뜻은 아닙니다.`,
    '리뷰의 TC 번호는 리뷰 당시 번호입니다. 실행 계획·추적 표는 확정본 기준입니다. ID 연결은 원장의 의미 정확성을 보증하지 않으므로 원문 대조가 필요합니다.', r.source_url].filter(Boolean);
}
function renderMarkdown(r) {
  const blocks = [`# ${mdCell(r.feature)} 품질·실행 계획`, ...introduction(r).map(mdCell)];
  for (const s of sections(r)) blocks.push('## ' + s.title, [
    '| ' + s.headers.map(mdCell).join(' | ') + ' |', '| ' + s.headers.map(() => '---').join(' | ') + ' |',
    ...(s.rows.length ? s.rows : [s.headers.map((_, i) => i ? '' : '기록 없음')]).map(row => '| ' + row.map(mdCell).join(' | ') + ' |') ].join('\n'));
  return blocks.join('\n\n') + '\n';
}
function renderHtml(r) {
  return '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TC 품질·실행 계획</title>' +
    '<style>body{font:15px system-ui;background:#f4f6f9;color:#182438;max-width:1500px;margin:32px auto;padding:0 20px}details{background:white;border:1px solid #ccd4e0;border-radius:8px;margin:16px 0;padding:16px;overflow:auto}summary{font-size:18px;font-weight:650;cursor:pointer}table{border-collapse:collapse;width:100%;margin-top:15px}th,td{border:1px solid #d8dfe9;padding:9px;text-align:left;vertical-align:top;white-space:pre-wrap;min-width:80px}th{background:#edf1f7}p{line-height:1.7}</style>' +
    '<h1>' + html(r.feature) + ' 품질·실행 계획</h1>' + introduction(r).map(x => '<p>' + html(x) + '</p>').join('') +
    sections(r).map(s => '<details open><summary>' + html(s.title) + '</summary><table><thead><tr>' + s.headers.map(h => '<th>' + html(h) + '</th>').join('') +
      '</tr></thead><tbody>' + s.rows.map(row => '<tr>' + row.map(v => '<td>' + html(v) + '</td>').join('') + '</tr>').join('') + '</tbody></table></details>').join('') + '</html>';
}

/** Read canonical inputs and write only separate report files, optionally to a preview directory. */
function generate(spec, out = spec) {
  const hashes = {};
  function read(name, required = false, json = true) {
    const file = path.join(spec, name);
    if (!fs.existsSync(file)) { if (required) throw new Error('필수 입력 없음: ' + name); return null; }
    const bytes = fs.readFileSync(file); hashes[name] = digest(bytes);
    if (!json) return bytes.toString('utf8');
    try { return JSON.parse(bytes.toString('utf8')); } catch (e) { throw new Error(name + ' JSON: ' + e.message); }
  }
  const snapshot = read('tcteam_tc_final.json', true);
  const input = { feature: path.basename(spec), rows: Array.isArray(snapshot) ? snapshot : snapshot.rows,
    slices: read('slices.json', true), coverage: read('coverage.json', true), exclusions: read('exclusions.json'),
    design: read('tc_design.md', true, false), source: read('confluence_raw.md', true, false),
    lenses: Object.fromEntries(LENSES.map(k => [k, read('lens_' + k + '.json')])),
    labels: read('_labels.json'), dropped: read('_labels_dropped.json'), removed: read('_labels_removed.json'), patches: read('applied_patches.json'), input_hashes: hashes };
  const si = read('sheet_info.txt', false, false) || '';
  input.source_url = (si.match(/^CONFLUENCE_URL=(.*)$/m) || [])[1]?.trim() || '';
  const report = buildReport(input);
  fs.mkdirSync(out, { recursive: true });
  for (const [ext, content] of Object.entries({ json: JSON.stringify(report, null, 2) + '\n', md: renderMarkdown(report), html: renderHtml(report) })) {
    const file = path.join(out, 'quality_report.' + ext); fs.writeFileSync(file + '.tmp', content); fs.renameSync(file + '.tmp', file);
  }
  return report;
}
module.exports = { buildReport, renderMarkdown, renderHtml, generate };
if (require.main === module) {
  try {
    const [spec, out, ...extra] = process.argv.slice(2);
    if (!spec || extra.length) throw new Error('사용: quality_report.js <spec> [별도 출력 폴더]');
    const r = generate(path.resolve(spec), out ? path.resolve(out) : undefined);
    console.log(JSON.stringify({ tc: r.tc_count, coverage: { ...r.coverage, mapped: undefined }, warnings: r.warnings }));
  } catch (e) { console.error('[품질 보고서] ' + e.message); process.exitCode = 1; }
}
