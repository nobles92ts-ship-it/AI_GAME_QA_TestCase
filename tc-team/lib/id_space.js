#!/usr/bin/env node
/**
 * id_space.js — 커버리지 원장(coverage.json)의 tc_id 를 «최종 TC 번호»에 맞춘다.
 *
 * 왜: S4 원장은 tcteam_snapshot.json(S3 번호)으로 만들어진다. S5 apply_fix_plan 이 행을 끼우거나 지우고
 *   regroup 이 A열을 다시 매기면, 원장의 번호는 옛 번호인 채 남아 다른 TC 를 가리킨다.
 *   번호가 «존재»하므로 traceability·quality_report 검사는 한 번도 울리지 않았다.
 *   실측(2026-11-06): 최근 8런 중 6런 — 기능BP 166 중 55 · 캐시샵 1,715 중 1,065 연결이 다른 TC.
 *   07-13 월드맵에서 손으로 고친 뒤 자동 체인에 이 단계가 빠졌고, 09-24 감사 P3-b(LOW)로 남아 있었다.
 *
 * 방법: 산술(+N) 리맵 금지(regroup 재배치 — driver.md 「원장 id 리맵 규칙」). apply_fix_plan 이 행마다
 *   «원 번호» 꼬리표를 달고 regroup 과 같은 함수로 정렬해 옛→새 번호 표(idmap)를 낸다.
 *   표에는 그 결과 행들의 지문(final_digest)이 같이 들어가고, 원장을 고치기 전에 실제 최종 파일과 지문을 대 본다.
 *   다르면 고치지 않고 멈춘다(fail-closed).
 */
'use strict';
const crypto = require('crypto');

const idKey = v => String(v == null ? '' : v).trim().padStart(3, '0');

/** 10열 행 묶음의 지문 — 번호(A)와 B~J 내용을 모두 본다. */
function rowsDigest(rows) {
  const norm = rows.map(r => Array.from({ length: 10 }, (_, i) => (r[i] == null ? '' : String(r[i]))));
  return crypto.createHash('sha1').update(JSON.stringify(norm)).digest('hex');
}

function toArray(cov) {
  if (Array.isArray(cov)) return cov;
  if (cov && Array.isArray(cov.coverage)) return cov.coverage;
  if (cov && typeof cov === 'object') return Object.entries(cov).map(([rule_id, tc_ids]) => ({ rule_id, tc_ids }));
  throw new Error('coverage 형식 불명');
}

/**
 * @param cov   coverage.json (배열 · 맵 · {coverage:[]} 래퍼)
 * @param idmap {map:{old:new}, deleted:[old]}
 * @returns {{coverage:Array, dropped:Array, emptied:string[], unknown:Array}}
 *   unknown = 표에도 삭제 목록에도 없는 번호. 하나라도 있으면 호출자가 멈춰야 한다.
 */
function remapCoverage(cov, idmap) {
  const map = idmap.map || {};
  const deleted = new Set((idmap.deleted || []).map(idKey));
  const dropped = [], emptied = [], unknown = [];
  const coverage = toArray(cov).map(c => {
    const out = [];
    for (const id of c.tc_ids || []) {
      const k = idKey(id);
      if (Object.prototype.hasOwnProperty.call(map, k)) {
        const n = map[k];
        out.push(typeof id === 'number' ? Number(n) : n);
      } else if (deleted.has(k)) dropped.push({ rule_id: c.rule_id, tc_id: k });
      else unknown.push({ rule_id: c.rule_id, tc_id: k });
    }
    const uniq = [...new Set(out)];
    if ((c.tc_ids || []).length && !uniq.length) emptied.push(c.rule_id);
    return Object.assign({}, c, { tc_ids: uniq });
  });
  return { coverage, dropped, emptied, unknown };
}

module.exports = { rowsDigest, remapCoverage, idKey };
