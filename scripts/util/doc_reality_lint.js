#!/usr/bin/env node
/**
 * doc_reality_lint.js — tc-team-v2 문서 죽은 참조 린터 (doc-vs-reality)
 *
 * 목적: 스킬/에이전트/명령 .md가 참조하는 파일·스크립트가 실제로 존재하는지 검사.
 *   "문서엔 있는데 실물이 없는" 죽은 참조를 자동 적발 (예: verify_coverage.js,
 *   haiku_tc_writer.py, agents/tc-updater.md — 2026-06-10 Fable 패스에서 수동 적발됐던 부류).
 *
 * 실행 시점 (운영 규칙):
 *   - tc-team-v2 스킬/에이전트/명령 .md를 수정한 세션의 마감 단계 (필수)
 *   - 주 1회 스케줄 (보조)
 * 수정 권한 없음 — 발견·보고만 한다. 수정은 사용자 승인 후 별도 진행.
 *
 * 사용법: node doc_reality_lint.js [--quiet]
 * 종료코드: 0=깨끗 / 1=발견 있음 / 2=설치 경로 못 찾음
 * 이력: <PROJECT_ROOT>/team/lint_history.log 에 1줄 append
 *
 * 경로 해석(2026-07-29 이식성 작업 — 배포본에서도 돌도록. ssot_drift_check.js와 동일 규약):
 *   PROJECT_ROOT = env TCTEAM_PROJECT_ROOT | 이 파일 기준 ../.. (scripts/util/ → 프로젝트 루트)
 *   CLAUDE_HOME  = env CLAUDE_CONFIG_DIR   | ~/.claude
 *   SKILL_DIR    = env TCTEAM_SKILL_DIR    | <CLAUDE_HOME>/skills/tc-team
 *   스킬을 표준 위치 밖에 뒀다면 위 환경변수로 지정한다.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const norm = (p) => p.replace(/\\/g, '/');
const PROJECT_ROOT = norm(process.env.TCTEAM_PROJECT_ROOT || path.resolve(__dirname, '..', '..'));
const CLAUDE_HOME = norm(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'));
const SKILL_DIR = norm(process.env.TCTEAM_SKILL_DIR || path.join(CLAUDE_HOME, 'skills', 'tc-team'));

// 스킬이 설치돼 있지 않으면 "문서 0개 검사 = 깨끗"으로 오보하지 않고 즉시 안내하고 빠진다.
if (!fs.existsSync(SKILL_DIR)) {
  process.stdout.write(
    `⚠ doc_reality_lint: tc-team 스킬 경로를 찾지 못했습니다 — ${SKILL_DIR}\n` +
    `  환경변수로 지정하세요: TCTEAM_SKILL_DIR / CLAUDE_CONFIG_DIR / TCTEAM_PROJECT_ROOT\n`);
  process.exit(2);
}

// ── 검사 대상 문서 ──────────────────────────────────────────────────────────
// ♻ 2026-07-28: 구 tc-team-v2 경로 → 현행 tc-team 정본(skills/tc-team + rules 서랍)으로 전환.
//   v2 스킬/문서 디렉터리는 은퇴(07-28)로 감시 제외. 구본 doc_reality_lint.js.bak_20260728_v2.
const DOC_SOURCES = [
  { dir: `${CLAUDE_HOME}/agents`, filter: n => /^(tc-|qa-reviewer-v2)/.test(n) },
  { dir: SKILL_DIR, recurse: true },
  { dir: `${CLAUDE_HOME}/commands`, filter: n => /^tc-/.test(n) },
];

// 바닐라 스크립트명(.js/.sh/.py/.bat)을 찾아볼 루트들
const SCRIPT_ROOTS = [
  `${PROJECT_ROOT}/scripts/util`,
  `${PROJECT_ROOT}/scripts/util/expander`,
  `${PROJECT_ROOT}/scripts`,
  PROJECT_ROOT,
  `${PROJECT_ROOT}/tests`,
  `${PROJECT_ROOT}/tc-team/scripts`,
  `${PROJECT_ROOT}/tc-team/scripts/confidence`,   // S7 FINAL-0 확신도 (2026-07-29 신설)
  `${PROJECT_ROOT}/tc-team/lib`,
  `${PROJECT_ROOT}/tc-team/workflows`,
  `${PROJECT_ROOT}/tc-team/test`,
  `${PROJECT_ROOT}/tc-team/tests`,                 // 하네스 (2026-09-03 추가 — s3_parallel_qa 등)
  `${PROJECT_ROOT}/tc-team/tests/s3_parallel_qa`,
];

// 의도적 언급(폐기 고지 등)이 있는 줄은 스킵
const SKIP_LINE = /(폐기|참조 금지|쓰지 않는|사용 안 함|미사용|deprecated|제거됨|미배선|않는다\)|금지\s*[—\-(]|구버전)/;

// 런타임 생성물/플레이스홀더 등 — 정적 존재 검사 제외
// 2026-09-03: 중괄호 추가 — `{부모_TC생성자동화,v1,v2,v3}.md` 같은 brace 확장 표기는
//   실제 경로가 아니라 여러 파일을 한 줄로 줄여 쓴 표기다(파일 4개는 전부 실재).
const SKIP_PATH_PART = /(\/specs\/|\\specs\\|\/tmp\/|Temp|\[|\]|\*|<|>|\{|\}|node_modules|\$\{|\.bak)/;

// 알려진 예외 (정당 사유 있는 미존재 허용 — 추가 시 사유 주석)
const WHITELIST = new Set([
  'Node.js',   // 런타임 이름 — 파일 아님 ("핵심 경로 - Node.js: ..." 표기)
  'node.js',   // 동일 (소문자 표기 대비)
  'Program',   // "C:/Program Files/..." 공백 절단 아티팩트 — pathRe가 공백에서 끊겨 생기는 오탐
  // 계획 단계 — 미구현이 정상. project_tc_qr_setup_gap.md가 "완료처리 외 파이프라인 구현
  // 전면 보류(STOP)"를 기록 중이라, 실물이 없는 것이 문서의 결함이 아니라 문서의 내용이다.
  // 구현되면 이 줄을 지운다(그때부터 존재 검사가 다시 의미를 갖는다).
  'add_test_setup.js',
]);

// 런타임 생성 확장자 — 실행 중 생기는 파일이라 정적 존재 검사 제외
const RUNTIME_EXT = /\.(log|lock|tmp)$/i;

// ── 유틸 ────────────────────────────────────────────────────────────────────
function listDocs() {
  const docs = [];
  for (const src of DOC_SOURCES) {
    if (!fs.existsSync(src.dir)) continue;
    const walk = (d) => {
      for (const name of fs.readdirSync(d)) {
        const fp = path.join(d, name);
        const st = fs.statSync(fp);
        if (st.isDirectory()) { if (src.recurse) walk(fp); continue; }
        if (!name.endsWith('.md')) continue;
        if (name.includes('.bak')) continue;
        if (src.filter && !src.filter(name)) continue;
        docs.push(fp);
      }
    };
    walk(src.dir);
  }
  return docs;
}

function cleanCandidate(raw) {
  let c = raw.replace(/[`"'()\[\]{}<>,;|]+$/g, '').replace(/[.,。…]+$/g, '');
  return c;
}

function existsAny(cand) {
  const variants = [cand];
  // 한국어 조사 등 트레일링 한글 런 제거 변형 (예: ".../경로/에" → ".../경로/")
  let v = cand;
  for (let i = 0; i < 3; i++) {
    const stripped = v.replace(/[가-힣]+$/, '');
    if (stripped === v) break;
    v = stripped;
    variants.push(v);
  }
  for (const x of variants) {
    if (!x) continue;
    try { if (fs.existsSync(x)) return true; } catch {}
  }
  return false;
}

function parentExists(cand) {
  try { return fs.existsSync(path.dirname(cand)); } catch { return false; }
}

// ── 검사 ────────────────────────────────────────────────────────────────────
const findings = [];
let refCount = 0;
const docs = listDocs();

for (const doc of docs) {
  const lines = fs.readFileSync(doc, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (SKIP_LINE.test(line)) return;
    const lineNo = i + 1;

    // 1) 절대 경로 참조 (C:\... / C:/... / ~/.claude/...)
    const pathRe = /(?:[A-Za-z]:[\\/]|~\/\.claude\/)[^\s`"'<>|()]+/g;
    let m;
    while ((m = pathRe.exec(line)) !== null) {
      let cand = cleanCandidate(m[0]).replace(/^~\//, norm(os.homedir()) + '/');
      if (SKIP_PATH_PART.test(cand)) continue;
      if (RUNTIME_EXT.test(cand)) continue;
      if (!/\.[A-Za-z0-9]{1,4}([가-힣]*)?$/.test(cand) && !/[\\/]$/.test(cand)) {
        // 확장자 없는 경로는 디렉터리로 간주해 그대로 검사
      }
      refCount++;
      if (!existsAny(cand)) {
        if (parentExists(cand) && !WHITELIST.has(path.basename(cand))) {
          findings.push({ doc, lineNo, ref: cand, kind: 'path' });
        }
      }
    }

    // 2) 바닐라 스크립트명 (.js/.sh/.py/.bat)
    // 2026-09-03 결함 A 수정: 이름 중간의 점을 허용한다. 종전 `[A-Za-z0-9_\-]+`는 점을 못 먹어
    //   `confidence.test.js`에서 **`test.js`만** 잘라내 존재하지 않는 이름으로 4건을 오탐했다
    //   (실물은 tc-team/test/confidence.test.js — 실재). 다중 확장자(.test.js/.spec.js) 전반의 문제.
    const nameRe = /\b([A-Za-z0-9_\-]+(?:\.[A-Za-z0-9_\-]+)*\.(?:js|sh|py|bat))\b/g;
    while ((m = nameRe.exec(line)) !== null) {
      const name = m[1];
      if (WHITELIST.has(name)) continue;
      // 2026-09-03 결함 B 수정: 바로 아래 주석("1)에서 처리")이 의도만 적고 구현이 없었다.
      //   그래서 이름이 경로를 달고 있어도 SCRIPT_ROOTS 바닥 검색을 또 돌았고, 두 부류가 샜다 —
      //   ①roots 밖 절대경로({WORK_ROOT}/_BRAIN/_reindex.py: 1)은 통과, 2)는 실패)
      //   ②specs 하위(1)은 SKIP_PATH_PART로 제외, 2)는 그 제외를 못 받음 — 소환권 5건).
      //   게다가 roots 밖 실재 파일은 1)·2)에서 **두 번** 계상됐다.
      //   → 줄에서 이름이 경로를 달고 있으면 판정을 1)에 맡기고 2)는 넘어간다.
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // 토큰은 **경로 글자만** 먹는다. 부정 문자셋으로 두면 한글·괄호·연산자를 삼켜
      //   `추가(코드+tests/run_tests.js` 같은 가짜 경로가 생긴다(2026-09-03 실측 1건).
      //   한글은 **포함**한다 — `specs/소환권_아이템_기능_v5/…` 처럼 경로에 실제로 쓰인다.
      const pathed = new RegExp(`[A-Za-z0-9_.~:$가-힣\-]*(?:[\\/][A-Za-z0-9_.~$가-힣\-]+)*[\\/]${esc}`).exec(line);
      if (pathed) {
        const tok = pathed[0];
        // 런타임 산출물·플레이스홀더는 1)과 동일 기준으로 제외.
        //   ⚠ SKIP_PATH_PART 는 `/specs/` 처럼 앞 슬래시를 요구해서 **토큰 선두**의 `specs/…` 를
        //     놓친다. 또 `$LIB/…` 같은 바닐라 셸 변수(`${}` 아님)도 안 걸린다.
        //     둘 다 2026-09-03 음성 표본에서 잡혔다 — 토큰 기준으로 한 번 더 거른다.
        if (SKIP_PATH_PART.test(tok)) continue;
        if (/^specs[\\/]/.test(tok) || tok.includes('$')) continue;
        if (tok.includes('...')) continue;   // `.../ssot_drift_check.js` = 생략 표기, 경로 아님
        // 드라이브 절대경로·홈(~)은 1)이 이미 존재 검사한다 — 여기서 또 세면 이중 계상
        if (/^([A-Za-z]:|~)/.test(tok)) continue;
        // 남는 건 **상대경로**. 1)의 pathRe는 상대경로를 안 잡으므로 여기가 유일한 검사 지점이다.
        //   (2026-09-03 양성 표본에서 확인 — 이 분기가 없으면 `tc-team/lib/없는파일.js`가 조용히 샌다)
        const rel = tok.replace(/^\.\//, '');
        // ⚠ 기준점에 `tc-team` 을 반드시 넣는다. 문서는 `lib/item_dict.js` 처럼 **tc-team 기준
        //   상대경로**로 쓰는 관행이 있어서, 프로젝트 루트만 보면 실재 파일을 전부 오탐한다
        //   (2026-09-03 실측 9건: lib/item_dict.js·lib/dup_gate.js·test/confidence.test.js 등).
        const REL_BASES = [PROJECT_ROOT, `${PROJECT_ROOT}/tc-team`, ...SCRIPT_ROOTS];
        const hit = REL_BASES.some(root => {
          try { return fs.existsSync(path.join(root, rel)); } catch { return false; }
        });
        if (!hit) findings.push({ doc, lineNo, ref: tok, kind: 'path' });
        continue;
      }
      // 절대 경로의 일부로 이미 검사된 경우 중복 회피: 줄에 드라이브 경로로 포함되어 있으면 1)에서 처리
      refCount++;
      const found = SCRIPT_ROOTS.some(root => {
        try { return fs.existsSync(path.join(root, name)); } catch { return false; }
      });
      if (!found) {
        findings.push({ doc, lineNo, ref: name, kind: 'script' });
      }
    }
  });
}

// ── 출력 + 이력 ─────────────────────────────────────────────────────────────
const quiet = process.argv.includes('--quiet');
const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
const histLine = `[${ts}] doc_reality_lint | docs=${docs.length} refs=${refCount} findings=${findings.length}\n`;
try { fs.appendFileSync(`${PROJECT_ROOT}/team/lint_history.log`, histLine); } catch {}

if (findings.length === 0) {
  if (!quiet) process.stdout.write(`✅ doc_reality_lint: 죽은 참조 0건 (문서 ${docs.length}개, 참조 ${refCount}건 검사)\n`);
  process.exit(0);
}

process.stdout.write(`❌ doc_reality_lint: 죽은 참조 ${findings.length}건\n`);
for (const f of findings) {
  process.stdout.write(`  - ${path.basename(f.doc)} L${f.lineNo} [${f.kind}] ${f.ref}\n`);
}
process.exit(1);
