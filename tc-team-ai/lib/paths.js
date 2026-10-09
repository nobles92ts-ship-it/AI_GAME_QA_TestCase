'use strict';
// 경로 해석 — tc-team 체인과 같은 규칙: 스크립트 자기 위치에서 루트를 유도한다(tc-team-ai/lib → ../..).
// 배포본·로컬이 같은 레이아웃이라 양쪽에서 동작한다. TCTEAM_PROJECT_ROOT 가 있으면 그게 이긴다.
const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = process.env.TCTEAM_PROJECT_ROOT || path.resolve(__dirname, '..', '..');
const CLAUDE_HOME = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

// 규칙 서랍: env → 설치 위치(~/.claude/skills — tc-team 과 같은 자리) → 레포 안(설치 전 테스트)
function resolveRulesDir() {
  if (process.env.TCTEAM_AI_RULES_DIR) return process.env.TCTEAM_AI_RULES_DIR;
  const installed = path.join(CLAUDE_HOME, 'skills', 'tc-team-ai', 'rules');
  return fs.existsSync(installed) ? installed : path.join(PROJECT_ROOT, 'skills', 'tc-team-ai', 'rules');
}

module.exports = { PROJECT_ROOT, CLAUDE_HOME, resolveRulesDir };
