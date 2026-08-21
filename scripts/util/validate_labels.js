#!/usr/bin/env node
/**
 * validate_labels.js — FINAL-5a 산출물(_labels.json) 검증 + 인용부호 교정 1회
 *
 * 배경(2026-08-07 기능B_v3 실사고): 5a agent가 기획서 문구를 인용하면서 `"`를
 *   이스케이프하지 않아 _labels.json 전체가 무효 JSON이 됐다. apply_labeling.js는 파싱에
 *   실패했지만 완료처리가 try/continue 정책이라 런은 exit 20으로 완주했고, L/M 패널
 *   (기획 확인 요청 9건)이 통째로 빠진 채 초록불로 끝났다 — 사흘 뒤 사람이 시트를
 *   직접 열어보고서야 발견. 내용은 온전했고 이스케이프 1곳 때문에 9건이 전부 유실됐다.
 *
 * 하는 일:
 *   1. JSON.parse — 성공하면 그대로 통과
 *   2. 실패하면 문자열 값 안의 이스케이프 안 된 `"` → `\"` 교정을 **1회만** 시도 후 재파싱.
 *      성공하면 교정본을 제자리에 쓰고 깨진 원본은 _labels.broken.json 으로 보존한다.
 *   3. 파싱된 뒤 규격 검사(태그 4종 · 질문+사유 2줄) — 위반은 건수만 보고(기재를 막지 않음).
 *
 * 사용법: node validate_labels.js <_labels.json 경로>
 * 종료코드: 0=기재 가능 / 2=기재 불가(파일 없음·파싱 불가·구조 불량)
 * 출력: 사람이 읽는 로그 라인 — 호출자(finalize.sh)가 [FINALIZE] 접두를 붙여 chain.log로 흘린다.
 */
'use strict';
const fs = require('fs');

// 라벨링_기준.md §1 "기획 확인 요청 — 태그 4종"
const TAGS = ['[값 미정]', '[규칙 모호]', '[규칙 없음]', '[참조 공백]'];

/**
 * 라벨링_기준.md §1 "문장 형식" — 2줄차에서 금지한 QA 내부 어휘.
 *
 * 규칙이 **이름을 대서 금지한 4종만** 본다. "확인할 수 없다·알 수 없다·판단할 수 없다"는
 * 평범한 한국어라 금지 대상이 아니고, 실제로 통과 라벨들이 그 표현을 쓰고 있다.
 * 넓히면 정상 문장을 잡으므로 규칙 열거를 넘어서지 않는다.
 *
 * 근거(2026-08-10 전수 실측): 규칙 도입(08-04) 이후 라벨 77건 중 9건(12%)에 `판정할 수 없습니다`가
 *   남아 있었다 — 2개 런에 몰림(기능B 7 · 자동_전투_블랙리스트_시스템 2).
 *   문장은 이미 사람 말이고 금지어 한 개만 남은 상태라, 규칙 개정이 아니라 검출이 빠진 건이다.
 */
const BANNED_WORDS = [
  { re: /판정할 수 없|판정\s*불가/, name: '판정할 수 없음' },
  { re: /검증 범위/, name: '검증 범위' },
  { re: /경계값/, name: '경계값' },
  { re: /참조 공백/, name: '참조 공백' },  // 선두 태그 표기는 제외 — 본문에 섞였을 때만 잡는다
];

/**
 * 문자열 값 안의 생 따옴표를 이스케이프한다(1회 교정용).
 *
 * 판정: 문자열 내부의 `"`는 **다음 비공백 문자가 구조 문자(: , } ])일 때만** 종료 따옴표로 본다.
 *   그 외는 본문에 섞인 생 따옴표로 보고 `\"`로 바꾼다.
 * 한계: 생 따옴표 바로 뒤에 `,`가 오는 문장(예: 그는 "안녕", 하고)은 종료로 오판한다 —
 *   그 경우 재파싱이 실패하고 호출자가 실패 배너를 띄운다(fail-closed, 2차 교정 없음).
 */
function escapeStrayQuotes(src) {
  let out = '';
  let inStr = false;
  let fixed = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (!inStr) {
      out += c;
      if (c === '"') inStr = true;
      continue;
    }
    if (c === '\\') { out += c + (src[i + 1] || ''); i++; continue; }  // 이스케이프 쌍은 통째로 복사
    if (c === '"') {
      let j = i + 1;
      while (j < src.length && /\s/.test(src[j])) j++;
      if (j >= src.length || ':,}]'.includes(src[j])) { out += c; inStr = false; }
      else { out += '\\"'; fixed++; }
      continue;
    }
    out += c;
  }
  return { text: out, fixed };
}

/** 규격 검사 — 태그 4종으로 시작하는지 · 질문+사유 2줄인지 · 금지 어휘가 없는지. 위반 건수만 돌려준다. */
function checkSpec(items) {
  const badTag = [];
  const badForm = [];
  const banned = [];
  items.forEach((it, i) => {
    const s = String(it);
    // `[참조 공백·BLOCK]`은 라벨링_기준.md §6 예시에 나오는 같은 태그의 표기 변형 — 위반 아님
    const tag = (s.match(/^\[([^\]]+)\]/) || [])[1];
    const canon = tag ? '[' + tag.replace(/·BLOCK$/, '') + ']' : null;
    if (!canon || !TAGS.includes(canon)) badTag.push(i + 1);
    // 라벨링_기준.md §문장 형식 = 1줄차 질문(물음표로 끝) + 2줄차 테스터 사정 한 줄.
    // 구 형식의 `\n→` 마커를 보던 검사를 규칙서 형식으로 교체(2026-08-12). 08-04 개정으로
    // 화살표가 없어졌는데 검사만 남아, 규격을 지킨 라벨 12/12를 위반으로 보고하고 있었다
    // (센티넬_소환_시스템 실측). 늑대소년이 된 검증기는 08-07 사고를 못 막는다.
    const [question, ...rest] = s.split('\n');
    if (!/\?\s*$/.test(question) || !rest.join('\n').trim()) badForm.push(i + 1);
    // 금지 어휘는 선두 태그를 떼고 본문만 본다 — `[참조 공백]` 태그 자체를 잡으면 안 된다
    const body = s.replace(/^\[[^\]]+\]\s*/, '');
    BANNED_WORDS.forEach((w) => { if (w.re.test(body)) banned.push({ idx: i + 1, word: w.name }); });
  });
  return { badTag, badForm, banned };
}

const p = process.argv[2];
if (!p) { console.log('사용법: node validate_labels.js <_labels.json 경로>'); process.exit(2); }

let raw;
try {
  raw = fs.readFileSync(p, 'utf8');
} catch (e) {
  console.log(`_labels.json 없음 — ${p}`);
  process.exit(2);
}

let data = null;
let firstErr = '';
try {
  data = JSON.parse(raw);
} catch (e) {
  firstErr = e.message;
  console.log(`JSON 파싱 실패 — ${firstErr}`);
  const { text, fixed } = escapeStrayQuotes(raw);
  if (!fixed) {
    console.log('이스케이프 교정 1회 시도 → 교정할 생 따옴표 없음 (다른 원인)');
    process.exit(2);
  }
  try {
    data = JSON.parse(text);
  } catch (e2) {
    console.log(`이스케이프 교정 1회 시도 → 실패 (${e2.message})`);
    process.exit(2);
  }
  const bak = p.replace(/\.json$/, '') + '.broken.json';
  fs.writeFileSync(bak, raw);
  fs.writeFileSync(p, text);
  console.log(`이스케이프 교정 1회 시도 → 성공 (생 따옴표 ${fixed}곳) · 원본 보존 ${bak}`);
}

if (!data || !Array.isArray(data['기획확인'])) {
  console.log('구조 불량 — "기획확인" 배열 없음');
  process.exit(2);
}

const items = data['기획확인'];
const { badTag, badForm, banned } = checkSpec(items);
const brief = (arr) => arr.slice(0, 5).join('·') + (arr.length > 5 ? ` 외 ${arr.length - 5}` : '');
console.log(`검증 통과 — 기획확인 ${items.length}건 (태그 위반 ${badTag.length} · 문장형식 위반 ${badForm.length} · 금지 어휘 ${banned.length})`);
if (badTag.length) console.log(`  └ 태그 4종 아님: ${brief(badTag)}번째 항목`);
if (badForm.length) console.log(`  └ 문장형식 위반(1줄차 물음표 없음 또는 2줄차 사유 없음): ${brief(badForm)}번째 항목 — 라벨링_기준.md §문장 형식`);
if (banned.length) {
  const byWord = new Map();
  banned.forEach((b) => byWord.set(b.word, (byWord.get(b.word) || []).concat(b.idx)));
  byWord.forEach((idxs, word) => {
    console.log(`  └ 금지 어휘 "${word}": ${brief(idxs)}번째 항목 — 라벨링_기준.md §문장 형식(2줄차는 사람 말로)`);
  });
}
process.exit(0);
