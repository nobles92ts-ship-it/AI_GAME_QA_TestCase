#!/usr/bin/env node
/**
 * waiting_tcs.js — 「기획 답을 기다리는 TC」 목록과, 그 TC 마다 질문이 남았는지 검사 (결정론)
 *
 * 배경(2026-11-06 표본 점검 — 5a 가 「테스트 무관」으로 뺀 382건 중 40건):
 *   질문은 빠졌는데 TC 는 「확인된 복구 정책과 일치하는지 확인」 + 비고 「기획 확인 필요」로 남았다.
 *   질문이 기획자에게 안 갔으니 답이 안 오고, QA 는 그 TC 를 판정할 수 없다.
 *   실례: 기능BN Q02(인계 중 강제 종료 복구) — 설계가 「필수」로 올렸는데 5a 가 「일반 견고성」으로 뺐고
 *   TC 11건이 답을 기다린 채 남았다. 과거 산출물 전수: 비고 「기획 확인 필요」 3,178행 중 682행(41탭)이 이 모양.
 *
 * 서브커맨드:
 *   extract <SPEC>  tcteam_tc_final.json → $SPEC/_waiting_tcs.json  {"기다리는TC":[{"tc_id","문장"}]}
 *                   stdout 한 줄 `waiting N`. 5a 앞에서 돈다.
 *   check <SPEC>    _waiting_tcs.json × _waiting_cover.json(5a 가 씀) × _labels.json 을 맞춘다.
 *                   덮개가 없거나(「패널 N」의 N 이 패널 범위 밖 포함) 형식이 틀린 TC 를 stdout 에 `uncovered <id>` 로 찍는다.
 *                   exit 0=전부 덮임(또는 기다리는 TC 0) / 3=덮이지 않은 TC 있음 / 1=오류
 *
 * 덮개 형식(_waiting_cover.json): {"덮음": {"<TC ID>": "패널 3" | "답 있음: <파일·절과 그 문구>"}}
 *   「답 있음」은 TC 가 기다릴 필요가 없었다는 뜻이다(TC 쪽이 잘못 표시됨) — 사람이 보도록 그대로 보고에 남긴다.
 */
'use strict';
const fs = require('fs');
const path = require('path');

// 「답이 와야 정해지는 기대값」 모양. 2026-11-06 과거 산출물 682행에서 실측한 표현만 넣었다.
const PLACEHOLDER = /(확인된|확정된|확정한|확정)\s?(복구\s?)?(정책|규칙|값|기준|동작|시계|방식|결과)|기획\s?확정값|기획 답|기획 확인 (결과|대상)|정책과 일치|정해진 (정책|기준)/;
const FLAG = '기획 확인 필요';

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw new Error(`${path.basename(p)} 읽기 실패: ${e.message}`);
  }
}

function extract(spec) {
  const t = readJSON(path.join(spec, 'tcteam_tc_final.json')) || readJSON(path.join(spec, 'tcteam_snapshot.json'));
  if (!t) return [];
  const headers = t.headers || [];
  // 열 위치는 헤더 이름으로 찾는다(열 문자 하드코딩 금지 — 링크열 신설로 이동 전력).
  const idI = Math.max(0, headers.indexOf('TC ID'));
  const stepI = headers.indexOf('재현 스탭') >= 0 ? headers.indexOf('재현 스탭') : 5;
  const noteI = headers.indexOf('비고');
  const out = [];
  for (const r of (Array.isArray(t) ? t : t.rows || [])) {
    if (!Array.isArray(r)) continue;
    const note = noteI >= 0 ? String(r[noteI] || '') : r.map(String).join(' ');
    const step = String(r[stepI] || '');
    if (note.includes(FLAG) && PLACEHOLDER.test(step)) out.push({ tc_id: String(r[idI]), 문장: step });
  }
  return out;
}

function check(spec) {
  const w = readJSON(path.join(spec, '_waiting_tcs.json'));
  const list = (w && w['기다리는TC']) || [];
  if (!list.length) return [];
  const cover = (readJSON(path.join(spec, '_waiting_cover.json')) || {})['덮음'] || {};
  const panel = ((readJSON(path.join(spec, '_labels.json')) || {})['기획확인'] || []).length;
  const bad = [];
  for (const { tc_id } of list) {
    const v = String(cover[tc_id] || '').trim();
    const m = v.match(/^패널\s*(\d+)/);
    const ok = m ? (Number(m[1]) >= 1 && Number(m[1]) <= panel) : /^답 있음\s*:\s*\S/.test(v);
    if (!ok) bad.push(tc_id);
  }
  return bad;
}

if (require.main === module) {
  const [cmd, spec] = process.argv.slice(2);
  try {
    if (!spec) throw new Error('사용법: waiting_tcs.js extract|check <SPEC>');
    if (cmd === 'extract') {
      const list = extract(spec);
      fs.writeFileSync(path.join(spec, '_waiting_tcs.json'), JSON.stringify({ '기다리는TC': list }, null, 1));
      process.stdout.write(`waiting ${list.length}\n`);
    } else if (cmd === 'check') {
      const bad = check(spec);
      for (const id of bad) process.stdout.write(`uncovered ${id}\n`);
      process.exit(bad.length ? 3 : 0);
    } else throw new Error('알 수 없는 서브커맨드: ' + cmd);
  } catch (e) {
    process.stderr.write(`waiting_tcs: ${e.message}\n`);
    process.exit(1);
  }
}

module.exports = { extract, check, PLACEHOLDER };
