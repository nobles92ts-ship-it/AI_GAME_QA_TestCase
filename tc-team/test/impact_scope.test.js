'use strict';
// impact_scope.js self 노드 해결 — 그 문서 **자신의 머리말 출처 줄**에서만 self 를 잡고, id 를 언급만 한 문서로 되돌아가지 않는다
// (2026-09-11 실측: Vault 미등재 스킬_강화_시스템(424509531)이 그 id 를 본문 근거로 적은 「아이템 Index 사용 및 구분 정책」으로
//  오해결 → 남의 이웃 23건이 접점 축으로 승격. 경고는 `self 제목 불일치 의심` 한 줄뿐이었다)
// 스크립트를 실제로 돌린다 — Vault·그래프·스펙은 전부 임시 폴더 픽스처(실제 DXR_Vault·그래프·스펙 폴더 무접촉).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCOPE = path.join(__dirname, '..', 'lib', 'impact_scope.js');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  PASS ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' — ' + e.message); } }

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'impscope-'));
const VAULT = path.join(root, 'vault');
const GRAPH = path.join(root, 'graph.json');
const W = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s, 'utf8'); };
const filler = Array.from({ length: 20 }, (_, i) => `- 본문 규칙 ${i + 1}`).join('\n');   // 뒤 줄을 머리말(15줄) 밖으로 민다

console.log('impact_scope 테스트 (self 노드 해결 — 머리말 출처 줄만, 본문 참조 fallback 금지)');

// ── Vault 픽스처 — a_ref/ 가 b_own/ 보다 먼저 읽힌다(옛 fallback 은 먼저 읽힌 참조 문서를 골랐다) ──
// Vault 실측 머리말 출처 줄 형식(2026-09-11 · 453문서)
const FORMATS = [
  ['A_confluence', '> Confluence: https://x.atlassian.net/wiki/spaces/DX/pages/700000001'],
  ['A_live', '> Confluence (live): https://x.atlassian.net/spaces/DX/pages/700000002 · v35'],
  ['B_page_id', '- page_id: 700000003'],
  ['B_bold_page_id', '- **page_id**: 700000004'],
  ['B_url', '- URL: https://x.atlassian.net/wiki/spaces/DX/pages/700000005/Title'],
  ['B_space_ID', '- **Page ID**: 700000006'],   // 이름을 B_page_id 와 대소문자만 다르게 두면 Windows 에선 같은 파일이다
  ['B_source', '- source: https://x.atlassian.net/wiki/spaces/DX/pages/700000007'],
  ['B_원본', '- **원본**: https://x.atlassian.net/wiki/spaces/DX/pages/700000008'],
  ['B_출처', '- **출처**: https://x.atlassian.net/wiki/spaces/DX/pages/700000009'],
  ['B_bare_bold', '**page_id**: 700000010'],
];
const fmtId = (i) => String(700000001 + i);
W(path.join(VAULT, 'a_ref', '형식 참조 모음.md'),
  `# 형식 참조 모음\n> Confluence: https://x/pages/700000099\n\n${filler}\n${FORMATS.map((_, i) => `- 연관 문서 ${fmtId(i)}`).join('\n')}\n`);
FORMATS.forEach(([name, line]) => W(path.join(VAULT, 'b_own', `fmt_${name}.md`), `# 형식 ${name}\n\n## 관련 시스템\n- [[이웃]]\n\n${line}\n\n${filler}\n`));

// 실측 재현: 이 문서 자신은 285016066 이고, 424509531 은 15줄 밖 본문 근거 줄에만 있다(그 줄에 'Confluence' 도 있다)
W(path.join(VAULT, 'a_ref', '아이템 Index 사용 및 구분 정책.md'),
  `# 아이템 Index 사용 및 구분 정책\n\n## 관련 시스템\n- [[아이템_귀속_시스템]]\n\n**page_id**: 285016066\n**URL**: https://x/pages/285016066/Index\n\n${filler}\n> 근거: [[스킬_강화_시스템]] (Confluence 424509531 — vault 미등재, 검토위임 백로그).\n`);
// 부위_파괴_시스템 실측: 먼저 읽히는 문서가 id 를 언급 → 옛 fallback 이 그걸 self 로 골랐다
W(path.join(VAULT, 'a_ref', '중간 보스 HP바.md'), `# 중간 보스 HP바\n> Confluence: https://x/pages/222000001\n\n${filler}\n- 부위 파괴 연동은 311853067 참조\n`);
W(path.join(VAULT, 'b_own', '부위파괴 시스템.md'), `# 부위파괴 시스템\n\n## 관련 시스템\n- [[Boss_0002]]\n\n- **page_id**: 311853067\n- **URL**: https://x/pages/311853067\n`);
// 2026-09-05 회귀: 부모 컨테이너가 자식 목록에 자식 id 를 적었다(머리말 안이지만 출처 줄이 아니다)
W(path.join(VAULT, 'a_ref', '버프_디버프.md'), `# 버프/디버프\n> Confluence: https://x/pages/111000001\n\n## 하위 문서\n- 버프/디버프 정의 (111000002)\n`);
W(path.join(VAULT, 'b_own', '버프_디버프_정의.md'), `# 버프/디버프 정의\n> Confluence: https://x/pages/111000002\n`);
// 머리말 산문 속 남의 id — 'Confluence' 가 든 줄이지만 출처 줄이 아니다(Vault 실물 「버프_디버프_아이콘_UI」)
W(path.join(VAULT, 'a_ref', '버프_디버프_아이콘_UI.md'),
  `# 버프 디버프 아이콘 UI\n> Confluence: https://x/pages/333000001\n> 📌 상위 규칙은 [[버프_디버프_정의]], CC 연출 우선순위는 Confluence 「상태이상 시스템」(443449460)에 있다.\n`);
// 숫자 경계: 555666777 안에 55666777 이 들어 있다
W(path.join(VAULT, 'a_ref', '경계 문서.md'), `# 경계 문서\n> Confluence: https://x/pages/555666777\n`);

const nodes = ['아이템 Index 사용 및 구분 정책', '센티넬 Index 사용 및 구분 정책', '아바타 Index 사용 및 구분 정책',
  '부위파괴 시스템', 'Boss_0002', '중간 보스 HP바', 'HP바 UI', '버프_디버프_정의', '보스 CC 면역', '버프_디버프_아이콘_UI', '이펙트 목록'];
const edges = [['아이템 Index 사용 및 구분 정책', '센티넬 Index 사용 및 구분 정책'], ['아이템 Index 사용 및 구분 정책', '아바타 Index 사용 및 구분 정책'],
  ['부위파괴 시스템', 'Boss_0002'], ['중간 보스 HP바', 'HP바 UI'], ['버프_디버프_정의', '보스 CC 면역'], ['버프_디버프_아이콘_UI', '이펙트 목록']];
W(GRAPH, JSON.stringify({ generated: 'fixture', nodes: nodes.map((id) => ({ id })), edges: edges.map(([s, t]) => ({ s, t, type: 'wikilink' })) }));

function run(spec, id, extra = []) {
  const dir = path.join(root, 'specs', spec);
  W(path.join(dir, 'confluence_raw.md'), `# ${spec}\n**페이지 ID**: ${id}\n\n---\n본문 — 강화 재료와 스킬 스톤을 쓴다.\n`);
  const out = path.join(root, 'out', `${spec}.json`);
  const r = spawnSync(process.execPath, [SCOPE, dir, '--vault', VAULT, '--graph', GRAPH,
    '--aliases', path.join(root, 'no_aliases.json'), '--out', out, '--quiet', ...extra], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, `exit ${r.status} (미해결도 exit 0 이어야 한다 — 비차단): ${r.stderr}`);
  return JSON.parse(fs.readFileSync(out, 'utf8'));
}
const warned = (j, prefix) => j.warnings.some((w) => w.startsWith(prefix));

t('본문에서만 id 를 언급한 문서는 self 가 아니다 → 미해결 · 후보 0 · 참조 문서를 경고로 (스킬_강화_시스템 실측)', () => {
  const j = run('스킬_강화_시스템', '424509531');
  assert.strictEqual(j.self_node, null, `self=${j.self_node}`);
  assert.deepStrictEqual(j.counts, { hop1: 0, hop2: 0, promoted: 0, alias_promoted: 0, reference: 0 });
  assert.ok(warned(j, 'self 노드 미해결 (pageId=424509531)'), j.warnings.join(' | '));
  assert.ok(warned(j, '본문 참조만 발견: 아이템 Index 사용 및 구분 정책 —'), j.warnings.join(' | '));
});

t('출처 줄이 있는 문서가 id 를 먼저 언급한 문서를 이긴다 (부위_파괴_시스템 실측)', () => {
  const j = run('부위_파괴_시스템', '311853067');
  assert.strictEqual(j.self_node, '부위파괴 시스템');
  assert.strictEqual(j.counts.hop1, 1);
  assert.ok(!warned(j, '본문 참조만 발견'), j.warnings.join(' | '));
});

for (const [i, [name, line]] of FORMATS.entries()) {
  t(`머리말 출처 줄 형식 인식 — ${name}: \`${line.slice(0, 32)}…\``, () => {
    assert.strictEqual(run(`fmt_${name}`, fmtId(i)).self_node, `fmt_${name}`);
  });
}

t('부모 컨테이너가 자식 id 를 목록에 적어도 자식이 self 다 (2026-09-05 버프/디버프 정의 회귀)', () => {
  assert.strictEqual(run('버프디버프', '111000002').self_node, '버프_디버프_정의');
});

t("머리말 산문 속 남의 id 는 출처가 아니다 ('Confluence' 가 든 줄이어도)", () => {
  const j = run('상태이상_시스템', '443449460');
  assert.strictEqual(j.self_node, null, `self=${j.self_node}`);
  assert.ok(warned(j, '본문 참조만 발견: 버프_디버프_아이콘_UI —'), j.warnings.join(' | '));
});

t('id 는 숫자 경계로 맞춘다 — 짧은 id 가 긴 id 의 일부로 잡히지 않는다', () => {
  const j = run('경계_검사', '55666777');
  assert.strictEqual(j.self_node, null, `self=${j.self_node}`);
  assert.ok(!warned(j, '본문 참조만 발견'), j.warnings.join(' | '));
});

t('--node 강제 지정은 해결을 건너뛴다 (참조 경고도 없다)', () => {
  const j = run('강제_지정', '424509531', ['--node', '강제노드']);
  assert.strictEqual(j.self_node, '강제노드');
  assert.ok(!warned(j, '본문 참조만 발견'), j.warnings.join(' | '));
});

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
