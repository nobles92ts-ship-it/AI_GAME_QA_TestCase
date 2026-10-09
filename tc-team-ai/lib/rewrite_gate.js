'use strict';
/**
 * rewrite_gate.js — AI 다시 쓰기(전제·조작·기대·관측)가 원문 재현 스탭의 뜻을 보존했는지 보는 결정론 게이트.
 *
 * 다시 쓰기는 LLM 단계라 문장을 «고쳐 쓴다». 그래서 원문에서 바뀌면 안 되는 닻을 뽑아 대조한다:
 *   숫자(빠짐·더함 둘 다) · 영문 이름(A채널의 A, HP) · 따옴표/기호(「…」, (?)) · 부정 극성(~않는지) · 핵심 낱말 비율.
 * 걸린 TC 는 다시 쓰기를 버리고 원문만 내보낸다(fail-closed) — 판정은 여기, 처리는 호출자.
 *
 * ⚠ 못 잡는 것: 긍정 → 부정 뒤집힘(「숫자 대신 ?」 같은 정상 바꿔 말하기와 구분이 안 된다), 숫자 없는 조건 추가.
 *   그래서 묶음 규칙은 «재현 스탭(원문)이 정본, 네 칸은 도움말»이다 (skills/tc-team-ai/rules/ai-실행규칙.md).
 */
const FIELDS = ['전제', '조작', '기대', '관측'];
const REQUIRED = ['조작', '기대', '관측'];
const MAX_ITEMS = 6;
const MAX_ITEM_CHARS = 300;
const COVERAGE_MIN = 0.6;   // 원문 핵심 낱말 중 다시 쓴 글에 남아야 하는 비율 — 첫 실런 분포로 재검토할 값
const STOP = new Set(['확인', '상태', '경우', '해당', '이후', '다음', '각각', '매번', '여부', '진행']);

const NUM_RE = /\d+(?:[.,]\d+)*/g;
const IDENT_RE = /[A-Za-z][A-Za-z0-9_]*/g;
const QUOTE_RE = /[「『"'`]([^」』"'`\n]{1,20})[」』"'`]/g;
const PAREN_RE = /[(（]([^)）가-힣\n]{1,8})[)）]/g;   // 한글 없는 짧은 괄호 — (?) 같은 기호 표기
const WORD_RE = /[가-힣]{2,}/g;
const NEG_HEAD_RE = /^(않|없|못|아니)/;
const NEG_ANY_RE = /(않|없|못|아니|안 )/;
const LIST_MARK_RE = /^\s*(?:\d+[.)]|[-*•·])\s+/;

const uniq = (a) => [...new Set(a)];
const stripMark = (s) => String(s).replace(LIST_MARK_RE, '');
const bodyOf = (rw) => FIELDS.flatMap((k) => (Array.isArray(rw[k]) ? rw[k] : []).map(stripMark)).join('\n');

// 「…는지 확인」 바로 앞 낱말이 않·없·못·아니로 시작하면 부정. 그 꼴이 아니면 판정하지 않는다(null).
function polarityOf(sentence) {
  const m = String(sentence).trim().match(/([가-힣]+)\s*확인\s*[.。]?\s*$/);
  if (!m) return null;
  return NEG_HEAD_RE.test(m[1]) ? 'neg' : 'pos';
}

function anchorsOf(sentence) {
  const s = String(sentence);
  const marks = [...s.matchAll(QUOTE_RE), ...s.matchAll(PAREN_RE)].map((m) => m[1].trim()).filter(Boolean);
  const stems = (s.match(WORD_RE) || []).map((w) => w.slice(0, 2)).filter((w) => !STOP.has(w) && !NEG_HEAD_RE.test(w));
  return {
    numbers: uniq(s.match(NUM_RE) || []),
    idents: uniq(s.match(IDENT_RE) || []),
    marks: uniq(marks),
    stems: uniq(stems),
    polarity: polarityOf(s),
  };
}

function shapeReasons(rw) {
  if (!rw || typeof rw !== 'object') return ['shape:전체'];
  const out = [];
  for (const k of FIELDS) {
    const v = rw[k];
    if (!Array.isArray(v)) { out.push(`shape:${k}`); continue; }
    if (v.length > MAX_ITEMS) out.push(`too_many:${k}`);
    if (v.some((x) => typeof x !== 'string' || !x.trim() || x.length > MAX_ITEM_CHARS)) out.push(`bad_item:${k}`);
    if (!v.length && REQUIRED.includes(k)) out.push(`empty:${k}`);
  }
  return out;
}

function anchorReasons(original, rw) {
  const a = anchorsOf(original);
  const body = bodyOf(rw);
  const nums = uniq(body.match(NUM_RE) || []);
  const idents = new Set(body.match(IDENT_RE) || []);
  const out = [
    ...a.numbers.filter((n) => !nums.includes(n)).map((n) => `number_missing:${n}`),
    ...nums.filter((n) => !a.numbers.includes(n)).map((n) => `number_added:${n}`),
    ...a.idents.filter((w) => !idents.has(w)).map((w) => `ident_missing:${w}`),
    ...a.marks.filter((m) => !body.includes(m)).map((m) => `mark_missing:${m}`),
  ];
  if (a.polarity === 'neg' && !NEG_ANY_RE.test(rw['기대'].join(' '))) out.push('polarity_lost');
  if (a.stems.length) {
    const cov = a.stems.filter((st) => body.includes(st)).length / a.stems.length;
    if (cov < COVERAGE_MIN) out.push(`coverage:${cov.toFixed(2)}`);
  }
  return out;
}

/** 한 TC 의 다시 쓰기 판정 → { ok, reasons[] } */
function checkRewrite(original, rw) {
  const shape = shapeReasons(rw);
  const reasons = shape.length ? shape : anchorReasons(original, rw);
  return { ok: reasons.length === 0, reasons };
}

/** 청크 산출물의 id 집합 판정 — 요청한 id 를 정확히 한 번씩. 조인은 id 로만 한다(입력 필드 echo 를 믿지 않는다). */
function checkChunk(expectedIds, out) {
  if (!out || !Array.isArray(out.rows)) return { ok: false, errors: ['rows 배열 없음'] };
  const errors = [];
  const seen = new Map();
  out.rows.forEach((r, i) => {
    if (!r || typeof r.id !== 'string') { errors.push(`rows[${i}] id 가 문자열이 아님`); return; }
    seen.set(r.id, (seen.get(r.id) || 0) + 1);
  });
  const want = new Set(expectedIds);
  for (const [id, n] of seen) {
    if (!want.has(id)) errors.push(`요청에 없는 id ${id}`);
    if (n > 1) errors.push(`id ${id} 중복 ${n}회`);
  }
  for (const id of want) if (!seen.has(id)) errors.push(`id ${id} 누락`);
  return { ok: errors.length === 0, errors };
}

module.exports = { FIELDS, COVERAGE_MIN, anchorsOf, polarityOf, checkRewrite, checkChunk };
