'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const wt = require('../lib/waiting_tcs');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; } catch (e) { fail++; console.error('FAIL ' + name + ': ' + e.stack); } }

const H = ['TC ID', '대분류', '중분류', '소분류', '검증단계', '재현 스탭', '플랫폼', 'PC 결과', '모바일 결과', '비고'];
const row = (id, step, note) => [id, '기본기능', '', '', '예외', step, 'PC', '미진행', 'N/A', note];
function spec(files) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'waiting-'));
  for (const [f, v] of Object.entries(files)) fs.writeFileSync(path.join(d, f), JSON.stringify(v));
  return d;
}
const W = (rows) => ({ headers: H, rows });
const BASE = W([
  // 2026-11-06 실례(기능BN TC 031) — 답을 기다리는 모양
  row('031', '인계 로딩 중 기기2 강제 종료 뒤 수동 로그인하면 귀속 기기가 확인된 복구 정책과 일치하는지 확인', '기획 확인 필요'),
  row('032', '방치 종료 뒤 재접속하면 확정 정책과 일치하는지 확인', '기획 확인 필요'),
  // 기대값이 원문으로 정해진 TC — 비고만 붙어도 대기 아님
  row('033', '10초 동안 실드가 유지되는지 확인', '기획 확인 필요'),
  // 비고 없음 — 대기 아님
  row('034', '확정된 정책과 일치하는지 확인', ''),
]);

t('extract — 비고 「기획 확인 필요」 + 대기 문구만 뽑는다', () => {
  const d = spec({ 'tcteam_tc_final.json': BASE });
  assert.deepStrictEqual(wt.extract(d).map(x => x.tc_id), ['031', '032']);
});
t('check — 덮개가 없으면 전부 걸린다(양성 표본)', () => {
  const d = spec({ '_waiting_tcs.json': { '기다리는TC': wt.extract(spec({ 'tcteam_tc_final.json': BASE })) },
    '_labels.json': { '기획확인': ['[규칙 모호] 방치 중 교대?\n이유'] } });
  assert.deepStrictEqual(wt.check(d), ['031', '032']);
});
t('check — 패널 번호 범위 밖·빈 「답 있음」은 덮개가 아니다', () => {
  const d = spec({ '_waiting_tcs.json': { '기다리는TC': [{ tc_id: '031' }, { tc_id: '032' }, { tc_id: '035' }] },
    '_labels.json': { '기획확인': ['a?', 'b?'] },
    '_waiting_cover.json': { '덮음': { '031': '패널 3', '032': '답 있음:', '035': '패널 0' } } });
  assert.deepStrictEqual(wt.check(d), ['031', '032', '035']);
});
t('check — 패널 질문·인용된 답이면 통과', () => {
  const d = spec({ '_waiting_tcs.json': { '기다리는TC': [{ tc_id: '031' }, { tc_id: '032' }] },
    '_labels.json': { '기획확인': ['a?', 'b?'] },
    '_waiting_cover.json': { '덮음': { '031': '패널 2', '032': '답 있음: confluence_raw.md §2-3 「재접속 시 기존 세션 유지」' } } });
  assert.deepStrictEqual(wt.check(d), []);
});
t('check — 기다리는 TC 가 없으면 덮개 파일 없이 통과', () => {
  assert.deepStrictEqual(wt.check(spec({ '_waiting_tcs.json': { '기다리는TC': [] } })), []);
  assert.deepStrictEqual(wt.check(spec({})), []);
});
t('CLI — check 는 덮이지 않으면 exit 3 과 uncovered 줄', () => {
  const d = spec({ 'tcteam_tc_final.json': BASE, '_labels.json': { '기획확인': ['a?'] } });
  const cli = path.join(__dirname, '..', 'lib', 'waiting_tcs.js');
  assert.strictEqual(execFileSync('node', [cli, 'extract', d]).toString().trim(), 'waiting 2');
  let code = 0, out = '';
  try { execFileSync('node', [cli, 'check', d]); } catch (e) { code = e.status; out = e.stdout.toString(); }
  assert.strictEqual(code, 3);
  assert.deepStrictEqual(out.trim().split('\n'), ['uncovered 031', 'uncovered 032']);
});
t('헤더 순서가 바뀌어도 이름으로 찾는다', () => {
  const h = ['TC ID', '비고', '재현 스탭'];
  const d = spec({ 'tcteam_tc_final.json': { headers: h, rows: [['040', '기획 확인 필요', '기획 확정값으로 표시되는지 확인']] } });
  assert.deepStrictEqual(wt.extract(d).map(x => x.tc_id), ['040']);
});
console.log(`결과: ${pass} PASS / ${fail} FAIL`); process.exit(fail ? 1 : 0);
