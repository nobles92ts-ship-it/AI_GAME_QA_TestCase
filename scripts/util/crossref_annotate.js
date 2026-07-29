#!/usr/bin/env node
/**
 * crossref_annotate.js — dxr_crossref.json 의 locate·apply(approved:false) 출처를
 * tc_design.md "기획 확인 필요 항목 (DXR 대조)" 블록에 결정론적으로 주입한다.
 *
 * 배경 (적대리뷰 #9): locate/keep 은 needs_fix 트리거가 아니라, locate-only 런에서는
 * STEP 3가 안 돌아 대조 산출물이 tc_design 에 전혀 반영되지 않았다("완료 locate=N" 로그만
 * 남고 시트 기획확인은 대조 전과 동일 = 출처 없음). 이 스크립트가 needs_fix 와 무관하게
 * 위치·출처를 설계에 기계 삽입해 QA 가 "어디 보면 됨"을 받게 한다.
 *
 * 원칙: LLM 불요·멱등(마커 키로 중복 삽입 차단)·best-effort(어떤 실패도 파이프라인 비차단).
 * 사용: node crossref_annotate.js <dxr_crossref.json> <tc_design.md>
 */
'use strict';
const fs = require('fs');

const [, , crossPath, designPath] = process.argv;
const SECTION = '## 기획 확인 필요 항목 (DXR 대조)';
const MARK = '<!-- crossref-annotate -->';

function main() {
  if (!crossPath || !designPath) { console.error('usage: crossref_annotate.js <crossref.json> <tc_design.md>'); return 0; }
  if (!fs.existsSync(crossPath) || !fs.existsSync(designPath)) { console.log('[crossref-annotate] 입력 없음 — 스킵'); return 0; }

  let cross;
  try { cross = JSON.parse(fs.readFileSync(crossPath, 'utf8')); }
  catch (e) { console.log('[crossref-annotate] crossref 파싱 실패 — 스킵: ' + e.message); return 0; }

  const items = Array.isArray(cross.items) ? cross.items : [];
  // 설계에 흘려보낼 대상 = locate + apply(값 외부라 approved:false). apply-approved:true·discover 는 STEP3가 이미 소비.
  const targets = items.filter(it => {
    const b = (it.branch || '').toLowerCase();
    if (b === 'locate') return true;
    if (b === 'apply' && it.approved === false) return true;
    return false;
  }).filter(it => it.source); // 출처 없으면 무효(가드)

  if (targets.length === 0) { console.log('[crossref-annotate] locate/apply(외부) 0건 — 삽입 없음'); return 0; }

  let design = fs.readFileSync(designPath, 'utf8');

  // 이미 이 스크립트가 만든 블록이 있으면 그 블록만 교체(멱등). 없으면 문서 끝에 추가.
  const bullets = targets.map(it => {
    const src = String(it.source).replace(/\n/g, ' ').trim();
    const note = (it.note ? String(it.note).replace(/\n/g, ' ').trim() : '');
    const loc = (it.location || it.page_id) ? ` (${it.location || ('page_id:' + it.page_id)})` : '';
    const key = (it.item || it.key || src).replace(/\n/g, ' ').trim();
    return `- **${key}** → 확인 위치: ${src}${loc}${note ? ' — ' + note : ''}`;
  });

  const block = `${SECTION} ${MARK}\n\n`
    + `> DXR 뇌 대조가 값의 **위치·출처**만 안내한 항목(값은 원본에서 확인). 스코프 경계상 값을 지어내지 않음. 대조 산출: \`dxr_crossref.json\`.\n\n`
    + bullets.join('\n') + '\n';

  const markIdx = design.indexOf(SECTION + ' ' + MARK);
  if (markIdx >= 0) {
    // 기존 블록(다음 ## 헤딩 또는 EOF 까지) 교체
    const after = design.indexOf('\n## ', markIdx + 1);
    design = design.slice(0, markIdx) + block + (after >= 0 ? design.slice(after + 1) : '');
  } else {
    design = design.replace(/\s*$/, '') + '\n\n' + block;
  }
  fs.writeFileSync(designPath, design);
  console.log(`[crossref-annotate] tc_design 에 ${targets.length}건 주입(locate/apply-외부) — 멱등`);
  return 0;
}

try { process.exit(main()); }
catch (e) { console.log('[crossref-annotate] 예외(비차단): ' + e.message); process.exit(0); }
