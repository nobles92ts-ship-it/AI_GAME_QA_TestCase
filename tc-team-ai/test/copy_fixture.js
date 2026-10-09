'use strict';
// 견본 폴더 복사 — fs.cpSync 를 쓰지 않는다: Windows Node 24(v24.14.0 실측 2026-10-08)에서 대상 경로에 한글이 있으면
// 메시지 없이 프로세스째 죽는다(rc 127, 영문 경로는 정상). 임시 폴더가 한글 사용자명 아래일 수 있어 테스트는 전부 이 함수를 쓴다.
// 견본은 평평한 폴더다 — 하위 폴더가 생기면 copyFileSync 가 크게 실패한다(조용히 빠지지 않는다).
const fs = require('fs');
const path = require('path');

module.exports = function copyFlat(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(dst, f));
  return dst;
};
