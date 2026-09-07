#!/usr/bin/env node
/**
 * impact_scope.js — 기획서 영향 범위(접점 축) 결정론 추출기 (2026-09-05 신설)
 *
 * 배경: tc-team 의 뇌 대조(tc-대조)는 `ctx_search` **FTS 텍스트 검색만** 쓴다. DXR_관리가 이미
 *   결정론으로 만들어 두는 **위키링크 그래프**(`_그래프.json` 397노드/2193 wikilink 엣지)와
 *   **2-hop 영향도**(`_DXR_영향도.md`)는 파이프라인에 배선된 적이 없다. 그래서 "이 기획서가 바뀌면
 *   어떤 시스템과 만나는가"가 **LLM 질의 운**에 걸려 있었다(2026-08-19 실측: 24질의 전멸 → 짧게
 *   재질의하니 keep 25 → locate 17/discover 2 로 판정이 통째로 뒤집힘).
 *
 * 정책 — 후보는 넓게, 승격은 본문 근거로만:
 *   ① 후보 = self 의 **1-hop ∪ 2-hop**. 1-hop 만으로는 부족하다는 것이 실측됐다
 *      (버프/디버프 실측: 손으로 뽑은 접점 5축 중 PK·파티 **2축이 2-hop 에만** 있었다 = 1-hop 재현율 40%대).
 *   ② 승격 — hop 별로 기준이 다르다:
 *      · **1-hop = 전부 승격.** 본문이 실제로 링크한 문서라 직접 인접 자체가 접점 근거다(실측 5건).
 *      · **2-hop = 본문 근거가 있어야 승격.** 후보 제목의 토큰이 ⓐ**희소하고**(df ≤ max-df: 그 토큰이
 *        쓰인 노드 제목 수) ⓑ**본문에 min-hits2 회 이상** 등장할 때만. 등장하지 않으면 참고 목록에만 남긴다
 *        — `tc-분석 §3.8 범위 확장 금지`를 깨지 않는 유일한 길이다(근거가 링크가 아니라 **본문**).
 *      ⚠ df 를 빼면 무너진다 — 2026-09-05 실측: 희소도 없이 돌리니 '스킬×15'·'전투×25' 같은 도메인
 *        흔한말이 다 통과해 **26건 중 23건이 승격**됐다(남자_가디언_스킬·여자_소서러_스킬까지).
 *   ③ 별칭 = 개념은 본문에 있는데 제목 토큰만 다른 경우만, **사람이 승인한** `impact_aliases.json` 으로 구제.
 *      실측: 본문에 'PK' 0건이지만 '적대/상대방/플레이어'로 PvP 접점이 명백. 자동 확장 금지.
 *
 * 실측 (2026-09-05, 버프/디버프 · 정답지 = 사람이 손으로 뽑은 접점 5축):
 *   후보 40건(hop1 6 + hop2 34) → 승격 21 / 참고 19.
 *   · **재현율 4/4** — 그래프와 무관한 1축(전투자원=본문 규칙)을 뺀 4축을 전부 잡았다.
 *     보스CC면역·UI(hop1) · 파티(hop2 token) · PK(hop2 **별칭**).
 *   · `--max-df 5` 였을 때는 **파티(df=12)·HUD(df=6)가 문턱에 걸려 탈락**해 3/4 였다 → 기본값 12로 상향.
 *   · 오탐 ~6건(카메라_제어_기능·장비_강화_시스템·여자_프리스트_스킬 등) = 정밀도 약 71%.
 *     '제어'·'강화'처럼 **본문에서 일반 동사로 쓰인 말**은 bag-of-words 로 못 거른다 — 알려진 한계다.
 *
 * ⚠ 이 도구는 **비차단**이며 **자동 확정이 아니다.** 승격 목록은 근거(term×횟수)를 달고 나오는 **순위 후보**다.
 *   설계자가 근거를 보고 고르는 것이 전제이고, 실제 TC 는 본문 근거 문장으로 쓴다.
 *   397노드 → 40후보 → 21건(근거 포함)까지 좁히는 것이 이 도구의 몫이다.
 * ⚠ self 노드가 그래프에 없으면(= Vault 미색인) 후보 0건이 정상 출력이다. 그때는 색인부터 해결해야 한다
 *   (2026-09-05 실측: 「버프/디버프 정의」가 인박스에 14일 대기 중이라 노드 자체가 없었다).
 *
 * 사용: node impact_scope.js <SPEC_DIR> [--out <impact_scope.json>] [--node <노드id 강제지정>]
 *                            [--graph <_그래프.json>] [--vault <DXR_Vault>] [--aliases <impact_aliases.json>]
 *                            [--max-df 12] [--min-hits2 3] [--hop1-only] [--hub-warn 25] [--quiet]
 * exit 0=정상(후보 0건 포함) / 2=인자·입력 오류
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_GRAPH = '{WORK_ROOT}/<프로젝트>_관리/_그래프.json';
const DEFAULT_VAULT = '{WORK_ROOT}/DXR_Vault';
const DEFAULT_ALIASES = '{PROJECT_ROOT}/team/impact_aliases.json';

// 제목에 흔한 범용어 — 이것만 맞았다고 접점이라 할 수 없다.
const STOPWORDS = new Set([
  '시스템', '기능', '개선', '추가', '정리', '구현', '방향성', '가칭', '관리', '사양서',
  '문서', '빌드', '신규', '수정', '적용', '설정', '표시', '처리', '정의', '전용', '기준',
  '및', '차', '월', '변경', '작성', '중', '홀드', '초안', '연출',
]);

function die(msg) { console.error(`[impact_scope] ${msg}`); process.exit(2); }

function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

/** 기획서에서 Confluence pageId 를 뽑는다 (헤더 메타 → sheet_info.txt 순). */
function findPageId(specDir, raw) {
  let m = raw.match(/\*\*페이지 ID\*\*:\s*(\d+)/);
  if (m) return m[1];
  const si = path.join(specDir, 'sheet_info.txt');
  if (fs.existsSync(si)) {
    m = fs.readFileSync(si, 'utf8').match(/pages\/(\d+)/);
    if (m) return m[1];
  }
  m = raw.match(/\/pages\/(\d+)/);
  return m ? m[1] : null;
}

/**
 * pageId 를 담고 있는 Vault 문서를 찾아 그래프 노드 id(= 파일명)로 되돌린다.
 * ⚠ 본문 아무 데나 있는 id 로 잡으면 안 된다 — 부모 컨테이너가 자식 목록에 자식 id 를 적어두면
 *   부모가 self 로 잡힌다(2026-09-05 실측: 「버프/디버프 정의」가 「버프/디버프」로 오해결).
 *   그 문서 **자신의 출처 표기**(머리말 Confluence 줄)에서만 찾는다.
 */
function resolveSelfNode(vault, pageId) {
  if (!pageId || !fs.existsSync(vault)) return null;
  const fallback = [];
  for (const f of walk(vault, [])) {
    if (f.includes(`${path.sep}specs${path.sep}`)) continue;  // TC 산출물은 위키 정의가 아니다
    let text;
    try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
    if (!text.includes(pageId)) continue;
    const head = text.split('\n').slice(0, 15);
    const own = head.some((l) => /Confluence/i.test(l) && l.includes(pageId));
    if (own) return path.basename(f, '.md');
    fallback.push(path.basename(f, '.md'));
  }
  return fallback[0] || null;
}

function tokenize(nodeId) {
  return nodeId
    .split(/[_\s\-·,()[\]{}/|]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !/^\d+$/.test(t) && !STOPWORDS.has(t));
}

function countHits(body, term) {
  if (!term) return 0;
  return body.split(term).length - 1;
}

// ── main ──────────────────────────────────────────────────────────────────
const specDir = process.argv[2];
if (!specDir || specDir.startsWith('--')) die('사용: node impact_scope.js <SPEC_DIR> [--out <path>]');
if (!fs.existsSync(specDir)) die(`SPEC_DIR 없음: ${specDir}`);

const rawPath = path.join(specDir, 'confluence_raw.md');
if (!fs.existsSync(rawPath)) die(`confluence_raw.md 없음: ${rawPath}`);
const raw = fs.readFileSync(rawPath, 'utf8');

// 헤더 메타([미수집:/[링크수집: 등)는 본문이 아니다 — 첫 --- 이후만 본문으로 본다.
const sep = raw.indexOf('\n---');
const body = sep > -1 ? raw.slice(sep) : raw;

const graphPath = arg('--graph', DEFAULT_GRAPH);
const vault = arg('--vault', DEFAULT_VAULT);
const aliasPath = arg('--aliases', DEFAULT_ALIASES);
// hop2 승격 임계 — 둘 다 만족해야 한다. 느슨하게 두면 도메인 흔한말(스킬·전투)로 전부 통과한다.
const maxDf = parseInt(arg('--max-df', '12'), 10);    // 토큰이 쓰인 노드 제목 수 상한(희소할수록 식별력)
const minHits2 = parseInt(arg('--min-hits2', '3'), 10); // 본문 등장 횟수 하한
const hop1Only = process.argv.includes('--hop1-only');
// 허브 문서 경고선 — 이보다 많으면 축으로 쓰기엔 넓다(2026-09-05 회귀: PK_시스템 hop2=98 → 승격 56건).
const hubWarn = parseInt(arg('--hub-warn', '25'), 10);
const quiet = process.argv.includes('--quiet');
const outPath = arg('--out', path.join(specDir, 'impact_scope.json'));

if (!fs.existsSync(graphPath)) die(`그래프 없음: ${graphPath}`);
const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));

let aliases = {};
if (fs.existsSync(aliasPath)) {
  for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(aliasPath, 'utf8')))) {
    if (!k.startsWith('_') && v && Array.isArray(v.terms)) aliases[k] = v;
  }
}

const pageId = findPageId(specDir, raw);
const self = arg('--node', null) || resolveSelfNode(vault, pageId);

// 인접(위키링크만 — similarity 는 2026-05-10 스냅샷이라 신규 페이지 무커버)
const adj = new Map();
const add = (a, b) => { if (!adj.has(a)) adj.set(a, new Set()); adj.get(a).add(b); };
for (const e of graph.edges || []) {
  if (e.type && e.type !== 'wikilink') continue;
  const s = e.s || e.source, t = e.t || e.target;
  if (s && t) { add(s, t); add(t, s); }
}

const result = {
  generated: new Date().toISOString().slice(0, 10),
  spec_dir: specDir,
  page_id: pageId,
  self_node: self,
  graph: { path: graphPath, generated: graph.generated || null, nodes: (graph.nodes || []).length },
  counts: { hop1: 0, hop2: 0, promoted: 0, alias_promoted: 0, reference: 0 },
  promoted: [],
  reference: [],
  warnings: [],
};

// self 제목이 스펙 폴더명과 전혀 안 겹치면 오해결 의심 — 페이지 리네임·1스펙 다페이지에서 실제로 발생한다
// (2026-09-05 회귀: specs/부위_파괴_시스템 → self='중간 보스 및 엘리트 몬스터 전용 HP바').
if (self) {
  // 구분자만 다른 같은 이름을 오탐하지 않도록 정규화 포함관계를 먼저 본다
  // ('버프디버프' 폴더 vs '버프_디버프_정의' 노드는 같은 대상이다).
  const norm = (s) => s.replace(/[_\s\-·,()[\]{}/|]+/g, '');
  const a = norm(path.basename(specDir)), b = norm(self);
  const specTokens = new Set(tokenize(path.basename(specDir)));
  const selfTokens = tokenize(self);
  const related = a.includes(b) || b.includes(a) || selfTokens.some((t) => specTokens.has(t));
  if (specTokens.size && !related) {
    result.warnings.push(`self 제목 불일치 의심: 스펙 폴더 '${path.basename(specDir)}' vs 노드 '${self}' (pageId=${pageId}). 페이지 개명이거나 다른 문서일 수 있다 — --node 로 강제 지정 가능.`);
  }
}

if (!self) {
  result.warnings.push(`self 노드 미해결 (pageId=${pageId}). Vault 에 이 페이지의 .md 가 없다 — 색인(인박스 판정)부터 해결해야 한다.`);
} else if (!adj.has(self)) {
  result.warnings.push(`self 노드 '${self}' 가 그래프에 없다. 그래프 재생성(_regen_integrated_assets.py) 필요.`);
} else {
  const hop1 = adj.get(self);
  const hop2 = new Set();
  if (!hop1Only) {
    for (const n of hop1) for (const m of adj.get(n) || []) hop2.add(m);
    for (const n of hop1) hop2.delete(n);
    hop2.delete(self);
  }
  result.counts.hop1 = hop1.size;
  result.counts.hop2 = hop2.size;

  // 토큰 희소도(df) — 그래프 전체 노드 제목에서 그 토큰이 몇 개 문서 이름에 쓰였나.
  // '스킬'·'전투'처럼 수십 개 제목에 들어가는 토큰은 접점을 식별하지 못한다(2026-09-05 실측:
  // df 무시 시 hop2 에서 남자_가디언_스킬·여자_소서러_스킬까지 승격돼 26건 중 23건이 통과했다).
  const df = new Map();
  for (const n of graph.nodes || []) {
    for (const t of new Set(tokenize(n.id || ''))) df.set(t, (df.get(t) || 0) + 1);
  }

  const rows = [];
  for (const [set, hop] of [[hop1, 1], [hop2, 2]]) {
    for (const node of set) {
      const hits = tokenize(node)
        .map((t) => ({ term: t, n: countHits(body, t), df: df.get(t) || 0 }))
        .filter((h) => h.n > 0)
        .sort((a, b) => b.n - a.n);
      const row = { node, hop, evidence: hits, via: null };
      if (hop === 1) {
        // 1-hop = 본문이 실제로 링크한 문서. 직접 인접 자체가 접점 근거다.
        row.via = 'hop1';
      } else if (hits.some((h) => h.df > 0 && h.df <= maxDf && h.n >= minHits2)) {
        row.via = 'token';
        row.evidence = hits.filter((h) => h.df <= maxDf && h.n >= minHits2).concat(hits.filter((h) => !(h.df <= maxDf && h.n >= minHits2)));
      } else if (aliases[node]) {
        const ah = aliases[node].terms
          .map((t) => ({ term: t, n: countHits(body, t) }))
          .filter((h) => h.n > 0)
          .sort((a, b) => b.n - a.n);
        if (ah.length) { row.via = 'alias'; row.evidence = ah; row.alias_note = aliases[node].note; }
      }
      rows.push(row);
    }
  }
  rows.sort((a, b) => (a.hop - b.hop) || ((b.evidence[0]?.n || 0) - (a.evidence[0]?.n || 0)));
  for (const r of rows) {
    if (r.via) { result.promoted.push(r); if (r.via === 'alias') result.counts.alias_promoted++; }
    else result.reference.push({ node: r.node, hop: r.hop });
  }
  result.counts.promoted = result.promoted.length;
  result.counts.reference = result.reference.length;
  if (result.counts.promoted > hubWarn) {
    result.warnings.push(`승격 ${result.counts.promoted}건 — 허브형 기획서다(hop2=${result.counts.hop2}). 이 규모는 접점 축으로 쓰기엔 넓다. \`--hop1-only\` 로 직접 인접만 보거나, 설계자가 근거(term×횟수) 상위만 채택할 것.`);
  }
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');

if (!quiet) {
  const c = result.counts;
  console.log(`[impact_scope] self=${self || '미해결'} pageId=${pageId} | hop1=${c.hop1} hop2=${c.hop2}`);
  console.log(`[impact_scope] 승격 ${c.promoted}건(별칭 ${c.alias_promoted}) / 참고 ${c.reference}건`);
  for (const r of result.promoted) {
    const ev = r.evidence.slice(0, 3).map((e) => `${e.term}×${e.n}`).join(', ');
    console.log(`   [승격 hop${r.hop}] ${r.node}  ← ${r.via}: ${ev}`);
  }
  if (result.reference.length) {
    console.log(`   [참고] ${result.reference.map((r) => `${r.node}(h${r.hop})`).join(', ')}`);
  }
  for (const w of result.warnings) console.log(`   ⚠ ${w}`);
  console.log(`[impact_scope] → ${outPath}`);
}
process.exit(0);
