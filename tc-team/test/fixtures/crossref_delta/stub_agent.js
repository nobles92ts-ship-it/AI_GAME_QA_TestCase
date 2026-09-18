'use strict';
// 테스트 스텁 에이전트 — finalize.sh 의 두 에이전트 호출(FINAL-5a · 델타 대조)을 프롬프트로 가른다.
//   STUB_PANEL : 5a 가 쓸 기획확인 배열(JSON)
//   STUB_MODE  : 'badid'  면 대조 결과 id 를 틀리게 낸다(판정 0건 경고 양성 표본)
//                'apply1' 이면 **첫 질의만** 답을 찾은 것(apply · approved:true)으로, 나머지는 keep 으로 낸다
//                (패널에서 빠지는 경로의 양성 표본 — 전량 keep 스텁만으로는 제거가 한 번도 시험되지 않는다)
const fs = require('fs');
const prompt = process.argv[2] || '';

if (prompt.includes('FINAL-5a')) {
  // 실물 5a 처럼 매번 _labels.json 을 새로 쓴다 — 지난번 주입 꼬리표는 남지 않는다
  const m = prompt.match(/"([^"]+_labels\.json)" Write/);
  if (!m) process.exit(3);
  const panel = JSON.parse(process.env.STUB_PANEL || '[]');
  fs.writeFileSync(m[1], JSON.stringify({ 기획확인: panel }, null, 2), 'utf8');
  console.log('LABELS_DONE');
  process.exit(0);
}

if (prompt.includes('## HANDOFF')) {
  const xin = (prompt.match(/- 입력: (\S+)/) || [])[1];
  const xout = (prompt.match(/- 산출: (\S+)/) || [])[1];
  if (!xin || !xout) process.exit(3);
  const bad = process.env.STUB_MODE === 'badid';
  const apply1 = process.env.STUB_MODE === 'apply1';
  // 기본 전량 keep — 단 term 은 일부러 줄여 쓴다(실측: 과거 델타 114건 중 1건을 에이전트가 고쳐 썼다)
  const items = JSON.parse(fs.readFileSync(xin, 'utf8')).items.map((x, i) => {
    const answered = apply1 && i === 0;
    return {
      id: bad ? 'X-' + x.id : x.id,
      term: String(x.term).slice(0, 6) + '…',
      branch: answered ? 'apply' : 'keep',
      source: answered ? '스텁 문서 > 핵심 규칙' : '',
      note: answered ? '스텁: 원문에 답이 있다' : '',
      approved: answered,
    };
  });
  fs.writeFileSync(xout, JSON.stringify({ items }, null, 2), 'utf8');
  fs.appendFileSync(xout + '.calls', '1\n');
  fs.writeFileSync(xout + '.cwd', process.cwd(), 'utf8');   // KB 선택이 작업 폴더를 탄다 — 어디서 돌았는지 남긴다
  process.exit(0);
}

process.exit(3);
