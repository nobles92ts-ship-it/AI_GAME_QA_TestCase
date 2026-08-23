#!/usr/bin/env node
/**
 * doc_reality_lint.js — tc-team-v2 문서 죽은 참조 린터 (doc-vs-reality)
 *
 * 목적: 스킬/에이전트/명령 .md가 참조하는 파일·스크립트가 실제로 존재하는지 검사.
 *   "문서엔 있는데 실물이 없는" 죽은 참조를 자동 적발 (2026-06-10 Fable 패스에서 수동
 *   적발됐던 부류 — 폐기된 예시: verify_coverage.js, haiku_tc_writer.py, agents/tc-updater.md).
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
];

// 의도적 언급(폐기 고지 등)이 있는 줄은 스킵
const SKIP_LINE = /(폐기|참조 금지|쓰지 않는|사용 안 함|미사용|deprecated|제거됨|미배선|않는다\)|금지\s*[—\-(]|구버전)/;

// 런타임 생성물/플레이스홀더 등 — 정적 존재 검사 제외
const SKIP_PATH_PART = /(\/specs\/|\\specs\\|\/tmp\/|Temp|\[|\]|\*|<|>|node_modules|\$\{|\.bak)/;

// 알려진 예외 (정당 사유 있는 미존재 허용 — 추가 시 사유 주석)
const WHITELIST = new Set([
  'Node.js',   // 런타임 이름 — 파일 아님 ("핵심 경로 - Node.js: ..." 표기)
  'node.js',   // 동일 (소문자 표기 대비)
  'Program',   // "C:/Program Files/..." 공백 절단 아티팩트 — pathRe가 공백에서 끊겨 생기는 오탐
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
    const nameRe = /\b([A-Za-z0-9_\-]+\.(?:js|sh|py|bat))\b/g;
    while ((m = nameRe.exec(line)) !== null) {
      const name = m[1];
      if (WHITELIST.has(name)) continue;
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
