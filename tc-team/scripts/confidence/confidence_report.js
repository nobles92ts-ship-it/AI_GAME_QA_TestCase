#!/usr/bin/env node
/**
 * confidence_report.js — 확신도 히트맵 HTML 리포트 (S7 FINAL-0 산출물)
 *
 * 3뷰: ① 소분류별 확신도 히트맵 ② 기획서 섹션 역커버리지 ③ 탐색 권장(참고)
 * 산식은 confidence_core.js 가 소유 — 여기는 렌더링만.
 *
 * 사용: node confidence_report.js --spec <specs/기능명 폴더>
 *       → <spec>/confidence_heatmap.html
 */
const fs = require('fs');
const path = require('path');
const { computeItems } = require('./confidence_core');

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : ''; };
const SPEC = opt('--spec');
if (!SPEC || !fs.existsSync(SPEC)) { console.error('사용법: --spec <specs/기능명 폴더>'); process.exit(1); }
const OUT = path.join(SPEC, 'confidence_heatmap.html');

// computeItems 를 쓰는 이유: 조용한 누락 판정이 항목 단위여야 한다(diag.matchedItems).
const { scored, sections, charters, skeleton, RULES, diag } = computeItems(SPEC);

// 조용한 실패 가시화 — 미해소 용어가 있는데 항목 매칭 0이면 R3/R4 감점이 통째로 빠진 상태다.
if (diag && diag.xrefSilentMiss) {
  process.stderr.write(`[확신도][경고] dxr_crossref 미해소 ${diag.unresolvedTerms}건인데 감점된 TC 0건 — `
    + `R3/R4 가 전부 누락된다. 대조가 용어를 정규화해 쓴 것(예: '중독·환각'→'중독환각')이 원인일 수 있다.\n`);
}

const CHARTER_HINT = {
  R1: '기획 미결 → 실제 빌드 동작을 관찰해 기획팀 질의 근거를 확보',
  R2: '이미지 의존 → 실기 화면과 기획 이미지를 1:1 대조',
  R3: '외부 시스템 미해소 → 연계 기능을 실제로 동작시켜 경계 확인',
  R4: '데이터 위치만 확인 → 원본 테이블 실값으로 경계값 재확정',
  R5: '생성기 floor 미달 → 해당 단계(부정/예외) 시나리오를 자유 탐색',
  R6: '앵커 얕음 → 기획서에 안 적힌 세부 동작을 훑어 요건 역추출',
};

// 부록 규칙표 — 점수는 RULES 에서 생성한다(하드코딩 금지).
// 과거 하드코딩 표가 R7 배지화를 놓쳐 `+8` 로 남아 있었고, R3/R4 건수 비례도 안 보였다.
const RULE_SRC = {
  R1: 'tc_design.md 트리 [J:기획 확인 필요]',
  R2: 'tc_design.md 트리 [이미지 참조 필요]',
  R3: 'dxr_crossref.json branch=keep',
  R4: 'dxr_crossref.json branch=locate',
  R5: 'coverage_gaps.json',
  R6: 'tc_design.md 커버리지 매핑 출처열',
  R7: 'tc_design.md 검증단계 사전 배분표',
};
const penText = (r) => {
  if (!r.penalty) return '표시 전용 (점수 영향 없음)';
  const base = r.penalty < 0 ? `+${-r.penalty}` : `-${r.penalty}`;
  return r.per ? `${base} (추가 1건마다 -${r.per}, 최대 -${r.cap})` : base;
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const GC = { A: '#2e7d32', B: '#7cb342', C: '#f9a825', D: '#d84315' };
const dist = { A: 0, B: 0, C: 0, D: 0 };
scored.forEach((s) => dist[s.grade]++);
const avg = (scored.reduce((a, s) => a + s.score, 0) / scored.length).toFixed(1);

const rowsHtml = scored.slice().sort((a, b) => a.score - b.score).map((s) => `
<tr class="row" data-grade="${s.grade}" data-risk="${s.risk}">
  <td><span class="chip" style="background:${GC[s.grade]}">${s.grade}</span></td>
  <td class="score"><div class="bar"><i style="width:${s.score}%;background:${GC[s.grade]}"></i></div><b>${s.score}</b></td>
  <td><span class="risk r${s.risk}">${s.risk}</span></td>
  <td class="nm"><b>${esc(s.name)}</b><br><small>${esc(s.major)} › ${esc(s.mid)}</small></td>
  <td class="ct">${s.total}<small> (정${s.counts.정상}/부${s.counts.부정}/예${s.counts.예외})</small>${s.todo ? `<br><em>추후구현 ${s.todo}</em>` : ''}</td>
  <td class="rs">${s.reasons.length ? s.reasons.map((r) => `<div class="rz ${r.d > 0 ? 'pos' : r.d === 0 ? 'badge' : ''}"><b>${r.d > 0 ? '+' + r.d : r.d === 0 ? '·' : r.d}</b> ${esc((RULES.find((x) => x.id === r.id) || {}).label)} <small>${esc(r.detail)}</small></div>`).join('') : '<span class="ok">감점 없음 — 기획서 근거 직접 인용</span>'}</td>
</tr>`).join('');

const secHtml = sections.map((b) => {
  const thin = b.shallow / b.items;
  const cls = thin > 0.5 ? 'thin' : thin > 0 ? 'mid' : 'ok';
  return `<tr class="${cls}">
    <td><b>§${esc(b.top)}</b></td><td>${b.items}</td><td>${b.anchors.length}</td><td>${b.depth}</td>
    <td>${b.shallow ? `<b class="warn">${b.shallow}</b>` : '0'}</td>
    <td>H${b.risk.HIGH || 0} / M${b.risk.MEDIUM || 0} / L${b.risk.LOW || 0}</td>
    <td><small>${esc(b.anchors.slice(0, 12).join(', '))}${b.anchors.length > 12 ? ' …' : ''}</small></td>
  </tr>`;
}).join('');

const charterHtml = charters.map((s, i) => `
<div class="ch">
  <div class="chh"><span class="chn">${i + 1}</span><b>${esc(s.name)}</b>
    <span class="risk r${s.risk}">${s.risk}</span><span class="chip" style="background:${GC[s.grade]}">${s.grade} ${s.score}</span></div>
  <div class="chb">
    <div class="chl">탐색 이유</div>
    <ul>${s.reasons.filter((r) => r.d < 0).map((r) => `<li>${esc(CHARTER_HINT[r.id] || (RULES.find((x) => x.id === r.id) || {}).label)}<br><small>${esc(r.detail)}</small></li>`).join('')}</ul>
    <div class="chl">진입점</div>
    <p>${esc(s.major)} › ${esc(s.mid)} › ${esc(s.name)} — 기존 TC ${s.total}건(정${s.counts.정상}/부${s.counts.부정}/예${s.counts.예외}) 수행 후 자유 탐색</p>
  </div>
</div>`).join('');

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>확신도 히트맵 — ${esc(path.basename(SPEC))}</title>
<style>
:root{--bg:#fff;--fg:#1a1a1a;--mut:#6b7280;--bd:#e5e7eb;--pn:#f9fafb}
@media(prefers-color-scheme:dark){:root{--bg:#15171a;--fg:#e8eaed;--mut:#9aa0a6;--bd:#2e3238;--pn:#1c1f23}}
*{box-sizing:border-box}body{margin:0;padding:28px;font:14px/1.6 "Malgun Gothic",-apple-system,sans-serif;background:var(--bg);color:var(--fg)}
h1{font-size:21px;margin:0 0 4px}h2{font-size:16px;margin:34px 0 10px;padding-bottom:6px;border-bottom:2px solid var(--bd)}
.sub{color:var(--mut);font-size:12px;margin-bottom:20px}
.kpi{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0 8px}
.k{flex:1;min-width:110px;border:1px solid var(--bd);border-radius:8px;padding:10px 12px;background:var(--pn)}
.k b{display:block;font-size:22px;line-height:1.2}.k span{font-size:11px;color:var(--mut)}
table{width:100%;border-collapse:collapse;font-size:12.5px}
th{background:var(--pn);text-align:left;padding:8px;border-bottom:2px solid var(--bd);font-size:11.5px;color:var(--mut);position:sticky;top:0}
td{padding:8px;border-bottom:1px solid var(--bd);vertical-align:top}
.chip{display:inline-block;color:#fff;border-radius:4px;padding:1px 7px;font-weight:700;font-size:11px}
.risk{display:inline-block;border-radius:4px;padding:1px 6px;font-size:10.5px;font-weight:700}
.rHIGH{background:#fdecea;color:#c62828}.rMEDIUM{background:#fff6e0;color:#9a6b00}.rLOW{background:#eef2f5;color:#546e7a}
@media(prefers-color-scheme:dark){.rHIGH{background:#3a1f1f;color:#ff8a80}.rMEDIUM{background:#3a3220;color:#ffd54f}.rLOW{background:#242a2f;color:#b0bec5}}
.bar{display:inline-block;width:70px;height:7px;border-radius:4px;background:var(--bd);overflow:hidden;vertical-align:middle;margin-right:6px}
.bar i{display:block;height:100%}
.score{white-space:nowrap}.nm small,.ct small{color:var(--mut)}.ct em{color:#d84315;font-style:normal;font-size:11px}
.rs{max-width:430px}.rz{margin-bottom:3px;padding-left:8px;border-left:2px solid #d84315}
.rz.pos{border-left-color:#2e7d32}.rz b{color:#d84315}.rz.pos b{color:#2e7d32}.rz small{color:var(--mut);display:block}
.rz.badge{border-left-color:var(--mut)}.rz.badge b,.rz.badge{color:var(--mut)}
.ok{color:#2e7d32;font-size:11.5px}
tr.thin{background:rgba(216,67,21,.07)}tr.mid{background:rgba(249,168,37,.07)}
.warn{color:#d84315}
.ch{border:1px solid var(--bd);border-radius:8px;margin-bottom:10px;overflow:hidden}
.chh{display:flex;gap:8px;align-items:center;padding:9px 12px;background:var(--pn);border-bottom:1px solid var(--bd)}
.chn{display:inline-flex;width:20px;height:20px;border-radius:50%;background:#455a64;color:#fff;font-size:11px;align-items:center;justify-content:center}
.chb{padding:10px 12px}.chl{font-size:11px;color:var(--mut);font-weight:700;margin:6px 0 3px}
.chb ul{margin:0;padding-left:18px}.chb li{margin-bottom:4px}.chb small{color:var(--mut)}.chb p{margin:0}
.note{background:var(--pn);border:1px solid var(--bd);border-left:3px solid #455a64;border-radius:6px;padding:10px 13px;font-size:12.5px;margin:10px 0}
.f{margin:10px 0}.f button{border:1px solid var(--bd);background:var(--bg);color:var(--fg);border-radius:5px;padding:4px 11px;font-size:12px;cursor:pointer;margin-right:5px}
.f button.on{background:#455a64;color:#fff;border-color:#455a64}
.wrap{overflow-x:auto}
</style></head><body>

<h1>확신도 히트맵 — ${esc(path.basename(SPEC))}</h1>
${diag && diag.xrefSilentMiss ? `<div style="border-left:4px solid #d84315;background:#fff3e0;color:#4e342e;padding:10px 14px;margin:0 0 14px;border-radius:0 6px 6px 0">
<b>⚠ R3/R4 감점 전량 누락</b> — dxr_crossref 미해소 ${diag.unresolvedTerms}건인데 감점된 TC가 0건이다.
대조가 용어를 정규화해 쓰면(예: <code>중독·환각</code> → <code>중독환각</code>) 설계서 문장과 부분문자열 매칭이 되지 않는다.
이 점수표는 외부 의존 감점 없이 산출된 것이므로 실제보다 관대하다.</div>` : ''}
<div class="sub">tc-team 산출물 기반 · 총 ${skeleton.total}TC / 소분류 ${scored.length}개 · 확신도는 <b>결정론 코드가 산출</b>(LLM 자가채점 없음) · TC별 점수는 시트 A열 색·메모와 confidence.json 참조</div>

<div class="kpi">
  <div class="k"><b>${avg}</b><span>평균 확신도 (소분류)</span></div>
  <div class="k"><b style="color:${GC.A}">${dist.A}</b><span>A · 근거 확실 (85+)</span></div>
  <div class="k"><b style="color:${GC.B}">${dist.B}</b><span>B · 양호 (70-84)</span></div>
  <div class="k"><b style="color:${GC.C}">${dist.C}</b><span>C · 주의 (50-69)</span></div>
  <div class="k"><b style="color:${GC.D}">${dist.D}</b><span>D · 근거 희박 (&lt;50)</span></div>
  <div class="k"><b>${charters.length}</b><span>탐색 권장 소분류</span></div>
</div>

<div class="note"><b>확신도 ≠ 리스크.</b> 확신도는 <i>근거가 얼마나 단단한가</i>(리뷰 깊이 배분용), 리스크는 <i>틀렸을 때 얼마나 아픈가</i>(우선순위용). 리뷰 순서는 <b>확신도 낮음 × 리스크 높음</b> 순으로 읽으면 됩니다. 무색(A/B)은 "TC가 맞다"가 아니라 "기획서 대조 시간을 덜 써도 된다"는 뜻 — 실행은 전 행 대상.</div>

<h2>1. 소분류별 확신도 (낮은 순)</h2>
<div class="f">
  <button class="on" data-f="all">전체</button><button data-f="D">D만</button><button data-f="C">C+D</button><button data-f="HIGH">HIGH 리스크</button>
</div>
<div class="wrap"><table>
<thead><tr><th>등급</th><th>확신도</th><th>리스크</th><th>소분류</th><th>TC</th><th>감점 근거 (전부 산출물 출처)</th></tr></thead>
<tbody id="tb">${rowsHtml}</tbody></table></div>

<h2>2. 기획서 섹션 역커버리지 <small style="font-weight:400;color:var(--mut)">— 기획서를 건드리지 않는 오버레이 대체</small></h2>
<div class="note">기획서 원문에 색칠하는 대신, <b>커버리지 매핑의 출처 앵커를 역인덱스</b>했습니다. <b>얕은 앵커</b>(§3처럼 섹션 통째 참조)가 많은 구간 = 오버레이에서 "색이 흐리게 칠해진" 구간과 같은 의미입니다. 원본 기획서는 읽기만 합니다.</div>
<div class="wrap"><table>
<thead><tr><th>기획서 섹션</th><th>매핑 항목</th><th>앵커 종류</th><th>3단계 이상</th><th>얕은 앵커</th><th>리스크 분포</th><th>앵커 목록</th></tr></thead>
<tbody>${secHtml}</tbody></table></div>

<h2>3. 탐색 차터 권장 영역 <small style="font-weight:400;color:var(--mut)">— 참고용 (별도 산출물 아님 · 07-29 보류 결정)</small></h2>
<div class="note">별도 판단 없이 <b>(100 − 확신도) × 리스크 가중</b> 순으로 정렬했습니다. 낮은 확신도의 <b>감점 사유가 그대로 탐색 목적</b>이 됩니다.</div>
${charterHtml}

<h2>부록. 감점 규칙</h2>
<div class="wrap"><table><thead><tr><th>ID</th><th>사유</th><th>점수</th><th>출처 산출물</th></tr></thead><tbody>
${RULES.map((r) => `<tr><td>${r.id}</td><td>${esc(r.label)}</td><td>${penText(r)}</td><td>${esc(RULE_SRC[r.id] || '')}</td></tr>`).join('\n')}
</tbody></table></div>
<div class="note">R3·R4 는 <b>합쳐서 최대 -${(RULES.find((r) => r.id === 'R3') || {}).cap}</b> 이다. 같은 줄에 둘 다 걸리면 첫 건이 기준 감점을 정하고 나머지는 증분만 더한다 — 그래야 <b>위치라도 찾은 의존(locate)이 아예 못 찾은 의존(keep)보다 나쁘게 채점되는 역전</b>이 생기지 않는다.</div>

<script>
document.querySelectorAll('.f button').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('.f button').forEach(x=>x.classList.remove('on'));b.classList.add('on');
  const f=b.dataset.f;
  document.querySelectorAll('#tb .row').forEach(r=>{
    const g=r.dataset.grade,k=r.dataset.risk;
    r.style.display = f==='all'||(f==='D'&&g==='D')||(f==='C'&&(g==='C'||g==='D'))||(f==='HIGH'&&k==='HIGH') ? '' : 'none';
  });
});
</script>
</body></html>`;

fs.writeFileSync(OUT, html, 'utf8');
console.log(`[확신도] 리포트 → ${OUT}`);
