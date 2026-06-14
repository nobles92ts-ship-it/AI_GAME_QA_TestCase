# Changelog

All notable changes to TC Team v2 are documented here.

---

## [v2.3.0] — 2026-06-14

A pipeline-architecture + usability release. The review/fix stages were merged, the
pipeline shrank from 7 to 6 steps, and the published repo was reworked so a fresh
clone is fully self-configurable.

### Added
- **`tc-리뷰1수정1-v2` agent** — STEP 5 now performs the 1st-round structural review **and**
  applies its fixes in a single context (Phase 2-B merge).
- **`scripts/util/expander/`** — analysis→design expander infrastructure (Phase A).
- **`appscript/bvt_slack.gs`** — BVT results → Slack push (dashboard M6 button).
- **Design gates C-12 / C-13** — analysis→design expansion-rate gate, and Opus
  re-analysis when an analysis gap is detected at STEP 2.
- **Slash-command install** — `setup.ps1` / `setup.sh` now install `commands/*.md` to
  `~/.claude/commands/`, so `/tc-v2` works after setup.

### Changed
- **Pipeline 7 → 6 steps.** STEP 5 = merged R1 review+fix (`tc-리뷰1수정1-v2`),
  STEP 6 = merged R2 review+fix (`tc-리뷰2수정2-v2`). The old split agents
  `qa-reviewer-v2` / `tc-fixer-v2` are retained for rollback but no longer called.
- **`setup.ps1` / `setup.sh`** — resolve all 7 path placeholders
  (`{NODE_PATH}`, `{CLI_JS}`, `{PROJECT_ROOT}`, `{WORK_ROOT}`, `{CLAUDE_HOME}`,
  `{CLAUDE_AGENTS_DIR}`, `{CLAUDE_SKILLS_DIR}`) across agents, skills, scripts and
  commands at clone time, so shipped `.sh`/`.js`/`.py` run without manual path edits.
- **`package.json`** — version bumped to `2.3.0`; dependencies corrected to the
  actually-used set (`googleapis`, `xlsx`); script paths fixed to `scripts/util/`.
- **`.env.example`** — keys realigned to what the scripts actually read
  (`GOOGLE_OAUTH_PATH`, `GOOGLE_TOKEN_PATH`, `SPREADSHEET_ID`, `SLACK_BOT_TOKEN`),
  all optional with documented defaults.
- **Docs rewritten** — `SETUP.md`, `PREREQUISITES.md`, `ARCHITECTURE.md` updated to the
  real `setup.ps1`/`setup.sh` flow, the 6-step pipeline, and native PDF/Word reading.

### Removed
- **`pipeline_config.json.template`** — no script or agent ever read it (dead config trap).
- **Gemma4 / Ollama remnants** — removed the `gemma4` MCP block from `.mcp.json.example`
  and the Ollama/Google-AI sections from `.env.example` (v2 is Claude Code CLI-only).
- **`docs/tc_pipeline_v2.html`** — orphaned visual showing the deprecated v1
  (Gemma4, 7-step) architecture.
- **`pdf-parse` / `pdfjs-dist` / `mammoth`** references — PDF and Word are read natively
  by Claude Code; only `xlsx` (Excel) is an actual npm parser dependency.

### Security
- `scripts/util/confluence_image_downloader.py` — config path now read from
  `CLAUDE_DESKTOP_CONFIG` env (falls back to the default user path) instead of a
  hardcoded absolute path.

---

## [v2.2.9] — 2026-05-12

### Changed
- `update_dashboard.js` — dashboard clear range limited to `A:L` so manually-maintained
  columns beyond L are preserved on refresh.

### Added
- Restored several pipeline utility scripts that were missing from the published tree.

---

## [v2.2.8] — 2026-05-11

### Added

#### 탭 색상 자동 관리 (Tab Color Auto-Management)
- `appscript/tab_manager.gs` — Google Apps Script: 스프레드시트 TC 탭 색상을 PC 결과(H열) 기준으로 자동 판정
  - 미진행: 기본색 / 진행 중(FAIL 없음): 노란색 `#FBBC04` / FAIL 포함: 빨간색 `#EA4335` / 전부 통과: 파란색 `#4285F4`
  - 탭 순서: 대시보드(1) → BVT(Trunk)(2) 고정 → 기본 → 노란 → 빨간 → 파란
- `scripts/util/deploy_appscript.js` — Apps Script 배포 도구 (최초 1회 실행)
- 실행 방식: 대시보드 M3 체크박스 클릭(수동) + 매일 09:00 KST 자동 실행

#### 대시보드 업데이트 내역
- 완료처리 보고 표에 "5. 탭 색상 정렬(M3 버튼)" 항목 추가 (`skills/완료처리/완료처리.md`)
- 파이프라인 완료 보고(`tc-팀-v2.md`)에 탭 색상 정렬 안내 행 추가

### Security
- `.gitignore` 강화 — TC 파이프라인 민감 데이터 제외 규칙 추가
  - `team/specs/` — SHEET_ID·Confluence URL 포함 분석 결과
  - `**/tc_after_fix*.json`, `**/_final_dump.json`, `**/confluence_raw.md`, `**/sheet_info.txt`
  - `credentials/` — OAuth 토큰·클라이언트 시크릿
- `tab_manager.gs` SPREADSHEET_ID 하드코딩 제거 (빈 문자열로 교체, 배포 후 설정)

### Changed
- `agents/tc-팀-v2.md` — description에 `v2.2.8` 버전 표기 추가

---

## [v2.2.7] and earlier

See git history.
