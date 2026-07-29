#!/usr/bin/env node
/**
 * origin_gate.js — 기획서 원문 대조 게이트 (2026-07-28 신설)
 *
 * 배경(7차 회고 유형 A·D): 파이프라인이 원문에 없는 정보를 **오독이 아니라 창작**으로 메운 사례가
 *   회고 15건 중 5건이었다. 텍스트 대조로 기계 검출이 가능한데 검사가 없었다.
 *   훈장시스템_v2 첫 실런 실측 — 원문에 "닫/호버/포커스/재표시/소멸/사라" 어간이 **0건**인데
 *   TC에는 8건(닫히 6·소멸 1·사라 1) 존재. TC321 "툴팁이 닫히는지"는 회고 038과 같은 형상이다.
 *
 * 정책 — **비차단 후보 추출기**다. 판정은 S4 판정자(LLM)가 원문 문맥을 보고 한다:
 *   - 기획서가 모든 동작을 명세하지 않는 것은 정상이고, "뒤로가기 → 닫힘"처럼 자명한 경우도 있다.
 *   - 반대로 단순 토큰 grep을 이진 판정으로 쓰면 회고 042("좌측" 창작)를 못 잡는다 —
 *     방향어 토큰 자체는 원문에 37회 실존하기 때문. 그래서 방향어는 severity를 낮게 둔다.
 *   ⚠ 리포트에 소비자가 없으면 데드 산출물이 된다 — 반드시 S4 판정자 입력으로 배선할 것.
 *
 * 검사 3종:
 *   ① 상호작용 동사 (HIGH): TC가 쓴 동작 어간이 원문에 **0건**이면 근거 없는 창작 후보. 신호가 가장 강하다.
 *   ② 좌표 (HIGH): TC가 인용한 좌표값이 원문에 없으면 창작/오독. 이스케이프(`\[3,2\]`)·평문(`[3,2]`) 양형식 대조.
 *   ③ 방향어 (LOW): 원문에 그 방향어가 0건이면 후보. 실존하면 문맥 판단이 필요해 후보에서 제외(오탐 억제).
 *
 * 사용: node origin_gate.js <tc_final.json> <confluence_raw.md> [--out <report.json>]
 * exit 0=후보 0건 / 3=후보 있음(비차단 신호) / 2=인자·입력 오류
 */

const fs = require('fs');

// (TC에서 찾을 패턴, 원문에서 존재를 확인할 어간 패턴, 라벨)
const VERBS = [
  { re: /닫히|닫힌|닫음|닫기/, stem: /닫/, label: 'UI 닫힘' },
  { re: /호버|마우스\s*오버|롤오버/, stem: /호버|오버/, label: '호버' },
  { re: /포커스/, stem: /포커스/, label: '포커스' },
  { re: /재표시|다시\s*표시/, stem: /재표시|다시\s*표시/, label: '재표시' },
  { re: /소멸/, stem: /소멸/, label: '소멸' },
  { re: /사라지|사라진|사라짐/, stem: /사라/, label: '사라짐' },
  { re: /길게\s*누르|롱\s*프레스/, stem: /길게\s*누르|롱\s*프레스/, label: '롱프레스' },
];

const DIRECTIONS = ['좌측', '우측', '중앙', '상단', '하단', '좌상', '우상', '좌하', '우하'];

// 좌표: 평문 [3,2] / 이스케이프 \[3,2\] / N행 M열
const COORD_RE = /\\?\[(\d+)\s*,\s*(\d+)\\?\]|(\d+)\s*행\s*(\d+)\s*열|(\d+)\s*열\s*(\d+)\s*행/g;

function checkOrigin(rows, rawText) {
  const findings = [];
  const raw = String(rawText || '');
  // 원문 좌표 집합(양형식 정규화 — 이스케이프 유무 무시)
  const rawCoords = new Set();
  let m;
  const rc = new RegExp(COORD_RE.source, 'g');
  while ((m = rc.exec(raw)) !== null) {
    const pair = m[1] != null ? [m[1], m[2]] : m[3] != null ? [m[3], m[4]] : [m[5], m[6]];
    rawCoords.add(pair.join(','));
  }

  for (const r of rows) {
    const id = String(r[0]);
    const f = String(r[5] || '');
    if (!f) continue;

    // ① 상호작용 동사
    for (const v of VERBS) {
      if (v.re.test(f) && !v.stem.test(raw)) {
        findings.push({
          tc_id: id, severity: 'HIGH', kind: 'interaction_verb', label: v.label,
          detail: `"${v.label}" 동작이 기획서 원문에 없음(어간 0건) — 상식 기반 창작 후보`,
          text: f.slice(0, 90),
        });
      }
    }

    // ② 좌표
    const cr = new RegExp(COORD_RE.source, 'g');
    while ((m = cr.exec(f)) !== null) {
      const pair = m[1] != null ? [m[1], m[2]] : m[3] != null ? [m[3], m[4]] : [m[5], m[6]];
      const key = pair.join(',');
      const swapped = [pair[1], pair[0]].join(',');
      if (!rawCoords.has(key)) {
        findings.push({
          tc_id: id, severity: 'HIGH', kind: 'coordinate',
          detail: rawCoords.has(swapped)
            ? `좌표 [${key}]가 원문에 없음 — 원문에는 [${swapped}](행·열 뒤바뀜 의심, 회고 193·194 형상)`
            : `좌표 [${key}]가 원문에 없음 — 창작 후보`,
          text: f.slice(0, 90),
        });
      }
    }

    // ③ 방향어 — 원문에 아예 없는 것만(실존하면 문맥 판단 필요 → 오탐 억제 위해 제외)
    for (const d of DIRECTIONS) {
      if (f.includes(d) && !raw.includes(d)) {
        findings.push({
          tc_id: id, severity: 'LOW', kind: 'direction', label: d,
          detail: `방향어 "${d}"가 원문에 없음 — 이미지에만 있는 배치 정보를 텍스트로 단정했을 가능성`,
          text: f.slice(0, 90),
        });
      }
    }
  }
  return findings;
}

module.exports = { checkOrigin, VERBS, DIRECTIONS };

if (require.main === module) {
  const a = process.argv.slice(2);
  if (a.length < 2) {
    process.stderr.write('사용: origin_gate.js <tc_final.json> <confluence_raw.md> [--out <report.json>]\n');
    process.exit(2);
  }
  let rows, raw;
  try {
    const j = JSON.parse(fs.readFileSync(a[0], 'utf8'));
    rows = Array.isArray(j) ? j : j.rows;
    if (!Array.isArray(rows)) throw new Error('rows 배열 없음');
    raw = fs.readFileSync(a[1], 'utf8');
  } catch (e) {
    process.stderr.write(`[origin_gate] 입력 읽기 실패: ${e.message}\n`);
    process.exit(2);
  }

  const findings = checkOrigin(rows, raw);
  const byKind = {};
  const bySev = {};
  for (const f of findings) {
    byKind[f.kind] = (byKind[f.kind] || 0) + 1;
    bySev[f.severity] = (bySev[f.severity] || 0) + 1;
  }
  const summary = { ok: findings.length === 0, total: rows.length, findings: findings.length, byKind, bySev };

  const outIdx = a.indexOf('--out');
  if (outIdx >= 0 && a[outIdx + 1]) {
    fs.writeFileSync(a[outIdx + 1], JSON.stringify({ ...summary, detail: findings }, null, 1));
  }
  console.log(JSON.stringify(summary));
  for (const f of findings.filter(x => x.severity === 'HIGH').slice(0, 8)) {
    console.log(`  [${f.severity}] TC${f.tc_id} ${f.kind} — ${f.detail}`);
  }
  process.exit(findings.length ? 3 : 0);
}
