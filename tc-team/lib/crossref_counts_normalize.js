#!/usr/bin/env node
/**
 * crossref_counts_normalize.js — dxr_crossref.json 의 `counts` 를 소비부와 같은 식으로 다시 센다 (2026-09-07 신설)
 *
 * 배경: 대조 에이전트(LLM)가 `counts` 를 직접 써 넣는데, **발굴 항목을 `discovered[]` 배열에만 담고
 *   `counts.discover` 는 0 으로 남긴다.** 소비부(`run_pipeline_s1only.sh` 의 XC/XFIX)는
 *   `items[branch=discover] + discovered[]` 로 세므로 **파이프라인은 옳게 돌지만**(needs_fix 정상 발화),
 *   사람이 JSON 의 `counts` 만 보면 "발굴 0건"으로 오독한다.
 *   실측 2026-09-06 버프디버프: 로그 `discover=1` vs 파일 `counts.discover=0` — 완주 보고를 쓰던 사람이 실제로 오독했다.
 *
 * 정책: `counts` 를 **소비부와 동일한 식**으로 덮어쓰고, 에이전트가 쓴 원본은 `counts_raw` 로 보존한다.
 *   - apply    = items[branch=apply && approved===true]        (승인된 것만 — 값이 외부면 apply 로 치지 않는다)
 *   - locate   = items[branch=locate] + items[branch=apply && approved!==true]
 *   - discover = items[branch=discover] + discovered[]          ← 어긋나던 자리
 *   - keep     = items[branch=keep]
 *   - in       = items.length
 *
 * ⚠ 판정은 손대지 않는다. 각 항목의 `branch` 는 그대로 두고 **집계 숫자만** 맞춘다.
 *
 * 사용: node crossref_counts_normalize.js <dxr_crossref.json> [--quiet]
 * exit 0=정상(변경 없음 포함) / 2=인자·입력 오류
 */

const fs = require('fs');

const src = process.argv[2];
if (!src || src.startsWith('--')) { console.error('[counts_norm] 사용: node crossref_counts_normalize.js <dxr_crossref.json>'); process.exit(2); }
if (!fs.existsSync(src)) { console.error(`[counts_norm] 입력 없음: ${src}`); process.exit(2); }

let cx;
try { cx = JSON.parse(fs.readFileSync(src, 'utf8')); }
catch (e) { console.error(`[counts_norm] JSON 파싱 실패: ${e.message}`); process.exit(2); }

const items = cx.items || [];
const discovered = cx.discovered || [];
const next = {
  in: items.length,
  apply: items.filter((x) => x.branch === 'apply' && x.approved === true).length,
  locate: items.filter((x) => x.branch === 'locate').length + items.filter((x) => x.branch === 'apply' && x.approved !== true).length,
  discover: items.filter((x) => x.branch === 'discover').length + discovered.length,
  keep: items.filter((x) => x.branch === 'keep').length,
};

const prev = cx.counts || {};
const changed = JSON.stringify(prev) !== JSON.stringify(next);
if (changed) {
  cx.counts_raw = prev;
  cx.counts = next;
  cx._counts_note = '`counts` 는 소비부와 같은 식으로 재계산됨(crossref_counts_normalize.js). 에이전트 원본은 counts_raw.';
  fs.writeFileSync(src, JSON.stringify(cx, null, 2), 'utf8');
}

if (!process.argv.includes('--quiet')) {
  console.log(`[counts_norm] ${changed ? '보정' : '변경 없음'} — ${JSON.stringify(next)}`);
  if (changed) console.log(`[counts_norm] 에이전트 원본(counts_raw): ${JSON.stringify(prev)}`);
}
process.exit(0);
