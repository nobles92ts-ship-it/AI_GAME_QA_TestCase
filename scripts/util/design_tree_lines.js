// design_tree_lines.js
// tc_design.md '## 분류 그룹핑 트리' 의 **줄 모양 계약(SSoT)** — 이 파일 하나만 본다.
//
// 왜 있나 (2026-08-16 자동_사냥_기능_v3 실사고):
//   같은 트리를 읽는 파서가 두 벌이었고 계약이 달랐다.
//     · validate_tc_rows.js parseDesignTree — 줄을 trim 후 매칭 (들여쓰기 무관)
//     · confidence_core.js  트리 루프       — 원본 줄에 `^\s+` / `^\s{2,}` 요구 (들여쓰기 필수)
//   설계기가 들여쓰기 없이 트리를 내자 convert·merge·S4 는 전부 통과했는데 확신도만
//   leaves=[] → 점수 0건 · 색칠 0행 · 드리프트 218행으로 조용히 죽었다.
//   → 줄을 무엇으로 볼지(대분류/중분류/소분류/항목)는 여기서 한 번만 정하고 둘 다 여기를 쓴다.
//     줄을 어떻게 쓸지(태그 해석·본문 정규화·감점)는 소비자별로 다르다 — 그건 각자 한다.
//
// 계약:
//   대분류  `N. **이름** (대분류)`
//   중분류  `N.M 이름 (중분류)`
//   소분류  `- 이름 [리스크] [플랫폼] [태그…]`
//   항목    `→ 정상|부정|예외-N: 본문 [J:…]`
//   들여쓰기는 **의미 없다** (있어도 없어도 같게 읽는다). 줄 끝 \r 도 trim 으로 흡수한다.

/** 트리 섹션 헤딩 / 각 줄 모양. 소비자가 직접 쓸 일이 있어 함께 내보낸다. */
const DESIGN_TREE_RE = {
  section: /^##\s*분류\s*그룹핑\s*트리/,
  major: /^\d+\.\s+\*\*(.+?)\*\*/,
  mid: /^\d+\.\d+\s+(.+?)\s*\(중분류\)/,
  leaf: /^-\s+(.+)$/,
  item: /^→\s*(정상|부정|예외)-(\d+)\s*:\s*(.+)$/,
};

/**
 * 트리 한 줄의 종류를 판정한다 (들여쓰기 비의존).
 * @returns {{kind:'blank'|'major'|'mid'|'leaf'|'item'|'other', text:string, ...}}
 *   major/mid → name / leaf → body(`- ` 뒤 전부) / item → stage, seq, body(본문+태그)
 *   판정 순서는 major → mid → leaf → item 고정 — 소분류 줄이 본문에 `→` 를 품어도
 *   소분류로 읽던 기존 동작을 유지한다.
 */
function classifyDesignLine(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text || text === '---') return { kind: 'blank', text };
  let m;
  if ((m = text.match(DESIGN_TREE_RE.major))) return { kind: 'major', text, name: m[1].trim() };
  if ((m = text.match(DESIGN_TREE_RE.mid))) return { kind: 'mid', text, name: m[1].trim() };
  if ((m = text.match(DESIGN_TREE_RE.leaf))) return { kind: 'leaf', text, body: m[1] };
  if ((m = text.match(DESIGN_TREE_RE.item))) {
    return { kind: 'item', text, stage: m[1], seq: parseInt(m[2], 10), body: m[3] };
  }
  return { kind: 'other', text };
}

/** 소분류 줄 본문 → { name, markers:['[HIGH]', '[PC/모바일]', …] } */
function splitLeafMarkers(body) {
  const m = String(body).match(/^(.+?)\s*(\[.*)?$/);
  if (!m) return { name: String(body).trim(), markers: [] };
  return { name: m[1].trim(), markers: (m[2] || '').match(/\[[^\]]+\]/g) || [] };
}

module.exports = { DESIGN_TREE_RE, classifyDesignLine, splitLeafMarkers };
