'use strict';
// 테스트 스텁 에이전트 — run_pipeline_s1only.sh 의 에이전트 호출 3종을 --agent 이름으로 가른다.
//   tc-team-designer : 설계 산출물(analysis.md · tc_design.md) + step_result(HANDOFF 의 STEP — 1 설계 / 3 설계수정)
//   tc-team-대조      : dxr_crossref.json(keep 1건) + 작업 폴더 기록(.cwd) — KB 선택이 작업 폴더를 탄다
//                        + 받은 인계서 원문(.handoff) — 인계서 입력 범위가 규칙(tc-대조.md §1.1)만큼 넓은지 본다
//   tc-team-설계검수  : step_result(step 2 · needs_fix = env STUB_NEEDS_FIX 가 '1' 일 때만 true → STEP 3 진입
//                        · analysis_gap = env STUB_ANALYSIS_GAP(기본 0 — 1 이상이면 STEP 3 설계자가 opus 자리로 탄다))
// 모든 호출은 calls.tsv 에 `에이전트\t출력 상한 env\t--model 값\tTCTEAM_OPUS_MODEL` 한 줄을 남긴다
// (s1_designer_maxout.test.js · s1_opus_pin.test.js 가 호출별 env 를 본다 — 앞 두 칸만 읽는 쪽은 뒤 칸을 무시한다).
const fs = require('fs');
const path = require('path');

const [agent, prompt = ''] = process.argv.slice(2);
const field = name => (prompt.match(new RegExp(`- ${name}: (\\S+)`)) || [])[1];
const W = (p, o) => fs.writeFileSync(p, typeof o === 'string' ? o : JSON.stringify(o, null, 2), 'utf8');

fs.appendFileSync(path.join(__dirname, 'calls.tsv'),
  `${agent}\t${process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS ?? 'unset'}\t${process.env.STUB_MODEL_ARG || '-'}\t${process.env.TCTEAM_OPUS_MODEL ?? 'unset'}\n`, 'utf8');

if (agent === 'tc-team-designer') {
  const spec = field('specs 경로');
  if (!spec) process.exit(3);
  W(path.join(spec, 'analysis.md'), '# analysis 스텁\n');
  W(path.join(spec, 'tc_design.md'), '# tc_design 스텁\n## 소분류\n');
  W(path.join(spec, 'step_result.json'), { step: Number(field('STEP')) || 1, status: 'success' });
  process.exit(0);
}

if (agent === 'tc-team-대조') {
  const out = field('산출');
  if (!out) process.exit(3);
  W(out, { items: [{ id: 'C1-1', term: '스텁 항목', branch: 'keep', source: '', note: '', approved: false }], discovered: [] });
  W(out + '.cwd', process.cwd());
  W(out + '.handoff', prompt);
  process.exit(0);
}

if (agent === 'tc-team-설계검수') {
  const spec = field('specs 경로');
  if (!spec) process.exit(3);
  W(path.join(spec, 'step_result.json'), { step: 2, status: 'success', needs_fix: process.env.STUB_NEEDS_FIX === '1', analysis_gap: Number(process.env.STUB_ANALYSIS_GAP) || 0 });
  process.exit(0);
}

process.exit(3);
