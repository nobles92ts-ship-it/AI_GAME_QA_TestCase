'use strict';
// 시트 열 레이아웃 계약 게이트 — 시트를 **만드는 쪽**과 **검증하는 쪽**이 같은 세대인지 본다.
//
// 왜 (2026-09-18 실사고): create_gsheet_tc_from_json.js 가 헤더를 11열로 쓰고 있는데
//   validate_tc_rows.js 는 12열(링크 열 신설 이후)을 가정한 채로 배포된 적이 있다.
//   헤더가 함께 오는 입력은 헤더명으로 찾아 자동 대응하지만, **헤더 없는 시트 덤프**(positional)는
//   인덱스가 고정이라 비고 자리에서 담당자를 읽는다 — 값이 조용히 한 칸 밀린다.
//   기존 테스트는 두 파일을 각각만 봐서 이 조합을 한 번도 재지 않았다.
//
// ⚠ 이 게이트는 **소스 문자열을 읽는다**(require 가 아니라). 두 상수는 서로 다른 파일의 서로 다른
//   표현(배열 리터럴 / 삼항 인덱스)이고, 계약이 어긋나는 지점이 바로 그 표현들이기 때문이다.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const UTIL = path.join(__dirname, '..', '..', 'scripts', 'util');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  PASS ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' — ' + e.message); } }

function headerColumns() {
  const src = fs.readFileSync(path.join(UTIL, 'create_gsheet_tc_from_json.js'), 'utf8');
  const m = src.match(/const header = \[([^\]]+)\]/);
  assert.ok(m, 'create_gsheet_tc_from_json.js 에서 header 배열을 찾지 못했다 — 선언 형태가 바뀌었으면 이 게이트부터 고칠 것');
  return m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
}

function positionalMemoIndex() {
  const src = fs.readFileSync(path.join(UTIL, 'validate_tc_rows.js'), 'utf8');
  const m = src.match(/const IDX_J = positional \? (\d+) : (\d+)/);
  assert.ok(m, 'validate_tc_rows.js 에서 IDX_J 선언을 찾지 못했다 — 선언 형태가 바뀌었으면 이 게이트부터 고칠 것');
  return { positional: Number(m[1]), tcData: Number(m[2]) };
}

t('시트를 만드는 쪽과 검증하는 쪽의 비고 열 위치가 같다 (헤더 없는 덤프에서 한 칸 밀리지 않는다)', () => {
  const header = headerColumns();
  const idx = positionalMemoIndex();
  const memo = header.indexOf('비고');
  assert.ok(memo >= 0, `헤더에 '비고' 가 없다: ${header.join('|')}`);
  assert.strictEqual(
    memo, idx.positional,
    `헤더의 비고=${memo}번(${header.length}열) ↔ validate 의 positional 비고=${idx.positional}번 — ` +
    `두 파일이 다른 세대다. 열 구조는 세트로 올려야 한다 (create_gsheet · apply_format_tab · add_project_info · jira_assignees)`);
});

t('담당자가 마지막 열이다 (뒤에 열을 붙이면 트레일링 ragged 판정이 깨진다)', () => {
  const header = headerColumns();
  assert.strictEqual(header[header.length - 1], '담당자', `마지막 열=${header[header.length - 1]}`);
});

t('tc_data(7요소) 경로의 비고 인덱스는 시트 레이아웃과 무관하게 마지막이다', () => {
  const idx = positionalMemoIndex();
  assert.strictEqual(idx.tcData, 6, `tc_data 비고=${idx.tcData} — 7요소 계약이 바뀌었으면 tc-생성.md 와 같이 볼 것`);
});

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
