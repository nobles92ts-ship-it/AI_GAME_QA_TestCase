// render_design.js — 전개기 출력 → tc_design.md 결정론 렌더 (Phase C 핵심)
// 트리·배분표가 "LLM이 따로 쓴 두 문서"가 아니라 같은 케이스 배열의 두 projection이 됨
//   → 배분표 3자 동치·P-20·복합문 검사가 구성상 항상 통과 (삭제 후보의 근거)
// 산출 계약: parseDesignTree(strict) + parseBasicTable + checkAllotmentStrict + direct_convert convert를
//   exit 0으로 통과하는 tc_design.md 텍스트.
// 기본기능 표는 전개기 비범위(설계자 작성) — basic_rows.json으로 주입.
// CLI: node render_design.js <candidates.json> <expanded_cases.json> [--basic <basic_rows.json>] [--out <file>]

const fs = require('fs');

const STAGE_ORDER = ['정상', '부정', '예외'];

function render(candidates, expanded, basicRows = []) {
  const feature = candidates.meta.feature;
  const subDefaults = (s) => ({
    cat1: s.cat1 || `${feature} 검증`,
    cat2: s.cat2 || s.name,
    risk: s.risk || 'MEDIUM',
    platform: s.platform || 'PC/모바일',
  });
  const subs = candidates.subcats.map((s) => ({ key: s.key, name: s.name, ...subDefaults(s) }));
  const byKey = new Map(subs.map((s) => [s.key, s]));

  // 소분류별 케이스 그룹 (expanded는 이미 subcats 입력 순서로 정렬됨)
  const grouped = new Map(subs.map((s) => [s.key, []]));
  for (const c of expanded.cases) grouped.get(c.subcat).push(c);

  const L = [];
  L.push(`# DX-${feature} — TC 설계 (tc_design.md)`);
  L.push('');
  L.push(`> 결정론 전개기 렌더 (${expanded.meta.expander} / 생성기 ${expanded.meta.generators.join('·')}) — 트리·배분표는 동일 케이스 배열의 projection`);
  L.push('');

  // ── 기본기능 검증 항목 ──
  L.push('## 기본기능 검증 항목');
  L.push('');
  L.push('| 대분류 | 중분류 | 소분류 | 검증단계 | 검증 내용 | 플랫폼 |');
  L.push('|--------|--------|--------|----------|-----------|--------|');
  for (const r of basicRows) {
    L.push(`| ${r.cat1 || '기본기능'} | ${r.cat2 || ''} | ${r.cat3} | ${r.stage} | ${r.text} | ${r.platform || 'PC'} |`);
  }
  L.push('');

  // ── 분류 그룹핑 트리 ── (cat1 → cat2 → 소분류 → leaf, 전부 입력 순서 고정)
  L.push('## 분류 그룹핑 트리');
  L.push('');
  let cat1No = 0, cat2No = 0;
  let curCat1 = null, curCat2 = null;
  for (const s of subs) {
    const cases = grouped.get(s.key);
    if (!cases.length) continue; // 케이스 0 소분류는 트리 미등재 (배분표에도 없음 — 0값 사유 검사 불요)
    if (s.cat1 !== curCat1) { cat1No++; cat2No = 0; curCat1 = s.cat1; curCat2 = null; L.push(`${cat1No}. **${s.cat1}**`); L.push(''); }
    if (s.cat2 !== curCat2) { cat2No++; curCat2 = s.cat2; L.push(`${cat1No}.${cat2No} ${s.cat2} (중분류)`); L.push(''); }
    L.push(`- ${s.name} [${s.risk}] [${s.platform}]`);
    const seq = { 정상: 0, 부정: 0, 예외: 0 };
    for (const stage of STAGE_ORDER) {
      for (const c of cases) {
        if (c.stage !== stage) continue;
        seq[stage]++;
        L.push(`→ ${stage}-${seq[stage]}: ${c.purpose}`);
      }
    }
    L.push('');
  }

  // ── 검증단계 사전 배분표 ── (트리와 같은 배열 projection — 행 재합산 = leaf 수 항상 성립)
  L.push('## 검증단계 사전 배분표');
  L.push('');
  L.push('| 대분류 | 중분류 | 소분류 | 정상 | 부정 | 예외 |');
  L.push('|--------|--------|--------|------|------|------|');
  const tot = { 정상: 0, 부정: 0, 예외: 0 };
  for (const s of subs) {
    const cases = grouped.get(s.key);
    if (!cases.length) continue;
    const n = { 정상: 0, 부정: 0, 예외: 0 };
    for (const c of cases) n[c.stage]++;
    for (const st of STAGE_ORDER) tot[st] += n[st];
    L.push(`| ${s.cat1} | ${s.cat2} | ${s.name} | ${n.정상} | ${n.부정} | ${n.예외} |`);
  }
  L.push(`| 합계 |  |  | ${tot.정상} | ${tot.부정} | ${tot.예외} |`);
  L.push('');
  return L.join('\n');
}

module.exports = { render };

if (require.main === module) {
  const args = process.argv.slice(2);
  const [candFile, expFile] = args;
  if (!candFile || !expFile) {
    console.error('usage: node render_design.js <candidates.json> <expanded_cases.json> [--basic <basic_rows.json>] [--out <file>]');
    process.exit(1);
  }
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  let candidates, expanded, basicRows = [];
  try {
    candidates = JSON.parse(fs.readFileSync(candFile, 'utf8'));
    expanded = JSON.parse(fs.readFileSync(expFile, 'utf8'));
    const b = opt('--basic');
    if (b) basicRows = JSON.parse(fs.readFileSync(b, 'utf8'));
  } catch (e) { console.error(`read/parse 실패: ${e.message}`); process.exit(1); }

  const md = render(candidates, expanded, basicRows);
  const out = opt('--out');
  if (out) { fs.writeFileSync(out, md, 'utf8'); console.log(JSON.stringify({ ok: true, out, bytes: md.length })); }
  else process.stdout.write(md);
  process.exit(0);
}
