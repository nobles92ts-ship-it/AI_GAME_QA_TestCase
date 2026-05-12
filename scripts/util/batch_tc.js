/**
 * batch_tc.js
 * TC 파이프라인 배치 실행기 — 여러 Confluence 기획서를 순서대로 처리
 *
 * 사용법 1 (설정 파일):
 *   node batch_tc.js
 *   → team/batch_config.json 읽어서 실행
 *
 * 사용법 2 (인수 직접):
 *   node batch_tc.js --sheet "SHEET_URL" --urls "URL1" "URL2" "URL3"
 *
 * 각 기획서는 독립된 claude CLI 프로세스로 실행 → 컨텍스트 독립, /compact 불필요
 */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ── 경로 설정 ─────────────────────────────────────────────────────────────
const NODE    = '{NODE_PATH}';
const CLI_JS  = '{USER_APPDATA}/Roaming/npm/node_modules/@anthropic-ai/claude-code/cli.js';
const CONFIG  = '{PROJECT_ROOT}/team/batch_config.json';

// ── 인수 파싱 ─────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    return null; // 설정 파일 사용
  }

  let sheetUrl = '';
  const urls = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--sheet' && args[i + 1]) {
      sheetUrl = args[++i];
    } else if (args[i] === '--urls') {
      while (args[i + 1] && !args[i + 1].startsWith('--')) {
        urls.push(args[++i]);
      }
    }
  }

  if (!sheetUrl || urls.length === 0) {
    console.error('사용법: node batch_tc.js --sheet "SHEET_URL" --urls "URL1" "URL2" ...');
    process.exit(1);
  }

  return { spreadsheet_url: sheetUrl, confluence_urls: urls };
}

// ── 설정 로드 ─────────────────────────────────────────────────────────────
function loadConfig() {
  const fromArgs = parseArgs();
  if (fromArgs) return fromArgs;

  if (!fs.existsSync(CONFIG)) {
    console.error(`설정 파일 없음: ${CONFIG}`);
    console.error('batch_config.json에 spreadsheet_url과 confluence_urls를 입력하세요.');
    process.exit(1);
  }

  const raw = fs.readFileSync(CONFIG, 'utf8');
  const config = JSON.parse(raw);

  if (!config.spreadsheet_url || config.spreadsheet_url.includes('SHEET_ID')) {
    console.error('batch_config.json의 spreadsheet_url을 실제 URL로 수정하세요.');
    process.exit(1);
  }
  if (!Array.isArray(config.confluence_urls) || config.confluence_urls.length === 0) {
    console.error('batch_config.json의 confluence_urls에 URL을 1개 이상 입력하세요.');
    process.exit(1);
  }

  return config;
}

// ── 단일 파이프라인 실행 ───────────────────────────────────────────────────
function runPipeline(sheetUrl, confluenceUrl, index, total) {
  const prompt = `TC 팀 v2로 진행\n구글 시트 링크: ${sheetUrl}\n기획서 링크\n1. ${confluenceUrl}`;

  const result = spawnSync(
    NODE,
    [CLI_JS, '-p', '--agent', 'tc-팀-v2', '--model', 'sonnet', '--permission-mode', 'bypassPermissions', prompt],
    {
      stdio: 'inherit',
      timeout: 3600000, // 1시간
      encoding: 'utf8',
    }
  );

  return result.status;
}

// ── 메인 ──────────────────────────────────────────────────────────────────
function main() {
  const config = loadConfig();
  const { spreadsheet_url, confluence_urls } = config;
  const total = confluence_urls.length;
  const startTime = Date.now();

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`TC 배치 실행 시작 — 총 ${total}개 기획서`);
  console.log(`시트: ${spreadsheet_url}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const results = [];

  for (let i = 0; i < total; i++) {
    const url = confluence_urls[i];
    const label = `[${i + 1}/${total}]`;

    console.log(`\n${label} 시작: ${url}`);
    console.log(`${label} 시각: ${new Date().toLocaleTimeString('ko-KR')}\n`);

    const exitCode = runPipeline(spreadsheet_url, url, i, total);

    if (exitCode !== 0) {
      console.error(`\n${label} 실패 (exit code: ${exitCode})`);
      results.push({ url, status: 'FAIL', exitCode });
    } else {
      console.log(`\n${label} 완료`);
      results.push({ url, status: 'OK' });
    }
  }

  // 최종 요약
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const hh = String(Math.floor(elapsed / 3600)).padStart(2, '0');
  const mm = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ 배치 완료');
  console.log(`총 소요시간: ${hh}:${mm}:${ss}`);
  console.log('');
  results.forEach((r, i) => {
    const icon = r.status === 'OK' ? '✓' : '✗';
    console.log(`  ${icon} [${i + 1}] ${r.url}`);
  });
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main();
