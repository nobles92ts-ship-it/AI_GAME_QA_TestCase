'use strict';
// tc_rows.js — S5 확정본(tcteam_tc_final.json)을 열 이름으로 읽는다. 열 위치를 가정하지 않는다.
// (사람용 시트 열 세대가 바뀌어도 — 링크 열 신설 등 — 이름으로 찾으므로 한 칸 밀린 값이 흐르지 않는다)
const fs = require('fs');
const path = require('path');

const FINAL = 'tcteam_tc_final.json';
const COLS = { id: 'TC ID', b: '대분류', m: '중분류', s: '소분류', stage: '검증단계', f: '재현 스탭', pc: 'PC 결과', mo: '모바일 결과', note: '비고' };
const NOTE_BLOCKED = '기획 확인 필요';
const NOTE_LATER = '추후 구현';

function readFinal(spec) {
  const file = path.join(spec, FINAL);
  if (!fs.existsSync(file)) throw new Error(`${FINAL} 없음 — S5 확정본이 아직 없다 (${spec})`);
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const idx = Object.fromEntries(Object.entries(COLS).map(([k, name]) => [k, (j.headers || []).indexOf(name)]));
  const missing = Object.keys(COLS).filter((k) => idx[k] < 0).map((k) => COLS[k]);
  if (missing.length) throw new Error(`${FINAL} 헤더에 ${missing.join(', ')} 없음`);
  const records = j.rows.map((r) => Object.fromEntries(Object.keys(COLS).map((k) => [k, r[idx[k]] == null ? '' : String(r[idx[k]])])));
  return { headers: j.headers, records };
}

// 비고(J열) 화이트리스트: '' · 기획 확인 필요 · 추후 구현 · 구현 우선순위 낮음 · 버그 번호 — 앞의 둘만 판정을 바꾼다
function noteKind(rec) {
  const n = rec.note.trim();
  if (n === NOTE_BLOCKED) return 'blocked';
  if (n === NOTE_LATER) return 'later';
  return n ? 'other' : '';
}

const platformsOf = (rec) => [rec.pc !== 'N/A' ? 'PC' : null, rec.mo !== 'N/A' ? '모바일' : null].filter(Boolean);

module.exports = { FINAL, readFinal, noteKind, platformsOf };
