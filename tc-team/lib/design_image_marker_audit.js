#!/usr/bin/env node
/**
 * design_image_marker_audit.js — 설계서의 「이미지 참조 필요」 마커가 기획서 실물과 맞는지 검사
 *
 * 왜 (2026-09-11 실측, 스펙 94개 · TC 11,644):
 *   확신도 R2(2026-09-11 배지로 강등 — 지금은 점수 0, 메모의 「그림 대조」 QA 지침으로만 쓰인다)는
 *   "기획서가 그림뿐인가"를 재는 것처럼 읽히지만, 실제로는
 *   **설계기가 그 소분류에 `[이미지 참조 필요]` 마커를 달았는가**만 본다
 *   (confidence_core: `lf.needImage = markers.some(m => m.includes('이미지 참조 필요'))`).
 *   그런데 마커는 기획서 실물과 거의 무관하게 붙는다:
 *     r(본문 이미지 수, R2 발화율) = 0.197   ← 거의 무관
 *     r(설계 마커 수,  R2 발화율) = 0.845   ← 마커가 곧 R2
 *   같은 Confluence 페이지(402948225)를 두 번 돌린 대조쌍이 결정적이다:
 *     파티_보상_분배_시스템     이미지  0장 · 마커 17건 · R2 80%
 *     파티_보상_분배_시스템_v2  이미지 37장 · 마커  0건 · R2  0%
 *   이미지와 마커가 정반대다. 같은 기획서가 런에 따라 −20점씩 갈렸다(강등 전 — 이것이 강등 사유다).
 *   강등 뒤에도 마커가 틀리면 「그림 대조」 지침이 엉뚱한 화면에 붙거나 필요한 화면에서 빠진다.
 *   전수로는 이미지 보유 60개 스펙 중 28개(47%)가 마커 0건이다 — R2 가 통째로 잠든 런.
 *
 * 하는 일: 양방향으로 어긋남을 센다.
 *   ① 누락(miss)  : 본문 이미지 >= --min-images(기본 3) 인데 설계 마커 0건
 *                   → 화면 설명이 그림에 실렸는데 R2 가 한 건도 안 걸린다
 *   ② 무근거(ghost): 본문 이미지 0장인데 설계 마커 > 0
 *                   → 근거 없이 전 항목 메모에 「그림 대조」 지침이 붙는다 (강등 전엔 −20)
 *
 * ⚠ **비차단이다.** 마커를 고치지도, 확신도를 건드리지도 않는다 — 설계자·사람이 판정한다.
 *   (자동으로 마커를 달면 "설계기가 판단했다"는 R2 의 전제 자체가 무너진다)
 *
 * 사용: node design_image_marker_audit.js <spec 폴더> [--min-images 3] [--out audit.json] [--quiet]
 * exit 0=어긋남 없음 / 3=후보 있음(신호, 차단 아님) / 2=인자·입력 오류
 */
'use strict';
const fs = require('fs');
const path = require('path');

// Confluence 추출기는 그림을 `image-20260901-072920.png` 처럼 **파일명 문자열로만** 남긴다.
// 마크다운 `![](...)` 도 attachment URL 도 아니라서, 그 둘만 찾으면 전 스펙이 0장으로 잡힌다
// (2026-09-11: 이 오측정 때문에 상관계수를 한 번 잘못 냈다).
const IMG_RE = /[\w\-./]+\.(?:png|jpe?g|gif|webp)/gi;
const MARKER = '이미지 참조 필요';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const QUIET = args.includes('--quiet');
const SPEC = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--min-images'
  && args[args.indexOf(a) - 1] !== '--out');
const MIN_IMAGES = Number(opt('--min-images', 3));

if (!SPEC || !fs.existsSync(SPEC)) {
  console.error('사용법: design_image_marker_audit.js <spec 폴더> [--min-images 3] [--out audit.json] [--quiet]');
  process.exit(2);
}
const design = path.join(SPEC, 'tc_design.md');
const raw = path.join(SPEC, 'confluence_raw.md');
if (!fs.existsSync(design)) { console.error(`[이미지마커] tc_design.md 없음: ${design}`); process.exit(2); }
if (!fs.existsSync(raw)) {
  // 기획서 원문이 없으면 잴 대상이 없다 — 조용히 통과시키되 사실은 남긴다(침묵 금지).
  if (!QUIET) console.log('[이미지마커] confluence_raw.md 없음 — 검사 대상 아님');
  process.exit(0);
}

const images = [...new Set((fs.readFileSync(raw, 'utf8').match(IMG_RE) || []).map((s) => s.toLowerCase()))];
const designText = fs.readFileSync(design, 'utf8');
const markers = (designText.match(new RegExp(MARKER, 'g')) || []).length;
// 마커가 달린 소분류 이름 (보고용) — 트리 줄에서 뽑는다
const marked = designText.split('\n')
  .filter((l) => l.includes(MARKER))
  .map((l) => (l.match(/^\s*-\s*([^[]+)/) || [])[1])
  .filter(Boolean).map((s) => s.trim());

const miss = images.length >= MIN_IMAGES && markers === 0;
const ghost = images.length === 0 && markers > 0;
const out = {
  spec: path.basename(SPEC),
  images: images.length, markers,
  min_images: MIN_IMAGES,
  verdict: miss ? 'miss' : ghost ? 'ghost' : 'ok',
  marked_subcats: marked.slice(0, 20),
  sample_images: images.slice(0, 5),
  generated_at: new Date().toISOString(),
};
const OUT = opt('--out', path.join(SPEC, 'design_image_marker_audit.json'));
fs.writeFileSync(OUT, JSON.stringify(out, null, 1), 'utf8');

if (!QUIET) {
  if (miss) {
    console.log(`[이미지마커] ⚠ 누락 후보 — 기획서 이미지 ${images.length}장인데 설계 마커 0건. `
      + 'R2(이미지 판독 의존 표시)가 이 런에서 한 건도 안 붙어, 그림으로만 판정되는 화면이 있어도 QA 메모에 「그림 대조」 지침이 안 나온다.\n'
      + '[이미지마커]   ⚠ 이미지 수는 **트리거일 뿐 근거가 아니다.** 판정 기준은 '
      + '「그 소분류의 기대결과가 텍스트만으로 서는가」 — 스트링·수치·규칙이 본문에 적혀 있으면 '
      + '이미지가 아무리 많아도 마커 불요. 색·아이콘 모양처럼 **그림에만 있는 것이 기대결과에 들어갈 때만** 단다. '
      + '확인하고 불요로 판단했으면 그 사실을 검수 보고서에 남길 것(침묵 금지).');
  } else if (ghost) {
    console.log(`[이미지마커] ⚠ 무근거 후보 — 기획서 이미지 0장인데 설계 마커 ${markers}건 `
      + `(${marked.slice(0, 3).join(' · ')}${marked.length > 3 ? ' 외' : ''}). `
      + '근거 없이 해당 소분류 전 항목 메모에 「그림 대조」 지침이 붙는다(점수 영향 없음 — R2 는 2026-09-11 배지로 강등).');
  } else {
    console.log(`[이미지마커] ✅ 이미지 ${images.length}장 · 마커 ${markers}건 — 어긋남 없음`);
  }
  console.log(`[이미지마커] 산출물: ${OUT}`);
}
process.exit(miss || ghost ? 3 : 0);
