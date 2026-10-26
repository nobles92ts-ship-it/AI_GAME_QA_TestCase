'use strict';

// Stored inside the existing design file so S1 candidate isolation/promotion owns it too.
const CHECKS = ['auth_failures', 'rejoin', 'reconnect', 'retention', 'url_state', 'token', 'concurrency', 'address_change', 'viewport', 'calendar'];
const CHECK_NAMES = ['인증 실패 횟수', '재가입', '재접속', '보관·파기', 'URL·상태 변조', '토큰 변조', '중복 제출·동시 인증', '주소 변경', '화면 크기 호환', '윤년·미래 날짜'];
const text = x => typeof x === 'string' && x.trim().length > 0;
function requireValue(ok, message) { if (!ok) throw new Error('실행 메타데이터: ' + message); }
function strings(value, name) {
  requireValue(Array.isArray(value) && value.every(text), name + '는 문자열 배열이어야 합니다');
}

/** Parse authored decisions; missing legacy metadata remains explicitly unknown. */
function parseMetadata(design, source) {
  const headings = [...design.matchAll(/^## 실행 계획 메타데이터\s*$/gm)];
  if (!headings.length) return null;
  requireValue(headings.length === 1, '중복 섹션');
  const section = design.slice(headings[0].index + headings[0][0].length).split(/^## /m)[0];
  const blocks = [...section.matchAll(/```json\s*\n([\s\S]*?)```/g)];
  requireValue(blocks.length === 1, 'JSON 블록이 정확히 하나 필요합니다');
  let m;
  try { m = JSON.parse(blocks[0][1]); } catch (e) { throw new Error('실행 메타데이터 JSON: ' + e.message); }
  requireValue(m && m.schema_version === 1 && Array.isArray(m.groups), 'schema_version=1 및 groups 필요');
  requireValue(Array.isArray(m.checks) && m.checks.length === CHECKS.length, '검토 축 ' + CHECKS.length + '개 필요');
  const keys = new Set();
  for (const g of m.groups) {
    requireValue(g && Array.isArray(g.path) && g.path.length === 3 && g.path.every(text), 'path=[대,중,소] 필요');
    requireValue(!g.stage || ['정상', '부정', '예외'].includes(g.stage), 'stage 값 오류');
    requireValue(!g.platform || ['PC', '모바일', 'PC/모바일'].includes(g.platform), 'platform 값 오류');
    const key = JSON.stringify([g.path, g.stage || '', g.platform || '']);
    requireValue(!keys.has(key), '중복 메타데이터 selector'); keys.add(key);
    requireValue(['HIGH', 'MEDIUM', 'LOW', '미정'].includes(g.risk), 'risk 값 오류');
    requireValue(['P0', 'P1', 'P2', '미정'].includes(g.priority) && text(g.priority_reason), 'priority/priority_reason 필요');
    for (const field of ['requirement_ids', 'screen_ids', 'dependencies', 'cleanup']) strings(g[field], field);
    for (const id of [...g.requirement_ids, ...g.screen_ids]) {
      const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      requireValue(new RegExp('(^|[^A-Za-z0-9_-])' + escaped + '($|[^A-Za-z0-9_-])').test(source), '원문에 없는 ID: ' + id);
    }
    const a = g.automation;
    requireValue(a && ['candidate', 'manual', 'needs_tool', 'undetermined'].includes(a.status) && text(a.reason), 'automation.status/reason 필요');
    if (a.status === 'candidate') for (const field of ['method', 'oracle', 'reset']) requireValue(text(a[field]), 'automation.' + field + ' 필요');
  }
  const checks = new Set();
  for (const c of m.checks) {
    requireValue(c && CHECKS.includes(c.id) && !checks.has(c.id), '검토 축 ID 누락/중복'); checks.add(c.id);
    requireValue(['applicable', 'not_applicable', 'needs_info'].includes(c.status) && text(c.reason), '검토 축 상태/사유 필요');
    if (c.status === 'applicable') {
      requireValue(text(c.evidence) && Array.isArray(c.paths) && c.paths.length > 0, '해당 검토 축의 evidence/paths 필요');
      requireValue(c.paths.every(p => Array.isArray(p) && p.length === 3 && p.every(text)), '검토 축 paths 형식 오류');
    }
  }
  return m;
}

/** Match classification text, never pre-fix TC numbers. Ambiguous selectors are rejected. */
function executionRows(rows, metadata, warnings) {
  const used = new Set();
  const result = rows.map(row => {
    const matches = (metadata?.groups || []).filter(g => g.path.every((s, i) => s === row[i + 1]) &&
      (!g.stage || g.stage === row[4]) && (!g.platform || g.platform === row[6]));
    requireValue(matches.length <= 1, '중복 매칭 메타데이터: ' + row[0]);
    const g = matches[0]; if (g) used.add(g);
    return { tc_id: row[0], path: row.slice(1, 4), stage: row[4], step: row[5], platform: row[6],
      metadata_recorded: Boolean(g), risk: g?.risk || '미기록', priority: g?.priority || '미기록', priority_reason: g?.priority_reason || '미기록',
      requirement_ids: g?.requirement_ids || [], screen_ids: g?.screen_ids || [], dependencies: g?.dependencies || [], cleanup: g?.cleanup || [],
      automation: g?.automation || { status: '미기록', reason: '설계 메타데이터 없음' } };
  });
  for (const g of metadata?.groups || []) if (!used.has(g)) warnings.push('최종 TC 매칭 없음: ' + g.path.join(' > '));
  const missing = result.filter(r => r.priority === '미기록').length;
  if (missing) warnings.push('실행 메타데이터 미기록 TC ' + missing + '건');
  for (const c of metadata?.checks || []) if (c.status === 'applicable') {
    for (const p of c.paths) if (!result.some(r => r.path.every((s, i) => s === p[i]))) warnings.push('검토 축 TC 매칭 없음: ' + c.id + ' / ' + p.join(' > '));
  }
  return result;
}
module.exports = { CHECKS, CHECK_NAMES, parseMetadata, executionRows };
