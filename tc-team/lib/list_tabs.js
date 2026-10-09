#!/usr/bin/env node
'use strict';
// list_tabs.js — 스프레드시트 탭 이름 목록 (읽기 전용, tc-team S0 의 _vN 판정용, 2026-10-01)
// Claude S0 는 google-sheets MCP 로 탭을 확인했다. Codex 경로는 같은 계정 정보를
// scripts/util/google_auth.js 로 읽어 spreadsheets.get(fields=sheets.properties.title) 만 부른다.
// 출력: 탭 이름 JSON 배열 한 줄. 실패 = exit 1 (S0 는 fail-closed — 탭을 모르고 이름을 정하지 않는다).
const path = require('path');

async function main() {
  const sheetId = process.argv[2];
  if (!sheetId) { process.stderr.write('사용: list_tabs.js <sheetId>\n'); process.exit(2); }
  const UTIL = process.env.TCTEAM_UTIL_DIR || path.resolve(__dirname, '..', '..', 'scripts', 'util');
  const { google } = require('googleapis');   // 프로젝트 루트 node_modules (google_auth.js 와 같은 사본)
  const { getAuthClient } = require(path.join(UTIL, 'google_auth'));
  const auth = await getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });
  const r = await sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: 'sheets.properties.title' });
  const tabs = (r.data.sheets || []).map((s) => s.properties.title);
  process.stdout.write(JSON.stringify(tabs) + '\n');
}

main().catch((e) => { process.stderr.write('list_tabs 실패: ' + (e && e.message) + '\n'); process.exit(1); });
