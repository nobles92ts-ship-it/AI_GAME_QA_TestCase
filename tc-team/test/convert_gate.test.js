'use strict';
// direct_convert.js convert 단계 골격 게이트 — 분류 동작표현 위반을 F 문장화 이전에 차단하는지 검증
// (2026-08-16: 위반 설계가 convert를 통과해 S3 문장화 31분을 태운 뒤 merge에서 exit 4로 죽던 결함)
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { validateSkeleton, validatePreWrite } = require('../../scripts/util/validate_tc_rows.js');

const CONVERT = path.join(__dirname, '..', '..', 'scripts', 'util', 'direct_convert.js');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  PASS ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' — ' + e.message); } }

// 소분류(cat3)만 치환되는 최소 설계서 — 트리/배분표/기본기능표 3종을 모두 갖춘 파싱 가능 형태
function design(cat3) {
  return `# TC 설계서 (convert 게이트 유닛테스트 픽스처 — 실제 기능 아님)

## 기본기능 검증 항목

| # | 대분류 | 중분류 | 소분류 | 검증단계 | 검증 내용 (간략) | 플랫폼 |
|---|--------|--------|--------|----------|-----------------|--------|
| 1 | 기본기능 | 우편 시스템 | ${cat3} | 정상 | 우편 배너 영역이 표시되는지 | PC |

## 분류 그룹핑 트리

1. **우편 시스템** (대분류)
   1.1 우편 목록 표시 (중분류)
       - ${cat3} [HIGH] [PC/모바일]
         → 정상-1: 배너가 상단 영역에 노출되는지
         → 부정-1: 배너 문구가 누락된 상태에서 영역이 접히는지

## 검증단계 사전 배분표

| 대분류 | 중분류 | 소분류 | 리스크 | 정상 | 부정 | 예외 | 소계 | 비고 |
|--------|--------|--------|--------|------|------|------|------|------|
| 우편 시스템 | 우편 목록 표시 | ${cat3} | HIGH | 1 | 1 | 0 | 2 | 단순 표시 |
`;
}

const CLEAN = '우편 배너 노출 규격 화면';
const DIRTY = '우편 배너 버튼 클릭 화면'; // FORBIDDEN_VERBS_IN_CATEGORY: /버튼을?\s*클릭/i

function runConvert(cat3) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'convgate-'));
  const designPath = path.join(dir, 'tc_design.md');
  fs.writeFileSync(designPath, design(cat3));
  const r = spawnSync(process.execPath, [CONVERT, 'convert', designPath, dir], { encoding: 'utf8' });
  const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; } };
  return { status: r.status, stderr: r.stderr || '', skeleton: read('tc_skeleton.json'), blocker: read('conversion_blocker.json') };
}

console.log('direct_convert.js convert 골격 게이트 테스트');

t('정상 설계 → exit 0 + tc_skeleton.json 생성 (게이트 오탐 없음)', () => {
  const r = runConvert(CLEAN);
  assert.strictEqual(r.status, 0, `exit ${r.status} / stderr: ${r.stderr.slice(0, 300)}`);
  assert.ok(r.skeleton, 'tc_skeleton.json 미생성');
  assert.strictEqual(r.skeleton.total, 3); // 기본기능 1 + leaf 2
  assert.strictEqual(r.blocker, null, 'conversion_blocker.json이 남으면 안 됨');
});

t('분류 동작표현 위반 → 문장화 전에 exit 4 + conversion_blocker.json', () => {
  const r = runConvert(DIRTY);
  assert.strictEqual(r.status, 4, `exit ${r.status} 기대 4 / stderr: ${r.stderr.slice(0, 300)}`);
  assert.ok(r.blocker, 'conversion_blocker.json 미생성');
  assert.strictEqual(r.blocker.stage, 'skeleton_cols');
  assert.ok(r.blocker.count >= 1, '차단 건수 0');
  assert.ok(r.blocker.blockers.every(b => b.type === 'skeleton_D'), '위반 열은 소분류(D)여야 함');
  assert.ok(/동작 표현 금지/.test(r.blocker.blockers[0].msg), r.blocker.blockers[0].msg);
});

t('위반 시 tc_skeleton.json을 남기지 않는다 (원자 쓰기 이전 차단)', () => {
  const r = runConvert(DIRTY);
  assert.strictEqual(r.skeleton, null, '차단됐는데 골격이 기록됨 — 하위 단계가 stale 골격을 소비할 수 있음');
});

t('기본기능 행 위반도 잡는다 (트리 leaf 전용 아님)', () => {
  const r = runConvert(DIRTY);
  assert.ok(r.blocker.blockers.length >= 3, `기본기능 1행 + leaf 2행 = 3건 기대, 실제 ${r.blocker.blockers.length}`);
});

t('F(재현스탭) 검사는 골격 검사에 섞이지 않는다', () => {
  // 골격에는 F가 없다 — validatePreWrite를 그대로 부르면 전 행이 "재현스탭 빈 값" CRITICAL
  const rows = [{ idx: 0, b: '우편 시스템', c: '우편 목록 표시', d: CLEAN, e: '정상', g: 'PC/모바일' }];
  const res = validateSkeleton(rows);
  assert.strictEqual(res.ok, true, JSON.stringify(res.violations));
  assert.strictEqual(res.violations.length, 0);
});

t('골격 검사: E/G enum + B/C/D 빈 값', () => {
  const res = validateSkeleton([{ idx: 0, b: '', c: '', d: '', e: '비정상', g: '콘솔' }]);
  assert.strictEqual(res.ok, false);
  const cols = res.violations.map(v => v.col).sort();
  assert.deepStrictEqual(cols, ['B', 'C', 'D', 'E', 'G']);
  assert.ok(res.violations.every(v => v.idx === 0), '위치는 골격 행 인덱스(idx)로 보고');
});

t('드리프트 가드: 같은 분류명을 convert 게이트와 merge preWrite가 함께 잡는다', () => {
  const skel = validateSkeleton([{ idx: 0, b: '우편 시스템', c: '우편 목록 표시', d: DIRTY, e: '정상', g: 'PC' }]);
  const pre = validatePreWrite([['우편 시스템', '우편 목록 표시', DIRTY, '정상', '배너가 노출되는지 확인', 'PC', '']]);
  assert.strictEqual(skel.ok, false, 'convert 게이트가 놓침');
  assert.ok(pre.violations.some(v => v.col === 'D' && /동작 표현 금지/.test(v.msg)), 'merge 이중 방어선이 사라짐');
});

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
