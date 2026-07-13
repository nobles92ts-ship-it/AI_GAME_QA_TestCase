'use strict';
const assert = require('assert');
const fs = require('fs');
const { slice } = require('../lib/slicer.js');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  PASS ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' — ' + e.message); } }

const doc = [
  '# 자동 사냥 기능',
  '',
  '> 메타: 저장자',
  '',
  '---',            // 구분선 — 헤딩 아님
  '',
  '자동 사냥 규칙',
  '========',        // setext h1
  '',
  '* 자동 사냥 버튼 클릭 시 설정 반경 내에서 시작하는지 확인',
  '* 우선순위 1순위는 나를 공격 중인 몬스터',
  '  + 같은 순위 여럿이면 가까운 대상 우선',   // depth 2
  '    - 너무 깊은 항목은 규칙에서 제외',      // depth 3 (ruleDepth=2 기본이면 배제)
  '* PC',           // 짧음 — 배제
  '* ![img](http://x/y.png)',  // 이미지 — 배제',
  '',
  '### 예외사항',    // atx h3
  '',
  '1. 자동 사냥 도중 사망 시 종료되는지 확인',
  '2. 마을 안에서는 반경 내 몬스터가 있어도 수행하지 않는지 확인',
].join('\n');

console.log('slicer.js 테스트');

const r = slice(doc);

t('헤딩 3개(# 제목, setext 규칙, ### 예외) — 구분선 --- 제외', () => {
  assert.strictEqual(r.sections.length, 3, '섹션 수: ' + r.sections.map(s => s.heading).join('|'));
  assert.strictEqual(r.sections[1].heading, '자동 사냥 규칙');
  assert.strictEqual(r.sections[1].level, 1); // setext ===
  assert.strictEqual(r.sections[2].heading, '예외사항');
  assert.strictEqual(r.sections[2].level, 3); // atx ###
});

t('구분선 ---가 setext h2로 오탐되지 않음', () => {
  assert.ok(!r.sections.some(s => /^-+$/.test(s.heading) || s.heading === ''));
});

t('규칙 추출 — 짧은 항목·이미지·과다 depth 배제', () => {
  const ruleTexts = r.rules.map(x => x.text);
  assert.ok(ruleTexts.some(x => x.includes('설정 반경 내에서 시작')));
  assert.ok(ruleTexts.some(x => x.includes('같은 순위 여럿이면')), 'depth2는 포함');
  assert.ok(!ruleTexts.some(x => x.includes('너무 깊은 항목')), 'depth3은 배제(ruleDepth=2)');
  assert.ok(!ruleTexts.includes('PC'), '짧은 항목 배제');
  assert.ok(!ruleTexts.some(x => x.startsWith('![')), '이미지 배제');
});

t('rule_id 형식 R-<sec>.<n> + sec_id 연결', () => {
  for (const rl of r.rules) {
    assert.ok(/^R-\d+\.\d+$/.test(rl.rule_id), 'rule_id: ' + rl.rule_id);
    assert.ok(rl.sec_id && r.sections.some(s => s.sec_id === rl.sec_id));
  }
});

t('예외사항 번호목록도 규칙으로 추출', () => {
  assert.ok(r.rules.some(x => x.text.includes('사망 시 종료')));
  assert.ok(r.rules.some(x => x.text.includes('마을 안에서는')));
});

t('섹션 원문 보존 — text에 하위 리스트 원문 포함', () => {
  const sec = r.sections.find(s => s.heading === '자동 사냥 규칙');
  assert.ok(sec.text.includes('우선순위 1순위'));
});

t('헤딩 없는 문서 = 단일 섹션 폴백', () => {
  const r2 = slice('그냥 평문\n리스트도 없음');
  assert.strictEqual(r2.sections.length, 1);
  assert.strictEqual(r2.sections[0].sec_id, 'R-1');
});

// integration smoke against a local spec (skips without fixture)
t('integration: local spec confluence_raw parses (skips without fixture)', () => {
  const p = './fixtures/sample_feature/confluence_raw.md';
  if (!fs.existsSync(p)) { console.log('    (skip — no fixture)'); return; }
  const real = slice(fs.readFileSync(p, 'utf8'));
  assert.ok(real.sections.length >= 3, 'sections ' + real.sections.length);
  assert.ok(real.rules.length >= 10, 'rules ' + real.rules.length);
  console.log(`    sections ${real.sections.length} / rules ${real.rules.length}`);
});

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
