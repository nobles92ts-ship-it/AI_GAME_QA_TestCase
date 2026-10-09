'use strict';
/**
 * md_export.js — S5 확정본 → AI 실행용 md 묶음 (결정론, LLM 호출 0).
 *
 * 묶음: INDEX.md(실행 규칙·순서·판정 보류 질문·재현 수단) · cases/NN_<소분류>.md · spec.md · results.md
 *  - TC 번호와 재현 스탭 문장은 확정본 그대로 싣는다(바이트 보존). 다시 쓰기(ai_rewrite.json)는 그 옆의 도움말이다.
 *  - results.md 는 실행 결과 자리라 이미 있으면 건드리지 않는다 — 다시 내보내도 결과가 안 지워진다.
 *  - 시트·S7 산출물(confidence.json·_labels.json)은 읽지 않는다. 확신도는 ai_confidence.json, 질문은 설계서(S1)에서.
 *  - 근거 규칙은 S4 원장을 재현 스탭 문장으로 확정본에 잇는다 — 원장 번호는 S5 재번호 전 것이라 번호로 잇지 않는다(rulesByTc).
 *
 * 사용: node md_export.js <specs/기능명 폴더> [출력 폴더 = <폴더>/ai_bundle] [--rules <규칙 서랍>]
 */
const fs = require('fs');
const path = require('path');
const { readFinal, noteKind, platformsOf } = require('./tc_rows');
const { resolveRulesDir } = require('./paths');

const FORMAT = 'tc-team-ai/v1';
const SMOKE = '기본기능';
const RULES_FILE = 'ai-실행규칙.md';
const MAX_RULES_PER_TC = 3;
const RULE_QUOTE_CHARS = 160;
const LOW_GRADES = ['C', 'D'];

const readText = (dir, f) => { const p = path.join(dir, f); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null; };
const readJson = (dir, f) => { const s = readText(dir, f); return s ? JSON.parse(s) : null; };
const one = (s) => String(s == null ? '' : s).replace(/\s*\n\s*/g, ' ').trim();
const cont = (s) => String(s).replace(/\n/g, '\n  ');   // 원문에 줄바꿈이 있으면 목록 항목 안에 이어 쓴다(글자는 그대로)
const slug = (s) => s.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_');
const pad3 = (id) => String(id).padStart(3, '0');

function sheetInfo(spec) {
  const lines = (readText(spec, 'sheet_info.txt') || '').split(/\r?\n/).filter((l) => l.includes('='));
  return Object.fromEntries(lines.map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
}

// 설계서의 «#… 제목» 절 본문 — 다음 같은 깊이 이상의 제목 전까지
function section(md, title, level) {
  const hdr = '#'.repeat(level) + ' ';
  const lines = md.split(/\r?\n/);
  const i = lines.findIndex((l) => l.startsWith(hdr) && l.slice(hdr.length).trim().startsWith(title));
  if (i < 0) return '';
  const out = [];
  for (let k = i + 1; k < lines.length; k++) {
    const m = lines[k].match(/^(#+) /);
    if (m && m[1].length <= level) break;
    out.push(lines[k]);
  }
  return out.join('\n').trim();
}

// 절 본문의 첫 표 → { head, rows } (하위 제목이나 표 끝에서 멈춘다)
function firstTable(text) {
  const rows = [];
  for (const l of text.split(/\r?\n/)) {
    if (/^#/.test(l)) break;
    if (!l.trim().startsWith('|')) { if (rows.length) break; continue; }
    rows.push(l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()));
  }
  if (rows.length < 2) return { head: [], rows: [] };
  return { head: rows[0], rows: rows.slice(1).filter((r) => !r.every((c) => /^:?-+:?$/.test(c))) };
}

function planningQuestions(design) {
  const { head, rows } = firstTable(section(design, '기획 확인 필요 항목', 2));
  const at = (name) => head.findIndex((h) => h.includes(name));
  const [iKey, iWhere, iNow] = [at('항목'), at('등장 위치'), at('현재 상태')];
  return rows.map((r) => {
    if (iKey < 0) return r.slice(1).filter(Boolean).join(' · ');
    const where = iWhere >= 0 && r[iWhere] ? ` (${r[iWhere]})` : '';
    const now = iNow >= 0 && r[iNow] ? ` — ${r[iNow]}` : '';
    return `**${r[iKey]}**${where}${now}`;
  });
}

// TC → 근거 규칙. S4 원장(coverage_s4.json)의 tc_id 는 S3 스냅샷 번호다 — S5 가 행을 넣고·지우고 regroup 으로 번호를
// 다시 매기므로 확정본 번호에 그대로 대면 다른 TC 에 붙는다(tc-team SKILL.md S5 「원장 tc_ids stale」). 그래서 번호가 아니라
// 재현 스탭 문장으로 잇는다: 스냅샷 행의 문장(S4 가 F 를 고쳤으면 고친 문장도 후보) → 확정본에서 같은 문장의 행.
// 같은 문장이 기본기능 행과 QA 본문 행에 함께 있을 수 있다 — 기본기능은 본문을 기획자 검수용으로 다시 적은 것이라 설계상
// 허용되고, dup 게이트도 두 범위를 따로 본다. 그래서 스냅샷 행과 같은 범위의 행을 먼저 찾고, 거기 없을 때만 범위 없이 찾는다.
// 봉합 규칙은 coverage_seal.json 의 문장으로(chain_helpers seal-coverage 와 같은 조인) — 범위가 안 적혀 있어 두 행에 맞으면 고르지 않는다.
// 하나로 안 이어지는 연결은 싣지 않고 센다 — 틀린 근거보다 없는 근거가 낫다. 원장이 없으면 셀 것도 없어 null(«원장 없음»)이다.
const normF = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();   // seal-coverage 와 같은 정규화
const scopeOf = (b) => (b === SMOKE ? SMOKE : b ? 'QA' : '');                   // dup 게이트와 같은 두 범위 — 대분류가 비면 모름

function rulesByTc(spec, records, trace) {
  const mapped = (trace && trace.mapped) || [];
  const text = new Map(mapped.filter((m) => m.status === 'covered').map((m) => [m.rule_id, m]));
  const order = new Map(mapped.map((m, i) => [m.rule_id, i]));
  const byF = new Map();
  for (const r of records) { const k = normF(r.f); byF.set(k, [...(byF.get(k) || []), r]); }
  // 원장 행 하나의 문장들(고친 문장·원래 문장) → 확정본 TC 하나. 같은 범위의 행 먼저, 없으면 범위 없이
  const resolve = (texts, scope) => {
    const rows = [...new Set(texts.filter((f) => f != null).flatMap((f) => byF.get(normF(f)) || []))];
    const same = scope ? rows.filter((r) => scopeOf(r.b) === scope) : [];
    const pick = same.length ? same : rows;
    return pick.length === 1 ? pick[0].id : null;
  };

  const map = new Map();
  let unmapped = 0;
  const attach = (ruleId, id) => {
    const m = text.get(ruleId);
    if (!m) return;
    if (!id) { unmapped++; return; }
    const cur = map.get(id) || [];
    if (!cur.includes(m)) map.set(id, [...cur, m]);
  };
  const snap = readJson(spec, 'tcteam_snapshot.json');
  const cov = readJson(spec, 'coverage_s4.json');
  if (snap && cov) {
    const h = snap.headers || [];
    const [iA, iB, iF] = [h.indexOf('TC ID'), h.indexOf('대분류'), h.indexOf('재현 스탭')];
    const snapRow = new Map((snap.rows || []).map((r) => [pad3(r[iA]), { f: r[iF], scope: scopeOf(r[iB] == null ? '' : String(r[iB])) }]));
    const edits = ((readJson(spec, 'fix_plan.json') || {}).patches || []).filter((p) => p.op === 'edit_cell' && p.col === 'F');
    const editedF = new Map(edits.map((p) => [pad3(p.tc_id), p.after]));
    const entries = Array.isArray(cov) ? cov : Object.entries(cov).map(([rule_id, tc_ids]) => ({ rule_id, tc_ids }));
    for (const c of entries) {
      for (const sid of c.tc_ids || []) {
        const s = snapRow.get(pad3(sid)) || {};
        attach(c.rule_id, resolve([editedF.get(pad3(sid)), s.f], s.scope));
      }
    }
  }
  for (const s of readJson(spec, 'coverage_seal.json') || []) for (const f of s.f_texts || []) attach(s.rule_id, resolve([f]));
  for (const [id, ms] of map) map.set(id, [...ms].sort((a, b) => order.get(a.rule_id) - order.get(b.rule_id)));   // 기획서 순서
  return { map, unmapped: snap && cov && trace ? unmapped : null };
}

// 그룹 = 소분류(첫 등장 순). 기본기능은 소분류마다 1~3건이라 스모크 파일 하나로 묶어 맨 앞에 둔다
function groupRecords(records) {
  const groups = [];
  const at = new Map();
  for (const r of records) {
    const smoke = r.b === SMOKE;
    const key = smoke ? SMOKE : [r.b, r.m, r.s].join('\u0001');
    if (!at.has(key)) {
      at.set(key, groups.length);
      groups.push(smoke ? { smoke, b: SMOKE, m: '전 화면', s: '기본기능 스모크', rows: [] } : { smoke, b: r.b, m: r.m, s: r.s, rows: [] });
    }
    groups[at.get(key)].rows.push(r);
  }
  return [...groups.filter((g) => g.smoke), ...groups.filter((g) => !g.smoke)];
}

function verdictLine(kind) {
  if (kind === 'blocked') return '⛔ 판정 보류 — 기획 확인 필요. FAIL로 적지 말고 `BLOCKED(기획)` + 관측한 실제 동작을 메모';
  if (kind === 'later') return '⏭ `N/A(추후 구현)` — 실행하지 않는다';
  return '';
}

function fieldLines(label, items, numbered) {
  if (!Array.isArray(items) || !items.length) return [];
  if (!numbered && items.length === 1) return [`- ${label}: ${one(items[0])}`];
  return [`- ${label}:`, ...items.map((x, i) => `  ${numbered ? `${i + 1}.` : '-'} ${one(x)}`)];
}

// 다시 쓴 칸은 그때의 원문과 같이 저장된다. 확정본 문장이 그 뒤에 바뀌었으면(체인을 다시 돌리고 다시 쓰기는 건너뜀)
// 그 칸을 버린다 — 같은 번호의 다른 TC 에 엉뚱한 네 칸이 붙지 않게. 원문이 안 적힌 칸도 대 볼 수 없으니 버린다.
function rwState(rec, rw) {
  if (!rw) return '';
  const row = rw.rows && rw.rows[rec.id];
  if (row) return row['원문'] === rec.f ? 'done' : 'stale';
  return rw.fallback && rw.fallback[rec.id] ? 'fallback' : '';
}

function structureLines(rec, rw) {
  const st = rwState(rec, rw);
  if (st === 'done') {
    const done = rw.rows[rec.id];
    return [...fieldLines('전제', done['전제']), ...fieldLines('조작', done['조작'], true),
      ...fieldLines('기대', done['기대']), ...fieldLines('관측', done['관측'])];
  }
  if (st === 'fallback') return ['- 구조화: 없음 — 원문대로 실행 (다시 쓰기가 원문 보존 검사에 걸렸다)'];
  if (st === 'stale') return ['- 구조화: 없음 — 원문대로 실행 (다시 쓴 뒤에 원문이 바뀌었다)'];
  return [];
}

function tcBlock(rec, ctx, hdr) {
  const conf = ctx.conf.get(rec.id);
  const kind = noteKind(rec);
  const verdict = verdictLine(kind);
  const rules = (ctx.rules.get(rec.id) || []).slice(0, MAX_RULES_PER_TC);
  return [
    `${hdr} TC-${rec.id}`, '',
    `- 검증단계: ${rec.stage}`,
    `- 실행 플랫폼: ${platformsOf(rec).join(', ') || '없음'}`,
    `- 재현 스탭(원문): ${cont(rec.f)}`,
    ...structureLines(rec, ctx.rw),
    ...(verdict ? [`- 판정: ${verdict}`] : []),
    ...(kind === 'other' ? [`- 비고: ${one(rec.note)}`] : []),
    ...rules.map((m) => `- 근거 규칙 ${m.rule_id}: 「${one(m.text).slice(0, RULE_QUOTE_CHARS)}」`),
    ...(conf ? [`- 확신도: ${conf.grade}${LOW_GRADES.includes(conf.grade) ? ' (근거 약함 — FAIL이면 메모 첫머리에 `TC 근거 약함`)' : ''}`] : []),
    '',
  ];
}

function groupFile(g, i, ctx) {
  const file = `cases/${String(i + 1).padStart(2, '0')}_${slug(g.s)}.md`;
  const ids = g.rows.map((r) => r.id);
  const anchors = [...new Set(g.rows.flatMap((r) => (ctx.conf.get(r.id) || {}).anchors || []))];
  const L = ['---', `group: ${g.s}`, `path: [${[g.b, g.m, g.s].map((x) => JSON.stringify(x)).join(', ')}]`,
    `tc_ids: [${ids.map((x) => JSON.stringify(x)).join(', ')}]`, '---', '', `# ${g.s}`, '',
    `분류: ${g.b} › ${g.m} › ${g.s} · TC ${g.rows.length}건`];
  if (anchors.length) L.push(`근거 절: ${anchors.join(' · ')} (원문은 \`../spec.md\`)`);
  if (g.smoke) L.push('', '> 정상 동작 체크리스트다. 여기서 FAIL이 나면 같은 화면의 상세 그룹은 실행을 멈추고 먼저 보고한다.');
  L.push('');
  let sub = null;
  for (const r of g.rows) {
    if (g.smoke && `${r.m} › ${r.s}` !== sub) { sub = `${r.m} › ${r.s}`; L.push(`## ${sub}`, ''); }
    L.push(...tcBlock(r, ctx, g.smoke ? '###' : '##'));
  }
  const st = (k) => g.rows.filter((r) => k.includes(rwState(r, ctx.rw))).length;
  const stat = {
    file, g, n: g.rows.length, first: ids[0], last: ids[ids.length - 1],
    flagged: g.rows.filter((r) => noteKind(r) === 'blocked').length,
    lowConf: g.rows.filter((r) => LOW_GRADES.includes((ctx.conf.get(r.id) || {}).grade)).length,
    rewritten: st(['done']),
    fallback: st(['fallback', 'stale']),   // 원문대로 실행하는 행 전부
    stale: st(['stale']),
  };
  return { file, text: L.join('\n'), stat };
}

function renderSpec(spec, info, specHash) {
  const head = ['# 기획서 원문 (절 단위)', '',
    `> 출처: ${info.CONFLUENCE_URL || '입력 기획서'}${specHash ? ` · 해시 ${specHash}` : ''}. TC의 기대 결과가 애매하면 여기서 확인하고, 여기에도 없으면 판정하지 말고 \`BLOCKED(기획)\`로 적는다.`, ''];
  const slices = readJson(spec, 'slices.json');
  if (slices && Array.isArray(slices.sections)) return [...head, ...slices.sections.flatMap((s) => [`<!-- ${s.sec_id} -->`, String(s.text).trim(), ''])].join('\n');
  const raw = readText(spec, 'confluence_raw.md');
  return raw ? [...head, raw].join('\n') : null;
}

function renderResults(records) {
  return ['# 실행 결과', '', '판정 값: `PASS` · `FAIL` · `BLOCKED(기획|재현수단|환경)` · `N/A(사유)`. 실행 대상이 아닌 플랫폼 칸은 `-`.', '',
    '| TC | PC | 모바일 | 증거 (스크린샷·로그·DB 값) | 메모 |', '|---|---|---|---|---|',
    ...records.map((r) => `| ${r.id} | ${r.pc === 'N/A' ? '-' : ''} | ${r.mo === 'N/A' ? '-' : ''} |  |  |`)].join('\n') + '\n';
}

function readRules(dir) {
  const p = path.join(dir, RULES_FILE);
  if (!fs.existsSync(p)) throw new Error(`실행 규칙 파일 없음: ${p} — skills/tc-team-ai 설치를 확인`);
  return fs.readFileSync(p, 'utf8').replace(/<!--[\s\S]*?-->\s*/g, '').trim();
}

function confLine(confJ) {
  if (!confJ || !confJ.summary) return ' · 확신도 없음';
  const dist = Object.entries(confJ.summary.dist || {}).map(([k, v]) => `${k} ${v}`).join(' / ');
  return ` · 확신도 ${dist} (QA 섹션 ${confJ.summary.total}건 기준)`;
}

function renderIndex(m) {
  const sum = (k) => m.groups.reduce((a, x) => a + x.stat[k], 0);
  const excl = ((m.trace && m.trace.mapped) || []).filter((x) => x.status === 'excluded');
  const exclBy = excl.reduce((a, x) => ({ ...a, [x.exclusion]: (a[x.exclusion] || 0) + 1 }), {});
  const L = ['---', `format: ${FORMAT}`, `feature: ${m.feature}`, `spec_hash: ${m.specHash}`, `tc_total: ${m.records.length}`,
    `groups: ${m.groups.length}`, `rewritten: ${sum('rewritten')}`, `fallback: ${sum('fallback')}`,
    'source_of_truth: tcteam_tc_final.json (tc-team S5 게이트 통과본)', '---', '',
    `# ${m.feature} — AI 실행용 테스트 케이스`, '',
    '> tc-team 이 기획서에서 만들고 검수한 TC다. TC 번호와 재현 스탭 문장은 확정본 그대로다.', '',
    '## 1. 실행 규칙 (이 묶음을 받은 AI가 지킬 것)', '', m.rules, '',
    '## 2. 실행 순서', '', '| # | 파일 | 분류 | TC | 판정 보류 | 확신도 C·D | 구조화 |', '|---|---|---|---|---|---|---|',
    ...m.groups.map((x, i) => { const s = x.stat; return `| ${i + 1} | [${s.file}](${s.file}) | ${s.g.b} › ${s.g.m} | ${s.first}~${s.last} (${s.n}) | ${s.flagged || ''} | ${s.lowConf || ''} | ${s.rewritten}/${s.n} |`; }),
    '', `합계 TC ${m.records.length} · 판정 보류 ${sum('flagged')} · 구조화 ${sum('rewritten')} · 원문대로 ${sum('fallback')}${confLine(m.confJ)}`, '',
    `## 3. 판정 보류 사유 — 기획 확인 질문 (${m.questions.length}건)`, '',
    '아래 질문에 답이 오기 전까지 `판정 보류` 표시 TC는 `BLOCKED(기획)`이다.', '',
    ...m.questions.map((q, i) => `${i + 1}. ${q}`)];
  if (m.repro) L.push('', '### 재현 수단이 따로 필요한 상황', '', m.repro);
  L.push('', '## 4. 일부러 TC로 만들지 않은 원문 (참고)', '',
    `기획서 문장 ${m.trace && m.trace.summary ? m.trace.summary.rules : '?'}개 중 ${excl.length}개는 TC 대상이 아니라고 판정됐다 — ${Object.entries(exclBy).map(([k, v]) => `${k} ${v}`).join(' · ') || '없음'}. 이 부분은 검증하지 않는다.`, '',
    '## 5. 파일', '', '- `spec.md` — 기획서 원문(절 단위). 기대 결과가 애매할 때 여기서 확인', '- `cases/*.md` — 화면(소분류) 단위 TC', '- `results.md` — 실행 결과를 적는 표', '');
  return L.join('\n');
}

function writeCases(out, groups) {
  const dir = path.join(out, 'cases');
  fs.mkdirSync(dir, { recursive: true });
  // 지난 내보내기의 cases 는 지운다 — 소분류가 바뀌면 옛 파일이 남아 같은 TC 가 두 번 보인다(이 폴더는 이 도구의 출력 전용)
  fs.readdirSync(dir).filter((f) => f.endsWith('.md')).forEach((f) => fs.rmSync(path.join(dir, f)));
  groups.forEach((x) => fs.writeFileSync(path.join(out, x.file), x.text, 'utf8'));
}

function exportBundle({ spec, out = path.join(spec, 'ai_bundle'), rulesDir = resolveRulesDir() }) {
  const { records } = readFinal(spec);
  const rules = readRules(rulesDir);
  const design = readText(spec, 'tc_design.md') || '';
  const confJ = readJson(spec, 'ai_confidence.json');
  const trace = readJson(spec, 'traceability.json');
  const ruleLinks = rulesByTc(spec, records, trace);
  const ctx = { rw: readJson(spec, 'ai_rewrite.json'), conf: new Map(((confJ && confJ.items) || []).map((i) => [i.tcid, i])), rules: ruleLinks.map };
  const info = sheetInfo(spec);
  const feature = info.FEATURE_NAME || path.basename(spec);
  const specHash = (design.match(/기획서 해시\s*\|\s*([0-9a-f]+)/) || [])[1] || '';
  const groups = groupRecords(records).map((g, i) => groupFile(g, i, ctx));

  writeCases(out, groups);
  const specMd = renderSpec(spec, info, specHash);
  if (specMd) fs.writeFileSync(path.join(out, 'spec.md'), specMd, 'utf8');
  const resultsPath = path.join(out, 'results.md');
  const resultsKept = fs.existsSync(resultsPath);
  if (!resultsKept) fs.writeFileSync(resultsPath, renderResults(records), 'utf8');
  const questions = planningQuestions(design);
  const repro = section(design, '재현 수단 필요 항목', 3);
  fs.writeFileSync(path.join(out, 'INDEX.md'), renderIndex({ feature, specHash, records, groups, rules, questions, repro, trace, confJ }), 'utf8');

  const sum = (k) => groups.reduce((a, x) => a + x.stat[k], 0);
  return { feature, tc: records.length, groups: groups.length, flagged: sum('flagged'), rewritten: sum('rewritten'),
    fallback: sum('fallback'), stale: sum('stale'), questions: questions.length, confidence: Boolean(confJ), results_kept: resultsKept,
    rule_links_unmapped: ruleLinks.unmapped, out };
}

module.exports = { exportBundle, planningQuestions, section, firstTable };

if (require.main === module) {
  const args = process.argv.slice(2);
  const ri = args.indexOf('--rules');
  const rulesDir = ri >= 0 ? args[ri + 1] : resolveRulesDir();
  const [spec, out] = args.filter((a, i) => a !== '--rules' && args[i - 1] !== '--rules');
  if (!spec) { console.error('사용: node md_export.js <specs/기능명 폴더> [출력 폴더] [--rules <규칙 서랍>]'); process.exit(1); }
  try {
    console.log(JSON.stringify(exportBundle({ spec, out: out || path.join(spec, 'ai_bundle'), rulesDir })));
  } catch (e) { console.error(`[내보내기] ✗ ${e.message}`); process.exit(2); }
}
