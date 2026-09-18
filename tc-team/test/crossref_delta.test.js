'use strict';
// crossref_delta — S7 델타 대조(뇌 대조 → 답이 있는 질문을 기획확인 패널에서 뺀다) 회귀 테스트
//
// 2026-09-11 전환(오너 지시 "물어볼 거 없으면 질문하지 않아야 해 · [dxr] 이런 건 필요 없어"):
// 소비처가 「꼬리표 주입」에서 「필터」로 바뀌었다 — 답을 찾은 질문(apply·approved:true)은 빼고,
// 남는 질문은 5a 가 쓴 문장 그대로 나간다. 아래 매칭·자리 이력은 필터에도 똑같이 걸린다.
//
// 2026-09-11 이관: 구 자리(run_pipeline_full.sh S7, finalize.sh 앞)는 주입 대상 _labels.json 을
// finalize.sh FINAL-5a 가 만들기 **전**이라 전 런 주입 0건이었다(chain.log "패널 주입 스킵").
// 자리만 5a 뒤로 옮겨도 0건이다 — 주입기는 패널 문장 ↔ 대조 term 완전일치인데, 패널 없이 모은 term 은
// TC 비고열 문장이다(실측: 기능A 질의 14·주입 0 / 아이템_수집 질의 9·주입 0).
// → 델타 전체를 FINAL-5a(도출·검증)와 5b(기재) 사이로 옮겨 패널 문장 자체를 질의 키로 쓴다.
//
// 순서 결함은 코드 모양만 보는 정적 검사로는 안 잡힌다 — finalize.sh --only 5 를 LLM·시트 없이
// 스텁으로 **실제로 돌려** 5b 가 받은 라벨에서 답이 있는 질문이 빠졌는지 본다.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const TCTEAM = path.join(__dirname, '..');
const LIB = path.join(TCTEAM, 'lib');
const SCRIPTS = path.join(TCTEAM, 'scripts');
const UTIL = path.join(TCTEAM, '..', 'scripts', 'util');
const FX = path.join(__dirname, 'fixtures', 'crossref_delta');
const fwd = p => p.replace(/\\/g, '/');
const NODE = fwd(process.execPath);
const COLLECT = path.join(LIB, 'crossref_delta_collect.js');
const MERGE = path.join(LIB, 'crossref_delta_merge.js');
const MARK = '\n→ [DXR';

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  PASS ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' — ' + e.message); } }

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'xdelta-'));
const W = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof o === 'string' ? o : JSON.stringify(o, null, 2), 'utf8'); };
const R = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const node = args => spawnSync(process.execPath, args, { encoding: 'utf8' });
const marks = s => String(s).split(MARK).length - 1;

const PANEL = [
  '[값 미정] 주간 초기화 요일은 언제인가요?\n안내 문구에 요일이 들어가는데 값이 없습니다.',
  '[규칙 없음] 전부 잠긴 경우 어떤 던전이 선택되나요?\n두 문장이 서로 부딪칩니다.',
];
const HEAD = ['TC ID', '대분류', '중분류', '소분류', '검증단계', '재현 스탭', '플랫폼', 'PC 결과', '모바일 결과', '비고'];
const TC_F = '모든 던전이 잠긴 상태에서 진입하면 잠금 던전이 선택되는지 확인';
const TC_ROWS = [['001', '리스트', '진입', '화면', '예외', TC_F, 'PC/모바일', '미진행', '미진행', '기획 확인 필요']];

console.log('crossref_delta 테스트 (S7 델타 대조 · 수집 id · 병합 term 복원 · finalize 배선)');

// ── 수집기 ────────────────────────────────────────────────────────────────
t('수집(final): 패널 문장이 꼬리표를 뗀 채 그대로 term — 주입기가 완전일치로 찾을 키', () => {
  const d = tmp();
  W(path.join(d, '_labels.json'), { 기획확인: [PANEL[0], PANEL[1] + '\n→ [DXR] 근거 없음 (뇌 대조 완료 — 기획 확인 필요)'] });
  W(path.join(d, 'tcteam_tc_final.json'), { headers: HEAD, rows: [] });
  const out = path.join(d, 'in.json');
  const r = node([COLLECT, '--work', d, '--mode', 'final', '--out', out]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(R(out).items.map(x => x.term), PANEL);
});

t('수집: id 는 원장의 같은 접두 최대 번호 다음부터 — 재실행이 이전 델타 결과를 id 로 덮지 않는다', () => {
  const d = tmp();
  W(path.join(d, '_labels.json'), { 기획확인: PANEL });
  W(path.join(d, 'tcteam_tc_final.json'), { headers: HEAD, rows: [] });
  W(path.join(d, 'dxr_crossref.json'), { items: [
    { id: 'D7-3', term: '예전 질의 A', branch: 'keep' },
    { id: 'D7-12', term: '예전 질의 B', branch: 'keep' },
    { id: 'D4-40', term: '리뷰 질의', branch: 'keep' },
    { id: 'C-1', term: '본 대조', branch: 'keep' }] });
  const out = path.join(d, 'in.json');
  const r = node([COLLECT, '--work', d, '--mode', 'final', '--out', out]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(R(out).items.map(x => x.id), ['D7-13', 'D7-14']);
});

t('수집: 접두는 모드별로 따로 센다 (fixplan → D4, 원장의 D7 번호와 무관)', () => {
  const d = tmp();
  W(path.join(d, 'fix_plan.json'), { patches: [{ op: 'edit_cell', tc_id: '001', before: '', after: '기획 확인 필요', reason: '잠금 던전 자동 선택 여부가 원문에 없다' }] });
  W(path.join(d, 'dxr_crossref.json'), { items: [{ id: 'D7-9', term: 'x', branch: 'keep' }, { id: 'D4-2', term: 'y', branch: 'keep' }] });
  const out = path.join(d, 'in.json');
  const r = node([COLLECT, '--work', d, '--mode', 'fixplan', '--out', out]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(R(out).items.map(x => x.id), ['D4-3']);
});

// ── 병합기 ────────────────────────────────────────────────────────────────
t('병합 --input: 에이전트가 term 을 고쳐 써도 id 로 입력 원문을 되돌린다 (판단 필드는 에이전트 것)', () => {
  const d = tmp();
  const xin = path.join(d, 'in.json'), xout = path.join(d, 'out.json'), cross = path.join(d, 'dxr_crossref.json');
  W(xin, { items: [{ id: 'D7-1', tc_id: '', term: PANEL[0], context: '_labels.json 기획확인 패널' }] });
  W(xout, { items: [{ id: 'D7-1', term: '주간 초기화 요일?', branch: 'keep', source: '', note: '', approved: false }] });
  const r = node([MERGE, cross, xout, '--origin', 'S7', '--input', xin]);
  assert.strictEqual(r.status, 0, r.stderr);
  const it = R(cross).items.find(x => x.id === 'D7-1');
  assert.strictEqual(it.term, PANEL[0]);
  assert.strictEqual(it.branch, 'keep');
  assert.strictEqual(it.origin, 'S7');
});

t('병합: --input 이 없으면 종전대로 에이전트 term 유지 (호출측 호환)', () => {
  const d = tmp();
  const xout = path.join(d, 'out.json'), cross = path.join(d, 'dxr_crossref.json');
  W(xout, { items: [{ id: 'D4-1', term: '에이전트 문장', branch: 'keep' }] });
  const r = node([MERGE, cross, xout, '--origin', 'S4']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(R(cross).items[0].term, '에이전트 문장');
});

// ── 필터 — 답이 있는 질문만 빼고 나머지는 한 글자도 안 바꾼다 (순수 함수) ──────────
const loadFilter = () => require(path.join(LIB, 'crossref_labels_annotate.js')).filterLabels;
const Q = [
  '[규칙 없음] A 인가요?\n이유 A', '[규칙 없음] B 인가요?\n이유 B', '[값 미정] C 는 몇인가요?\n이유 C',
  '[규칙 모호] D 인가요?\n이유 D', '[규칙 없음] E 인가요?\n이유 E',
];
const JUDGED = [
  { id: 'D7-1', term: Q[0], branch: 'apply', approved: true, source: 's', note: 'n' },  // 답 있음 → 뺀다
  { id: 'D7-2', term: Q[1], branch: 'apply', approved: false, source: 's' },            // 외부값·사람 승인 대기 → 남긴다
  { id: 'D7-3', term: Q[2], branch: 'locate', source: 's' },                            // 위치만 → 남긴다
  { id: 'D7-4', term: Q[3], branch: 'keep' },                                            // 근거 없음 → 남긴다
];                                                                                       // Q[4] = 원장에 없음 → 남긴다

t('필터: 답을 찾은 질문(apply·approved:true)만 빠지고 나머지는 한 글자도 안 바뀐다', () => {
  const r = loadFilter()(Q, JUDGED);
  assert.deepStrictEqual(r.kept, Q.slice(1));
  assert.deepStrictEqual({ q: r.queried, j: r.judged, rm: r.removed }, { q: 5, j: 4, rm: 1 });
});

t('필터: 옛 꼬리표(→ [DXR …])가 붙은 입력도 떼고 비교·출력한다 — 남는 질문에 꼬리표가 남지 않는다', () => {
  const tailed = Q.map(s => s + '\n→ [DXR] 근거 없음 (뇌 대조 완료 — 기획 확인 필요)');
  const r = loadFilter()(tailed, JUDGED);
  assert.deepStrictEqual(r.kept, Q.slice(1));
  assert.ok(r.kept.every(s => marks(s) === 0));
});

t('필터: 멱등 — 거른 결과를 다시 걸러도 그대로', () => {
  const f = loadFilter();
  const once = f(Q, JUDGED).kept;
  assert.deepStrictEqual(f(once, JUDGED).kept, once);
});

t('필터: 원장이 비었으면 판정 0 — 아무것도 안 뺀다 (조용한 0건 경고는 호출측 몫)', () => {
  const r = loadFilter()(Q, []);
  assert.deepStrictEqual(r.kept, Q);
  assert.deepStrictEqual({ j: r.judged, rm: r.removed }, { j: 0, rm: 0 });
});

t('필터: 뺀 질문은 근거(id·출처·메모)와 함께 dropped 로 남는다 — 조용히 사라지지 않는다', () => {
  const r = loadFilter()(Q, JUDGED);
  assert.deepStrictEqual(r.dropped, [{ question: Q[0], id: 'D7-1', source: 's', note: 'n' }]);
});

t('필터 CLI: 뺀 질문을 _labels_removed.json 에 남긴다 (재실행 때 덮어써 지난 런 기록이 섞이지 않는다)', () => {
  const d = tmp();
  const lp = path.join(d, '_labels.json'), cp = path.join(d, 'dxr_crossref.json');
  W(lp, { 기획확인: Q }); W(cp, { items: JUDGED });
  const r = node([path.join(LIB, 'crossref_labels_annotate.js'), lp, cp]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(R(lp)['기획확인'], Q.slice(1));
  assert.deepStrictEqual(R(path.join(d, '_labels_removed.json')).removed.map(x => x.question), [Q[0]]);
  W(lp, { 기획확인: Q.slice(1) });
  node([path.join(LIB, 'crossref_labels_annotate.js'), lp, cp]);
  assert.deepStrictEqual(R(path.join(d, '_labels_removed.json')).removed, [], '재실행에서 지난 런 제거 기록이 남았다');
});

t('필터 CLI: 뺀 질문이 있으면 완주 보고용 알림(.final5_removed.txt)을 쓰고, 없으면 지운다', () => {
  const d = tmp();
  const lp = path.join(d, '_labels.json'), cp = path.join(d, 'dxr_crossref.json'), np = path.join(d, '.final5_removed.txt');
  W(lp, { 기획확인: Q }); W(cp, { items: JUDGED });
  node([path.join(LIB, 'crossref_labels_annotate.js'), lp, cp]);
  const txt = fs.readFileSync(np, 'utf8');
  assert.ok(/뺀 질문 1건/.test(txt), txt);
  assert.ok(txt.includes(Q[0].split('\n')[0]), '뺀 질문의 1줄차가 보고에 없다\n' + txt);
  assert.ok(txt.includes('s'), '근거(출처)가 보고에 없다');
  W(lp, { 기획확인: Q.slice(1) });
  node([path.join(LIB, 'crossref_labels_annotate.js'), lp, cp]);
  assert.ok(!fs.existsSync(np), '뺀 질문이 없는데 지난 알림이 남았다');
});

t('완주 보고(chain_helpers final-report)에 뺀 질문 알림이 실린다 — 성공 헤더는 그대로(실패 배너 아님)', () => {
  const d = tmp();
  W(path.join(d, 'sheet_info.txt'), 'SHEET_ID=S\nTAB_NAME=T\n');
  W(path.join(d, 'tcteam_tc_final.json'), { headers: HEAD, rows: TC_ROWS });
  W(path.join(d, '.final5_removed.txt'), '🔎 기획확인 패널에서 뺀 질문 1건 — 테스트');
  const r = node([path.join(SCRIPTS, 'chain_helpers.js'), 'final-report', d, d, 'F']);
  assert.strictEqual(r.status, 0, r.stderr);
  const rep = fs.readFileSync(path.join(d, 'final_report.txt'), 'utf8');
  assert.ok(rep.includes('뺀 질문 1건'), rep);
  assert.ok(rep.includes('✅ tc-team 풀체인 완료'), '검토 알림이 실패 헤더로 뒤집혔다\n' + rep);
});

t('필터: 전부 답이 있으면 빈 배열 — 패널 0건 (apply_labeling 은 0~N건 지원)', () => {
  const all = Q.map((s, i) => ({ id: 'D7-' + i, term: s, branch: 'apply', approved: true }));
  assert.deepStrictEqual(loadFilter()(Q, all).kept, []);
});

// ── 배선 — finalize.sh --only 5 를 스텁으로 실제 실행 ──────────────────────────
// 5a·대조 에이전트 = fixtures/stub_agent.js(LLM 없음) · 5b = apply_labeling 스텁(받은 라벨을 파일로 남김)
function sandbox(crossref) {
  const root = tmp(), util = tmp();
  const feat = 'F';
  const spec = path.join(root, 'team', 'specs', feat);
  W(path.join(root, 'team', 'tc_config.json'), { crossref_brain: crossref, crossref_source: 'brain-corpus' });
  W(path.join(spec, 'tcteam_tc_final.json'), { headers: HEAD, rows: TC_ROWS });
  for (const f of ['crossref_delta_collect.js', 'crossref_delta_merge.js', 'crossref_labels_annotate.js']) {
    W(path.join(root, 'tc-team', 'lib', f), fs.readFileSync(path.join(LIB, f), 'utf8'));
  }
  for (const f of ['run-agent.sh', 'stub_agent.js', 'apply_labeling.js']) {
    W(path.join(util, f), fs.readFileSync(path.join(FX, f), 'utf8'));
  }
  W(path.join(util, 'validate_labels.js'), fs.readFileSync(path.join(UTIL, 'validate_labels.js'), 'utf8'));
  return { root, util, spec, feat };
}
function finalize5(sb, extraEnv = {}) {
  const env = { ...process.env, TCTEAM_PROJECT_ROOT: fwd(sb.root), TCTEAM_UTIL: fwd(sb.util), TCTEAM_NODE: NODE,
    STUB_PANEL: JSON.stringify(PANEL), ...extraEnv };
  delete env.TCTEAM_SPECS;
  // 일부러 프로젝트 루트가 아닌 폴더에서 띄운다 — 수동 `finalize.sh --only 5` 는 아무 폴더에서나 돈다
  const r = spawnSync('bash', [fwd(path.join(SCRIPTS, 'finalize.sh')), '--feature', sb.feat, '--sheet-id', 'TEST', '--tab', 'T', '--only', '5'],
    { encoding: 'utf8', env, cwd: tmp() });
  const applied = path.join(sb.spec, '_applied_labels.json');
  return { r, out: (r.stdout || '') + (r.stderr || ''), applied: fs.existsSync(applied) ? R(applied)['기획확인'] : null };
}
const agentCalls = sb => {
  const f = path.join(sb.spec, 'crossref_delta_out_S7.json.calls');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').length : 0;
};

const BASH_OK = spawnSync('bash', ['--version'], { encoding: 'utf8' }).status === 0;
if (!BASH_OK) {
  // 스킵하지 않는다 — 파이프라인 자체가 bash 로 도므로, 여기서 못 돌면 배선을 검증한 적이 없는 것이다.
  fail++; console.log('  FAIL bash 없음 — finalize.sh 배선 테스트를 돌릴 수 없다');
} else {
  const on = sandbox('on');
  const first = finalize5(on);

  t('finalize --only 5 (대조 on · 전량 근거 없음): 5b 가 받은 패널은 5a 가 쓴 그대로 — 꼬리표 없음·항목 유지', () => {
    assert.strictEqual(first.r.status, 0, first.out.slice(-1500));
    assert.ok(first.applied, '5b 스텁이 라벨을 받지 못함\n' + first.out.slice(-1500));
    assert.deepStrictEqual(first.applied, PANEL, '물어볼 게 남은 질문은 한 글자도 바뀌면 안 된다');
  });

  t('finalize --only 5: 원장에 남는 term 은 에이전트가 줄여 쓴 것이 아니라 수집 원문', () => {
    const items = R(path.join(on.spec, 'dxr_crossref.json')).items;
    const terms = items.map(x => x.term).sort();
    assert.deepStrictEqual(terms, [...PANEL, TC_F].sort());
    assert.ok(items.every(x => /^D7-\d+$/.test(x.id)), items.map(x => x.id).join(','));
  });

  t('대조 에이전트는 호출 폴더와 무관하게 프로젝트 루트에서 돈다 (다른 폴더면 KB 가 비어 전량 「근거 없음」)', () => {
    const f = path.join(on.spec, 'crossref_delta_out_S7.json.cwd');
    assert.ok(fs.existsSync(f), '에이전트 작업 폴더 기록 없음');
    assert.strictEqual(path.resolve(fs.readFileSync(f, 'utf8')).toLowerCase(), path.resolve(on.root).toLowerCase());
  });

  t('finalize --only 5: 로그에 제거·남음 건수가 남는다 (초록불이 아닌 숫자로)', () => {
    assert.ok(/\[S7-델타대조\] 기획확인 패널 — 답 있는 질문 0건 제거 · 남은 질문 2건 \(질의 2 · 판정 2\)/.test(first.out), first.out.slice(-1500));
  });

  const ap = sandbox('on');
  const firstAp = finalize5(ap, { STUB_MODE: 'apply1' });
  t('대조가 답을 찾은 질문은 5b 전에 패널에서 빠진다 — 남는 질문은 그대로', () => {
    assert.strictEqual(firstAp.r.status, 0, firstAp.out.slice(-1500));
    assert.deepStrictEqual(firstAp.applied, [PANEL[1]], firstAp.out.slice(-1500));
    assert.ok(/답 있는 질문 1건 제거 · 남은 질문 1건/.test(firstAp.out), firstAp.out.slice(-1500));
  });

  const secondAp = finalize5(ap, { STUB_MODE: 'apply1' });
  t('재실행(--only 5): 5a 가 패널을 새로 써도 원장 기준으로 다시 걸러진다 (대조 에이전트 재호출 없음)', () => {
    assert.strictEqual(secondAp.r.status, 0, secondAp.out.slice(-1500));
    assert.deepStrictEqual(secondAp.applied, [PANEL[1]], '재실행에서 답 있는 질문이 되살아났다');
    assert.strictEqual(agentCalls(ap), 1, '이미 물어본 항목을 다시 물었다');
    assert.strictEqual(R(path.join(ap.spec, 'dxr_crossref.json')).items.length, PANEL.length + 1, '원장 항목 수가 바뀌었다');
  });

  t('finalize --only 5 (대조 off): 조용히 스킵 — 패널은 그대로 기재되고 exit 0 · 지난 런의 뺀 질문 알림은 지운다', () => {
    const off = sandbox('off');
    W(path.join(off.spec, '.final5_removed.txt'), '🔎 지난 런 알림');   // 이번 런엔 거르기가 없다 — 남으면 완주 보고에 거짓으로 실린다
    const res = finalize5(off);
    assert.ok(!fs.existsSync(path.join(off.spec, '.final5_removed.txt')), '대조 off 런에 지난 런의 뺀 질문 알림이 남았다');
    assert.strictEqual(res.r.status, 0, res.out.slice(-1500));
    assert.ok(res.applied, '5b 가 돌지 않았다');
    res.applied.forEach(s => assert.strictEqual(marks(s), 0));
    assert.ok(!fs.existsSync(path.join(off.spec, 'crossref_delta_in_S7.json')), 'off 인데 수집이 돌았다');
  });

  t('대조 결과가 패널과 하나도 안 맞으면 "판정 0건" 경고가 남는다 (조용한 초록불 금지) — 5b 는 계속', () => {
    const bad = sandbox('on');
    const res = finalize5(bad, { STUB_MODE: 'badid' });
    assert.strictEqual(res.r.status, 0, res.out.slice(-1500));
    assert.ok(res.applied, '5b 가 돌지 않았다');
    assert.ok(/\[S7-델타대조\]\[경고\] 패널 질의 2건 중 판정 0건/.test(res.out), res.out.slice(-1500));
    assert.deepStrictEqual(res.applied, PANEL, '판정을 못 찾았으면 아무것도 빼지 않는다');
  });
}

// ── 호출 지점 — 두 호출이 한 정의를 쓰고, S7 호출이 finalize 앞에 남아 있지 않다 ─────
t('run_pipeline_full.sh: S4 호출은 남고 S7 호출(finalize 앞)은 없다 · 정의는 crossref_delta.sh 한 곳', () => {
  const full = fs.readFileSync(path.join(SCRIPTS, 'run_pipeline_full.sh'), 'utf8');
  assert.ok(/^\s*crossref_delta fixplan S4\s*$/m.test(full), 'S4 호출이 사라졌다');
  assert.ok(!/^\s*crossref_delta final\b/m.test(full), 'S7 호출이 finalize 앞에 남아 있다(주입 대상이 아직 없는 자리)');
  assert.ok(!/^\s*crossref_delta\(\)\s*\{/m.test(full), 'full.sh 에 함수 사본이 남아 있다');
  assert.ok(/^\s*source "\$TCTEAM\/scripts\/crossref_delta\.sh"/m.test(full), 'full.sh 가 공용 정의를 source 하지 않는다');
  const lib = fs.readFileSync(path.join(SCRIPTS, 'crossref_delta.sh'), 'utf8');
  assert.ok(/^crossref_delta\(\)\s*\{/m.test(lib));
});

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
