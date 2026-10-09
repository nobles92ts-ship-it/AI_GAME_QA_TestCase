#!/usr/bin/env node
'use strict';
/**
 * run_ai.js — tc-team-ai 러너: 기획서 → TC(tc-team S1~S5, 시트 없이) → AI 다시 쓰기 → AI 실행용 md 묶음.
 *
 *   1) 체인      bash tc-team/scripts/run_pipeline_full.sh --no-sheet — S5 확정본(tcteam_tc_final.json)에서 끝난다
 *   2) 다시 쓰기  확정본 TC → 전제·조작·기대·관측 (LLM 팬아웃 + 원문 보존 게이트)        → ai_rewrite.json
 *   3) 내보내기   확신도(시트 없이, confidence_core) + md 묶음                          → ai_confidence.json · ai_bundle/
 *   4) 상태      team/state.json 에 done — 모니터와 다음 배치가 이 기능을 «진행 중»으로 보지 않게(사람용 S7 과 같은 줄)
 *
 * 왜 .sh 가 아니라 node 인가: bash 는 스크립트를 읽어 가며 돈다 — 런 도중에 .sh 를 고치면 그 런이 죽는다.
 *   tc-team 체인 .sh 에는 편집 가드 훅이 걸려 있지만 이 폴더는 가드 밖이다. node 는 시작할 때 파일을 통째로 읽는다.
 *
 * 사용: node tc-team-ai/scripts/run_ai.js --feature _ai_<기능> [--conf-url <URL>] [--start-from s1..s5|rewrite|export]
 *   전제(S0, 호출자 소관 — skills/tc-team-ai/SKILL.md): team/specs/_ai_<기능>/confluence_raw.md
 *   기능명은 _ai_ 로 시작해야 한다 — 사람용 런과 specs 폴더·state.json 항목을 나눠 쓰고, specs 의 `_` 폴더는
 *   사람용 TC 를 지켜보는 도구가 건너뛰는 자리다(사내 운영 도구 — 공개 배포본 미포함).
 *   안 그러면 AI 런 폴더가 「그 기획서의 TC」로 잡힐 수 있다.
 * 노브(env): TCTEAM_AI_MODEL(다시 쓰기 모델, 기본 sonnet) · TCTEAM_AI_PAR(동시 청크, 기본 4·상한 8)
 *            TCTEAM_ENGINE=codex · TCTEAM_ISOLATE(기본 1) — 체인과 같은 뜻
 * 종료코드: 0 완료 · 1 실패·사용법 · 10 인증 · 12 다시 쓰기 결과를 하나도 못 읽음(파일 없음 = CLI·모델 이름·네트워크 / JSON 아님 = 형식)
 *          · 14 무결성(체인은 끝났는데 확정본 없음) · 15 쿼터 · 그 밖 = 체인 종료코드 그대로
 * 끝에 한 줄: AI_DONE {요약 JSON}
 */
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { PROJECT_ROOT, resolveRulesDir } = require('../lib/paths');
const { FINAL, readFinal } = require('../lib/tc_rows');
const { rewriteStage } = require('../lib/rewrite_stage');
const { writeLocal } = require('../lib/confidence_local');
const { exportBundle } = require('../lib/md_export');

const STAGES = ['s1', 's2', 's3', 's4', 's5', 'rewrite', 'export'];
const FEATURE_PREFIX = /^_ai_./;
// 체인이 기능명을 셸 문자열(bash -c "…'$SPEC'…")에 그대로 넣는다 — 따옴표·공백·괄호가 들어가면 S1 이 깨진다
const FEATURE_RE = /^_ai_[\p{L}\p{N}_-]+$/u;
const REWRITE_RULES = 'ai-재작성.md';
const PAR_DEFAULT = 4;
const PAR_MAX = 8;
const USAGE = '사용법: node run_ai.js --feature _ai_<기능> [--conf-url <URL>] [--start-from s1..s5|rewrite|export]';

const fwd = (p) => p.replace(/\\/g, '/');   // bash·node 양쪽이 읽는 형(C:/...)
const secs = (t0) => Math.round((Date.now() - t0) / 1000);
const pad2 = (n) => String(n).padStart(2, '0');
const stamp = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;

function parseArgs(argv) {
  const o = { feature: '', confUrl: '', startFrom: 's1' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--feature') o.feature = argv[++i] || '';
    else if (a === '--conf-url') o.confUrl = argv[++i] || '';
    else if (a === '--start-from') o.startFrom = argv[++i] || '';
    else throw new Error(`알 수 없는 인자: ${a}`);
  }
  if (!o.feature) throw new Error('--feature 가 없다');
  if (/[\\/]|\.\./.test(o.feature)) throw new Error(`기능명에 경로 문자(/ \\ ..)를 쓸 수 없다: ${o.feature}`);
  if (!FEATURE_PREFIX.test(o.feature)) throw new Error(`기능명은 _ai_ 로 시작해야 한다(사람용 TC 감시·알림이 건너뛰는 자리): ${o.feature}`);
  if (!FEATURE_RE.test(o.feature)) throw new Error(`기능명에는 글자·숫자·_·- 만 쓴다(체인이 셸 명령 문자열에 그대로 넣는다 — 공백·따옴표·괄호·점은 _ 로): ${o.feature}`);
  if (!STAGES.includes(o.startFrom)) throw new Error(`잘못된 --start-from: ${o.startFrom} (${STAGES.join('|')})`);
  return o;
}

// 체인 knob_int 와 같은 정책 — 잘못된 값으로 런을 죽이지 않되 조용히 통과시키지도 않는다
function knobInt(name, raw, def, max, log) {
  if (raw == null || raw === '') return def;
  if (!/^[1-9][0-9]*$/.test(raw)) { log(`[AI][경고] ${name}='${raw}' 가 1 이상의 정수가 아니다 — 기본값 ${def} 로 되돌린다`); return def; }
  if (Number(raw) > max) { log(`[AI][경고] ${name}=${raw} 가 상한 ${max} 초과 — ${max} 로 클램프`); return max; }
  return Number(raw);
}

function runChain(o, log) {
  const sh = fwd(path.join(PROJECT_ROOT, 'tc-team', 'scripts', 'run_pipeline_full.sh'));
  const args = [sh, '--feature', o.feature, '--no-sheet', '--start-from', o.startFrom, ...(o.confUrl ? ['--conf-url', o.confUrl] : [])];
  log(`[AI] 체인 시작 — ${o.startFrom.toUpperCase()}~S5, 시트 없음`);
  return new Promise((resolve) => {
    // 루트를 넘겨 체인과 이 러너가 같은 specs 폴더를 보게 한다
    const c = spawn('bash', args, { stdio: 'inherit', env: { ...process.env, TCTEAM_PROJECT_ROOT: fwd(PROJECT_ROOT) } });
    c.on('error', (e) => { log(`[AI][실패] 체인을 띄우지 못했다 — ${e.message}`); resolve(1); });
    c.on('close', (code) => resolve(code == null ? 1 : code));
  });
}

// LLM 한 번 = 체인 run_llm 과 같은 길: pipeline_retry.sh(인증 10·한도 11 판별) → run-agent.sh(claude -p, 격리·모델 고정)
function makeInvoke({ chainLog, model }) {
  const util = path.join(PROJECT_ROOT, 'scripts', 'util');
  const retry = fwd(path.join(util, 'pipeline_retry.sh'));
  const agent = fwd(path.join(util, process.env.TCTEAM_ENGINE === 'codex' ? 'run-agent-codex.sh' : 'run-agent.sh'));
  // 도구는 읽기·쓰기만 — 입력 파일을 읽고 출력 파일을 쓰는 일이다(격리 켜짐일 때 run-agent 가 이 목록으로 띄운다)
  const env = { ...process.env, TCTEAM_ISOLATE: process.env.TCTEAM_ISOLATE || '1', RUNAGENT_TOOLS: process.env.RUNAGENT_TOOLS || 'Read,Write' };
  return (prompt, meta) => new Promise((resolve) => {
    const fd = fs.openSync(chainLog, 'a');
    let settled = false;
    const done = (rc) => { if (settled) return; settled = true; fs.closeSync(fd); resolve(rc); };
    const c = spawn('bash', [retry, fwd(meta.errlog), '--', 'bash', agent, '-p', '--permission-mode', 'bypassPermissions', '--model', model, prompt],
      { stdio: ['ignore', fd, fd], env });
    c.on('error', () => done(1));
    c.on('close', (code) => done(code == null ? 1 : code));
  });
}

async function rewrite(spec, chainLog, log) {
  const rulesFile = path.join(resolveRulesDir(), REWRITE_RULES);
  if (!fs.existsSync(rulesFile)) { log(`[AI][실패] 다시 쓰기 규칙 없음: ${rulesFile} — skills/tc-team-ai 설치를 확인`); return 1; }
  const rulesText = fs.readFileSync(rulesFile, 'utf8').replace(/<!--[\s\S]*?-->\s*/g, '');
  const model = process.env.TCTEAM_AI_MODEL || 'sonnet';
  const par = knobInt('TCTEAM_AI_PAR', process.env.TCTEAM_AI_PAR, PAR_DEFAULT, PAR_MAX, log);
  const t0 = Date.now();
  const r = await rewriteStage({ spec, records: readFinal(spec).records, rulesText, invoke: makeInvoke({ chainLog, model }), par, log });
  if (!r.ok) {
    if (r.abort === 10) { log('[STOP:인증] AI 다시 쓰기 — 재인증 후 --start-from rewrite 로 재실행'); return 10; }
    log('[STOP:쿼터] AI 다시 쓰기 — 한도. 재실행 대기 (--start-from rewrite)');
    return 15;
  }
  const s = r.data.stats;
  log(`[AI] 다시 쓰기 끝 — 구조화 ${s.rewritten} · 원문대로 ${s.fallback} / 대상 ${s.targets} (추후 구현 ${s.skipped}행 제외, ${secs(t0)}초)`);
  // 읽을 수 있는 결과가 한 번도 안 나왔다 = 게이트가 거른 게 아니라 실행기가 못 돌았거나(파일 없음) 형식이 틀렸다(JSON 아님).
  //   그대로 내보내면 «전부 원문대로» 묶음이 exit 0 으로 나가 고장이 안 보인다. 결과는 읽혔는데 게이트가 거른 폴백은 정상 경로라 그대로 간다.
  if (s.targets > 0 && s.outputs === 0) {
    log(`[STOP:다시 쓰기] 대상 ${s.targets}행인데 읽을 수 있는 결과(JSON)가 한 번도 안 나왔다 — 결과 파일(ai_work/c*_out.json)이 없으면 claude CLI·모델 이름(TCTEAM_AI_MODEL)·네트워크를, 있으면 그 형식을 확인하고 --start-from rewrite 로 재실행 (실행기 오류: ai_work/.c*_stderr.log)`);
    return 12;
  }
  return 0;
}

function exportStage(spec, log) {
  // 확신도는 내보낼 때마다 다시 잰다(LLM 없음) — 지난 런의 값이 바뀐 확정본에 붙지 않게 먼저 지운다
  fs.rmSync(path.join(spec, 'ai_confidence.json'), { force: true });
  try {
    const c = writeLocal(spec);
    if (c.ok) {
      const d = c.data.summary.dist;
      log(`[AI] 확신도 — A ${d.A || 0} · B ${d.B || 0} · C ${d.C || 0} · D ${d.D || 0} · N ${d.N || 0} (총 ${c.data.summary.total})`);
    } else log(`[AI][경고] 확신도 건너뜀 — ${c.code}: ${c.msg} (묶음에 확신도 줄이 안 붙는다)`);
  } catch (e) { log(`[AI][경고] 확신도 건너뜀 — ${e.message} (묶음에 확신도 줄이 안 붙는다)`); }
  const sum = exportBundle({ spec });
  log(`[AI] 내보내기 — TC ${sum.tc} · 그룹 ${sum.groups} · 판정 보류 ${sum.flagged} · 구조화 ${sum.rewritten} · 원문대로 ${sum.fallback}`
    + `${sum.stale ? ` (그중 다시 쓴 뒤 원문이 바뀐 ${sum.stale}행)` : ''} · 근거 규칙 ${sum.rule_links_unmapped == null ? '원장 없음' : `못 이은 연결 ${sum.rule_links_unmapped}`} → ${fwd(sum.out)}`);
  return sum;
}

function markDone(feature, log) {
  const r = spawnSync(process.execPath, [path.join(PROJECT_ROOT, 'tc-team', 'lib', 'state_projection.js'),
    path.join(PROJECT_ROOT, 'team', 'state.json'), feature, 'done'], { encoding: 'utf8' });
  if (r.status !== 0) log(`[AI][경고] state done 기록 실패 — ${((r.stderr || r.error || '') + '').trim().split('\n').pop()} (묶음에는 영향 없음)`);
}

async function main(argv) {
  let o;
  try { o = parseArgs(argv); } catch (e) { console.error(`[AI] ${e.message}\n${USAGE}`); return 1; }
  const spec = path.join(PROJECT_ROOT, 'team', 'specs', o.feature);
  const chainLog = path.join(spec, 'chain.log');
  fs.mkdirSync(spec, { recursive: true });
  const log = (msg) => { const line = `[${stamp()}] ${msg}`; console.log(line); fs.appendFileSync(chainLog, line + '\n', 'utf8'); };
  const T0 = Date.now();
  const st = STAGES.indexOf(o.startFrom);

  const chainRan = st <= STAGES.indexOf('s5');
  if (chainRan) {
    const rc = await runChain(o, log);
    if (rc !== 0) { log(`[AI] 체인 종료코드 ${rc} — AI 단계로 넘어가지 않는다`); return rc; }
  }
  if (!fs.existsSync(path.join(spec, 'tc_final.ok')) || !fs.existsSync(path.join(spec, FINAL))) {
    log(chainRan ? '[STOP:무결성] 체인은 끝났는데 S5 확정본(tc_final.ok · tcteam_tc_final.json)이 없다 — 사람 확인 필요'
      : `[AI][실패] S5 확정본이 없다 — 체인부터 돌릴 것(--start-from s1..s5): ${fwd(spec)}`);
    return chainRan ? 14 : 1;
  }
  if (st <= STAGES.indexOf('rewrite')) {
    const rc = await rewrite(spec, chainLog, log);
    if (rc !== 0) return rc;
  }
  let sum;
  try { sum = exportStage(spec, log); } catch (e) { log(`[AI][실패] 내보내기 — ${e.message}`); return 1; }
  markDone(o.feature, log);

  const summary = { feature: o.feature, bundle: fwd(sum.out), tc: sum.tc, groups: sum.groups, flagged: sum.flagged, rewritten: sum.rewritten,
    fallback: sum.fallback, stale: sum.stale, questions: sum.questions, confidence: sum.confidence, rule_links_unmapped: sum.rule_links_unmapped, secs: secs(T0) };
  log(`[AI] 완료 — ${fwd(sum.out)} (${summary.secs}초)`);
  console.log('AI_DONE ' + JSON.stringify(summary));
  return 0;
}

main(process.argv.slice(2)).then((rc) => process.exit(rc), (e) => { console.error(`[AI][실패] ${e.stack || e.message}`); process.exit(1); });
