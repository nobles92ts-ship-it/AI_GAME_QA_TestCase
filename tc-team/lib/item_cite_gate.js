#!/usr/bin/env node
/**
 * item_cite_gate.js — 아이템 실명 병기 게이트 (2026-08-13 신설)
 *
 * 배경: `item_dict.js` 로 사전을 만들고 규칙을 산문으로 써 놨더니, **그 규칙이 어느 단계에서도
 *   집행되지 않는 구멍**이 같은 날 발견됐다(S3 문장화가 사전을 읽지 않아 병기가 소멸할 수 있었다).
 *   산문 규칙은 조용히 안 먹는다 — 그래서 판정 가능한 부분을 코드로 내린다.
 *
 * 정책 — **"언제 병기가 필요한가"의 판정 중 결정론으로 확정되는 것만 확정하고, 문맥이 필요한 것은 후보로 넘긴다.**
 *
 *   필요/불필요는 2축으로 갈린다(규칙 SSoT = rules/tc-설계.md §아이템 실명 병기):
 *     축1 준비물 — 이 행을 실행하려면 테스터가 그 아이템을 직접 골라 손에 들어야 하는가
 *     축2 분기   — 어떤 개체를 고르느냐가 기대결과·경로를 바꾸는가
 *   두 축 판정은 원문·분류 문맥이 필요하므로 **LLM(설계자·quality 렌즈)의 일**이다.
 *   반면 아래 3종은 문맥 없이 참·거짓이 정해진다 → 여기서 확정한다.
 *
 * 확정 위반 3종:
 *   ① placeholder_no_index (HIGH) — **인용된 표시명**이 여러 아이템이 공유하는 이름인데 Index 가 없다.
 *      실측: 제작 레시피 재료 60종이 NameCode 를 공유해 표시명이 전부 "제작 재료 임시 명칭" 이다.
 *      이름만 적으면 60종 중 무엇인지 알 수 없으므로 병기가 있어도 목적을 달성하지 못한다.
 *      ⚠ 판정 기준은 **인용된 개체**다. 유형 기준으로 보면 오탐이 난다 — 실측: 같은 "제작 재료" 유형이라도
 *        `샘플 고유재료`(고유 실명)는 Index 가 필요 없다. 이 게이트를 실 시트에 처음 걸었을 때 낸 오탐이다.
 *   ⑤ unknown_item_name (HIGH) — 병기한 이름이 아이템 테이블에 아예 없다 = 기억·추측으로 쓴 것.
 *      "사전에서만 고른다"는 규칙을 산문으로만 두면 아무도 검사하지 못한다.
 *   ② cite_with_scope_all (HIGH) — 유형 **전수**가 검증 대상인 문장에 대표 1건을 병기했다.
 *      "모든 성장 재료가 …" 에 `(예: 샘플재료석)` 을 붙이면 테스터가 1건만 보고 넘긴다 = 범위 축소 오독.
 *      (P-23 "열거값은 값 수만큼 개별 전개" 와 같은 계열의 사고)
 *   ③ duplicate_cite (MEDIUM) — 한 문장에서 같은 병기를 2회 이상 반복. 첫 지목에만 붙인다.
 *
 * 후보 1종 (판정은 LLM):
 *   ④ missing_cite (MEDIUM) — 아이템 유형만 있고 병기가 없다. **위반이 아니라 축1 질문지다.**
 *      준비물이면 병기해야 하고, 앞 단계가 만든 상태로만 등장하거나 관측 주체가 다른 것이면 그대로 둔다.
 *
 * ⚠ 결정론 제외분도 센다(silent cap 금지). `excluded` 에 사유별 건수가 남는다 —
 *   제외 규칙이 과하게 먹어 후보가 0이 된 것과, 정말 위반이 없는 것을 구분해야 한다.
 *
 * ⚠ 겸용 0건 조합(`combos[].item_count === 0`)은 여기서 판정하지 않는다 — 문장에서 조합을 문자열로
 *   식별할 수 없다("제작+성장 겸용 재료" 안에 시스템 키가 그대로 있지 않다). 대신 summary.zero_combos 로
 *   목록을 실어 렌즈가 대조하게 한다. 코드가 못 하는 것을 한다고 쓰지 않는다.
 *
 * 사용: node item_cite_gate.js <snapshot|final.json> <item_dict.json> [--out <report.json>]
 * exit 0=확정 위반·후보 0 / 3=확정 위반 또는 후보 있음(비차단 신호) / 4=사전 없음(스킵) / 2=인자·입력 오류
 */

'use strict';
const fs = require('fs');

// 유형 전수가 검증 대상 = 대표 1건 병기 금지
const SCOPE_ALL_RE = /모든\s|각\s.{0,12}별|전\s?유형|유형\s?전체|종류별/;
// 아이템이 앞 단계가 만든 "상태"로만 등장 = 준비물이 아니다(축1=X 힌트)
const STATE_ONLY_RE = /재료만\s*등록|이미\s*등록|등록된\s*상태|등록되고|등록이\s*처리|등록된\s*재료/;
/**
 * 병기 추출 — `(예: X)` 와 `(… , 예: X)` 두 형태.
 * ⚠ 정규식으로 하지 않는다. 병기 안에 괄호가 한 겹 더 들어간다 —
 *   `(예: 제작 재료 임시 명칭(Index 100000002))`. `[^)]*` 류는 안쪽 `)` 에서 잘려
 *   이름이 "…명칭(Index 100000002" 로 남고, 그 뒤 모든 판정이 오탐이 된다(실측 6건).
 *   그래서 여는 괄호부터 괄호 깊이를 세어 짝을 찾는다.
 */
function extractCites(f) {
  const out = [];
  const re = /(?:\(|,)\s*예:\s*/g;
  let m;
  while ((m = re.exec(f)) !== null) {
    let depth = 1, i = m.index + m[0].length, buf = '';
    while (i < f.length) {
      const c = f[i];
      if (c === '(') { depth++; buf += c; }
      else if (c === ')') { if (--depth === 0) break; buf += c; }
      else buf += c;
      i++;
    }
    const v = buf.trim();
    if (v) out.push(v);
    re.lastIndex = Math.max(i, m.index + m[0].length);
  }
  return out;
}

/** item_dict → 재료 유형 표현 목록. term.strict=true 면 뒤에 "아이템"이 와야 매치(오탐 억제). */
function typeTerms(dict) {
  const out = new Map();   // term → {examples, strict}
  for (const s of dict.systems || []) {
    out.set(`${s.key} 재료`, { examples: s.examples || [], strict: false });
  }
  for (const t of dict.types || []) {
    if (t.inventory_category !== '재료' || !t.item_type) continue;
    const strict = !/재료$/.test(t.item_type);   // '순간 이동'·'던전 입장 횟수' 류는 단독 매치 금지
    if (!out.has(t.item_type)) out.set(t.item_type, { examples: t.examples || [], strict });
  }
  return out;
}

function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function checkItemCite(rows, dict) {
  const findings = [];
  const excluded = { scope_all: 0, state_only: 0, already_cited: 0 };
  const terms = typeTerms(dict);
  const phNames = new Set(dict.placeholder_names || []);
  const nameIndex = dict.name_index || {};
  // 이름 색인이 없는 구 사전이면 ⑤(존재하지 않는 이름) 검사를 건너뛴다 — 전건 오탐이 되기 때문.
  const canCheckNames = Object.keys(nameIndex).length > 0 || phNames.size > 0;

  for (const r of rows) {
    const id = String(r[0]);
    const f = String(r[5] || '');
    if (!f) continue;

    // 이 행이 지목한 유형(가장 긴 표현 우선 — '제작 재료' 와 '제작 재료 아이템' 중복 매치 방지)
    let hit = null;
    for (const [term, meta] of [...terms].sort((a, b) => b[0].length - a[0].length)) {
      const re = new RegExp(esc(term) + (meta.strict ? '\\s*아이템' : '(\\s*아이템)?'));
      if (re.test(f)) { hit = { term, ...meta }; break; }
    }

    const cites = extractCites(f);
    const scopeAll = SCOPE_ALL_RE.test(f);

    // ③ 중복 병기 — 유형 매치와 무관하게 검사(같은 실명을 두 번 지목한 것 자체가 잡음)
    const seen = new Set(), dup = new Set();
    for (const c of cites) { if (seen.has(c)) dup.add(c); else seen.add(c); }
    for (const c of dup) {
      findings.push({ tc_id: id, kind: 'duplicate_cite', severity: 'MEDIUM',
        detail: `같은 병기 "${c}" 를 한 문장에서 ${cites.filter(x => x === c).length}회 반복 — 첫 지목에만 남길 것` });
    }

    // ② 전수 검증 문장 + 대표 1건 병기 = 범위 축소 오독
    if (scopeAll && cites.length) {
      findings.push({ tc_id: id, kind: 'cite_with_scope_all', severity: 'HIGH',
        detail: `유형 전수가 검증 대상인 문장에 대표 1건 병기 "${cites[0]}" — 병기를 빼거나 값 수만큼 행을 전개할 것` });
    }

    if (!hit) continue;

    if (cites.length) {
      // ①·⑤ 는 **인용된 개체** 기준으로 판정한다. 유형 기준으로 보면 오탐이 난다 —
      //   실측: `샘플 고유재료`(고유 실명)를 "제작 재료" 유형이 placeholder 라는 이유로 위반 처리했다.
      let bad = false;
      for (const raw of (canCheckNames ? cites : [])) {
        const hasIdx = /Index\s*\d+/.test(raw);
        const name = raw.replace(/\(\s*Index\s*\d+\s*\)/, '').trim();
        if (phNames.has(name)) {
          // ① 특정 불가한 표시명을 인용했다 → Index 없으면 60종 중 무엇인지 알 수 없다
          if (!hasIdx) {
            bad = true;
            findings.push({ tc_id: id, kind: 'placeholder_no_index', severity: 'HIGH',
              detail: `"${name}" 은 여러 아이템이 공유하는 표시명이라 이름만으로 특정되지 않는다 — item_dict 의 cite 형식(…(Index N))으로 쓸 것` });
          }
        } else if (!(name in nameIndex)) {
          // ⑤ 테이블에 없는 이름 → 기억·추측으로 쓴 것(규칙 2 위반). 확정 판정이 가능한 지점이다.
          bad = true;
          findings.push({ tc_id: id, kind: 'unknown_item_name', severity: 'HIGH',
            detail: `병기 "${name}" 이 아이템 테이블에 없다 — item_dict 의 examples/name_index 에서만 고를 것(기억·추측 금지)` });
        }
      }
      if (!bad) excluded.already_cited++;
      continue;
    }

    // ④ 병기 없음 → 결정론 제외 규칙을 통과한 것만 축1 질문지로 넘긴다
    if (scopeAll) { excluded.scope_all++; continue; }
    if (STATE_ONLY_RE.test(f)) { excluded.state_only++; continue; }
    findings.push({ tc_id: id, kind: 'missing_cite', severity: 'MEDIUM',
      detail: `"${hit.term}" 를 유형으로만 지목 — 축1(테스터가 직접 골라야 하는 준비물인가) 판정 필요. 준비물이면 병기 후보: ${(hit.examples[0] || {}).cite || '(사전에 예시 없음)'}` });
  }

  return { findings, excluded };
}

module.exports = { checkItemCite, typeTerms, extractCites, SCOPE_ALL_RE, STATE_ONLY_RE };

// ── CLI ──────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const a = process.argv.slice(2);
  if (a.length < 2) {
    process.stderr.write('사용: item_cite_gate.js <snapshot|final.json> <item_dict.json> [--out <report.json>]\n');
    process.exit(2);
  }
  if (!fs.existsSync(a[1])) {
    process.stderr.write('[item_cite_gate] item_dict.json 없음 — 스킵(비차단)\n');
    process.exit(4);
  }
  let rows, dict;
  try {
    const j = JSON.parse(fs.readFileSync(a[0], 'utf8'));
    rows = Array.isArray(j) ? j : j.rows;
    if (!Array.isArray(rows)) throw new Error('rows 배열 없음');
    dict = JSON.parse(fs.readFileSync(a[1], 'utf8'));
  } catch (e) {
    process.stderr.write(`[item_cite_gate] 입력 읽기 실패: ${e.message}\n`);
    process.exit(2);
  }

  const { findings, excluded } = checkItemCite(rows, dict);
  const byKind = {};
  for (const f of findings) byKind[f.kind] = (byKind[f.kind] || 0) + 1;
  const summary = {
    ok: findings.length === 0,
    total: rows.length,
    findings: findings.length,
    byKind,
    excluded,   // 결정론 제외분 — 후보 0건이 "위반 없음"인지 "제외 규칙이 다 먹었는지" 구분용
    zero_combos: (dict.combos || []).filter(c => c.item_count === 0).map(c => c.systems.join('+')),
  };

  const oi = a.indexOf('--out');
  if (oi >= 0 && a[oi + 1]) fs.writeFileSync(a[oi + 1], JSON.stringify({ ...summary, detail: findings }, null, 1));
  console.log(JSON.stringify(summary));
  for (const f of findings.filter(x => x.severity === 'HIGH').slice(0, 8)) {
    console.log(`  [${f.severity}] TC${f.tc_id} ${f.kind} — ${f.detail}`);
  }
  process.exit(findings.length ? 3 : 0);
}
