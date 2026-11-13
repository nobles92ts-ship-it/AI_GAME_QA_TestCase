'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const am = require('../lib/answers_merge');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; } catch (e) { fail++; console.error('FAIL ' + name + ': ' + e.stack); } }

// 실물처럼 CRLF (request_send.py 는 Windows 텍스트 모드로 쓴다 — 2026-11-06 첫 시험에서 0건이던 원인)
const ans = (...xs) => xs.map(([no, cell, stamp, q, a]) => `## ${no}. (${cell}) ${stamp}\r\n**질문** ${q}\r\n\r\n**답** ${a}\r\n`).join('\r\n');
const A1 = ['1', 'T3', '2026-10-28 14:00', '[값 미정] 몇 개?\r\n이유 줄', '20개입니다.'];
const A2 = ['2', 'T4', '2026-10-28 14:10', '[규칙 모호] 언제?', '추후 결정 예정입니다.'];
const A1b = ['1', 'T3', '2026-10-29 09:00', '[값 미정] 몇 개?\r\n이유 줄', '30개로 바뀌었습니다.'];

function root() { return fs.mkdtempSync(path.join(os.tmpdir(), 'ansmerge-')); }
function spec(r, name, { page, answers, analysis = '# 분석\nPart C\n', mtime } = {}) {
  const d = path.join(r, name);
  fs.mkdirSync(d);
  if (page) fs.writeFileSync(path.join(d, 'sheet_info.txt'), `TAB_NAME=${name}\nCONFLUENCE_URL=https://x/wiki/pages/${page}\n`);
  if (analysis !== null) fs.writeFileSync(path.join(d, 'analysis.md'), analysis);
  if (answers) fs.writeFileSync(path.join(d, '기획답변.md'), '# 기획 확인 답변 — x\r\n\r\n' + answers);
  if (mtime) fs.utimesSync(path.join(d, 'analysis.md'), mtime, mtime);
  return d;
}
const R = (d, f = 'analysis.md') => fs.readFileSync(path.join(d, f), 'utf8');

t('parseAnswers — CRLF·여러 줄 질문·같은 칸 재답은 마지막 것', () => {
  const xs = am.parseAnswers(ans(A1, A2, A1b));
  assert.deepStrictEqual(xs.map(x => [x.cell, x.answer]), [['T4', '추후 결정 예정입니다.'], ['T3', '30개로 바뀌었습니다.']]);
  assert.strictEqual(xs[1].question, '[값 미정] 몇 개?\n이유 줄');
});
t('featureName — 초안_·_vN·밑줄·공백을 뗀다', () => {
  assert.strictEqual(am.featureName('초안_캐릭터_따라가기_v2'), am.featureName('캐릭터 따라가기'));
  assert.strictEqual(am.featureName('기능BK'), am.featureName('기능BK'));
  assert.strictEqual(am.featureName('기능BK_v2'), am.featureName('기능BK'));
});
t('sync — 전 판 답이 **최신 판** 분석서 Part D 에 누적, 옛 판은 그대로', () => {
  const r = root();
  const v1 = spec(r, '초안_기능', { page: 7, answers: ans(A1) });
  const v2 = spec(r, '기능_v2', { page: 7, answers: ans(A2) });
  const { features } = am.sync(r);
  assert.strictEqual(features.length, 1);
  assert.strictEqual(features[0].latest, '기능_v2');
  const a = R(v2);
  assert.ok(a.startsWith('# 분석\nPart C\n') && a.includes(am.BEGIN) && a.trim().endsWith(am.END), a);
  assert.ok(a.indexOf('판 `기능_v2`') < a.indexOf('판 `초안_기능`'), '최신 판이 위');
  assert.ok(/미정 포함 — 패널 2번/.test(a) && /확정 — 패널 1번/.test(a));
  assert.strictEqual(R(v1), '# 분석\nPart C\n');
});
t('sync — 멱등 · 새 답이 오면 표식 사이만 바뀐다', () => {
  const r = root();
  const v1 = spec(r, '기능', { page: 7, answers: ans(A1) });
  am.sync(r);
  const first = R(v1);
  assert.strictEqual(am.sync(r).features[0].result, 'same');
  fs.appendFileSync(path.join(v1, '기획답변.md'), '\r\n' + ans(A1b));
  assert.strictEqual(am.sync(r).features[0].result, 'written');
  const second = R(v1);
  assert.ok(second.includes('30개로 바뀌었습니다') && !second.includes('20개입니다'));
  assert.strictEqual(second.split(am.BEGIN).length, 2, '블록이 하나뿐');
  assert.strictEqual(first.slice(0, first.indexOf(am.BEGIN)), second.slice(0, second.indexOf(am.BEGIN)));
});
t('sync — 새 판 폴더가 생기면 다음 실행에 누적본이 그리로 간다', () => {
  const r = root();
  spec(r, '기능', { page: 7, answers: ans(A1) });
  am.sync(r);
  const v2 = spec(r, '기능_v2', { page: 7 });
  assert.strictEqual(am.sync(r).features[0].latest, '기능_v2');
  assert.ok(R(v2).includes('20개입니다'));
});
t('sync — 이름이 같아도 page id 가 다르면 다른 기능(한 기획서·다른 탭 반대 경우 포함)', () => {
  const r = root();
  const a = spec(r, '기능', { page: 7, answers: ans(A1) });
  const b = spec(r, '기능_v2', { page: 8 });
  am.sync(r);
  assert.ok(R(a).includes('20개입니다'));
  assert.ok(!R(b).includes(am.BEGIN), '다른 기획서에 답이 넘어갔다');
});
t('sync — page id 가 달라도 새 판이 옛 탭을 은퇴시킨 기록이 있으면 한 기능(새 페이지로 옮긴 기획서)', () => {
  const r = root();
  const v1 = spec(r, '초안_기능', { page: 7, answers: ans(A1) });
  spec(r, '초안_기능_v2', { page: 7 });
  const v3 = spec(r, '기능_v3', { page: 9 });
  fs.mkdirSync(path.join(v3, 'retired_v2_1_20261102'));
  fs.writeFileSync(path.join(v3, 'retired_v2_1_20261102', 'retirement_manifest.json'), JSON.stringify({ targetTab: { title: '초안_기능_v2' } }));
  assert.strictEqual(am.sync(r).features[0].latest, '기능_v3');
  assert.ok(R(v3).includes('20개입니다') && !R(v1).includes(am.BEGIN));
});
t('sync — 같은 판 번호면 분석서가 최근인 쪽 · `_` 접두 폴더는 제외', () => {
  const r = root();
  const old = spec(r, '기능', { page: 7, answers: ans(A1), mtime: new Date('2026-01-01') });
  const neu = spec(r, '초안_기능', { page: 7, mtime: new Date('2026-06-01') });
  spec(r, '_기능_v9', { page: 7 });
  assert.strictEqual(am.sync(r).features[0].latest, '초안_기능');
  assert.ok(R(neu).includes('20개입니다') && !R(old).includes(am.BEGIN));
});
t('sync — 시트가 갈린 탭 답(--extra)은 이름으로 붙고, 못 붙이면 보고한다', () => {
  const r = root(), x = root();
  const v = spec(r, '기능', { page: 7 });
  fs.writeFileSync(path.join(x, '기능_기획답변.md'), ans(A2));
  fs.writeFileSync(path.join(x, '없는_기능_기획답변.md'), ans(A1));
  const res = am.sync(r, x);
  assert.ok(R(v).includes('시트 탭 기능'));
  assert.deepStrictEqual(res.unplaced, ['없는기능']);
});
t('sync — 답이 다 없어지면 남은 Part D 를 걷어낸다(본문은 그대로)', () => {
  const r = root();
  const v = spec(r, '기능', { page: 7, answers: ans(A1) });
  am.sync(r);
  fs.writeFileSync(path.join(v, '기획답변.md'), '# 기획 확인 답변 — x\r\n');
  assert.strictEqual(am.sync(r).features[0].result, 'removed');
  assert.strictEqual(R(v), '# 분석\nPart C\n');
  assert.strictEqual(am.sync(r).features.length, 0, '두 번째는 할 일 없음');
});
t('sync — 최신 판에 분석서가 없으면 쓰지 않고 missing', () => {
  const r = root();
  spec(r, '기능', { page: 7, answers: ans(A1) });
  spec(r, '기능_v2', { page: 7, analysis: null });
  assert.strictEqual(am.sync(r).features[0].result, 'missing');
});
t('collect — 새 판 S1 용: 다른 판 답만 모으고, 없으면 파일을 지운다', () => {
  const r = root();
  spec(r, '초안_기능', { page: 7, answers: ans(A1) });
  const v2 = spec(r, '기능_v2', { page: 7, answers: ans(A2) });
  const v3 = spec(r, '기능_v3', { page: 7, analysis: null });
  assert.strictEqual(am.collect(v3), 2);
  const p = R(v3, 'prior_answers.md');
  assert.ok(p.includes('20개입니다') && p.includes('추후 결정') && !p.includes(am.BEGIN));
  const solo = spec(r, '다른_기능', { page: 9, analysis: null });
  fs.writeFileSync(path.join(solo, 'prior_answers.md'), '지난 런');
  assert.strictEqual(am.collect(solo), 0);
  assert.ok(!fs.existsSync(path.join(solo, 'prior_answers.md')), '지난 런 파일이 남았다');
  assert.ok(fs.existsSync(path.join(v2, '기획답변.md')));
});
t('run_pipeline_s1only.sh — STEP 0-답변이 STEP 1 앞에서 collect 하고 핸드오프에 싣는다', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'run_pipeline_s1only.sh'), 'utf8');
  const i = s.indexOf('answers_merge.js" "${AARGS[@]}"'), j = s.indexOf('# ── STEP 1 설계');
  assert.ok(i > 0 && i < j, 'collect 가 STEP 1 앞에 없다');
  assert.ok(/AARGS=\(collect "\$SPEC"\)/.test(s) && /answers_extra_dir/.test(s));
  assert.ok(/병기\. 없으면 현행대로 유형만 기재\)\$\{PRIOR_LINE\}/.test(s), '설계 핸드오프에 PRIOR_LINE 이 없다');
});
console.log(`결과: ${pass} PASS / ${fail} FAIL`); process.exit(fail ? 1 : 0);
