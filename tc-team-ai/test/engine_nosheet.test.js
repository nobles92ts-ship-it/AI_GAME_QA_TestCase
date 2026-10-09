'use strict';
// engine_nosheet — tc-team 체인의 시트 없는 런(--no-sheet) 계약. tc-team-ai 가 기대는 동작을 실물 run_pipeline_full.sh 로 잠근다.
//   ① --no-sheet 는 S5 확정본 뒤에서 끝난다 — S6 시트 기록·S7 완료처리·증거 봉투를 부르지 않는다
//      대조군: 같은 자리에서 --sheet-id 는 S6 를 부른다(조용한 게이트와 통과하는 게이트를 가른다)
//   ② S1 에는 --sheet-id 대신 --local 로 넘긴다 · --sheet-id 런은 예전 그대로 넘긴다
//   ③ 시트 ID 도 --no-sheet 도 없으면 사용법 오류
// 가짜 프로젝트 루트(TCTEAM_PROJECT_ROOT)에 S1(s1only)·S6(sheet_write)만 스텁으로 둔다 — 부르면 표식을 남긴다.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const FULL = path.resolve(__dirname, '..', '..', 'tc-team', 'scripts', 'run_pipeline_full.sh');
const fwd = (p) => p.replace(/\\/g, '/');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  PASS ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' — ' + e.message); } }
const W = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s, 'utf8'); };
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xns-'));
  // S1 스텁: 받은 인자를 적고 rc 7 로 끝난다 — 체인이 그 rc 를 그대로 돌려주는지도 본다
  W(path.join(root, 'tc-team', 'scripts', 'run_pipeline_s1only.sh'), '#!/usr/bin/env bash\nprintf "%s\\n" "$@" > "$STUB_DIR/s1_args.txt"\nexit 7\n');
  // S6 스텁: 부르면 표식을 남기고 실패한다(그 뒤로는 가지 않는다)
  W(path.join(root, 'tc-team', 'lib', 'sheet_write.js'), "require('fs').writeFileSync(process.env.STUB_DIR + '/sheet_write.called', '1');\nprocess.exit(1);\n");
  const sp = path.join(root, 'team', 'specs', 'F');
  W(path.join(sp, 'analysis.md'), '# 스텁\n');
  W(path.join(sp, 'tc_design.md'), '# 스텁\n');
  fs.mkdirSync(path.join(root, 'stub'), { recursive: true });
  fs.mkdirSync(path.join(root, 'golden_none'), { recursive: true });
  return root;
}

function run(root, args) {
  const env = { ...process.env, TCTEAM_PROJECT_ROOT: fwd(root), TCTEAM_NODE: fwd(process.execPath),
    TCTEAM_GOLDEN_DIR: fwd(path.join(root, 'golden_none')), STUB_DIR: fwd(path.join(root, 'stub')) };
  const r = spawnSync('bash', [fwd(FULL), ...args], { encoding: 'utf8', env, cwd: root });
  const log = read(path.join(root, 'team', 'specs', 'F', 'chain.log'));
  return { status: r.status, log, stderr: r.stderr || '', tail: ((r.stdout || '') + (r.stderr || '') + log).slice(-1200) };
}
const called = (root) => fs.existsSync(path.join(root, 'stub', 'sheet_write.called'));
const s1Args = (root) => read(path.join(root, 'stub', 's1_args.txt')).trim().split('\n');
const lockLeft = (root) => fs.existsSync(path.join(root, 'team', '.pipeline.lock'));

console.log('engine_nosheet 테스트 (tc-team 체인 --no-sheet 계약)');
const BASH_OK = spawnSync('bash', ['--version'], { encoding: 'utf8' }).status === 0;
if (!BASH_OK) {
  fail++; console.log('  FAIL bash 없음 — run_pipeline_full.sh 배선 테스트를 돌릴 수 없다');
} else {
  {
    const root = makeRoot();
    const r = run(root, ['--feature', 'F', '--no-sheet', '--start-from', 's6']);
    t('--no-sheet: S5 뒤에서 종료(exit 0) + 종료 로그', () => {
      assert.strictEqual(r.status, 0, r.tail);
      assert.match(r.log, /\[CHAIN-FULL\] 시트 없는 런 — S5 확정본에서 종료/);
    });
    t('--no-sheet: S6 시트 기록·S7 완료처리·증거 봉투를 부르지 않는다', () => {
      assert.ok(!called(root), 'sheet_write 를 불렀다');
      assert.ok(!/\[S6\]|\[S7\]|\[EVIDENCE\]/.test(r.log), r.tail);
    });
    t('--no-sheet: 실행락을 풀고 끝난다', () => assert.ok(!lockLeft(root), 'team/.pipeline.lock 이 남았다'));
  }
  {
    const root = makeRoot();
    const r = run(root, ['--feature', 'F', '--sheet-id', 'DUMMY', '--start-from', 's6']);
    t('대조군 --sheet-id: 같은 자리에서 S6 시트 기록을 부른다', () => {
      assert.ok(called(root), 'sheet_write 를 안 불렀다 — 위 테스트가 «안 불러서» 통과했는지 갈리지 않는다');
      assert.match(r.log, /\[S6\] 시트 기록/);
      assert.ok(!/시트 없는 런/.test(r.log), '시트 런에서 시트 없는 종료가 돌았다');
      assert.strictEqual(r.status, 1, r.tail);   // 스텁 sheet_write 가 실패 → fail(1)
    });
  }
  {
    const root = makeRoot();
    const r = run(root, ['--feature', 'F', '--no-sheet', '--conf-url', 'https://example.atlassian.net/wiki/x']);
    t('--no-sheet: S1 에는 --local 로 넘기고 S1 rc 를 그대로 돌려준다', () => {
      assert.deepStrictEqual(s1Args(root), ['--feature', 'F', '--local', '--conf-url', 'https://example.atlassian.net/wiki/x']);
      assert.strictEqual(r.status, 7, r.tail);
    });
  }
  {
    const root = makeRoot();
    run(root, ['--feature', 'F', '--sheet-id', 'ABC']);
    t('--sheet-id 런: S1 인자는 예전 그대로', () => assert.deepStrictEqual(s1Args(root), ['--feature', 'F', '--sheet-id', 'ABC']));
  }
  {
    const root = makeRoot();
    const r = run(root, ['--feature', 'F']);
    t('시트 ID 도 --no-sheet 도 없으면 사용법 오류(exit 1)', () => {
      assert.strictEqual(r.status, 1, r.tail);
      assert.match(r.stderr, /--no-sheet/);
      assert.ok(!fs.existsSync(path.join(root, 'stub', 's1_args.txt')), 'S1 을 띄웠다');
    });
  }
}

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
