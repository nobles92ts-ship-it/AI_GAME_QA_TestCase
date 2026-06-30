# Changelog

All notable changes to TC Team v2 are documented here.

---

## [v2.3.3] — 2026-06-30

A usability + quality release. Headline: a **local `.xlsx` output path** so a fresh clone can generate test cases with **no Google/OAuth/Confluence setup**, a **one-click Windows installer**, an **automatic dashboard rebuild** in Apps Script, and **TC-quality learnings** from production runs.

### Added
- **Local `.xlsx` output mode (`--local`) + `/tc-로컬`.** Generate test cases as a local Excel file instead of a Google Sheet — no OAuth/Sheets/Confluence required. `run_pipeline.sh --local` (and the new `run_local_xlsx.sh` / `/tc-로컬` command) route through the new `create_xlsx_tc_from_json.js` writer when `TC_LOCAL_XLSX` is set; the same Pre-Write row-quality validation runs first, so row quality matches the Sheets path. Local mode runs through STEP 4 (writing) only — Sheet-based reviews (STEP 5/6) and completion are skipped — and reports the `.xlsx` path. README now documents local `.xlsx` as the default, Google Sheets as optional.
- **One-click Windows installer (`install.ps1`).** `$0` onboarding on a personal subscription: auto-installs Node.js (winget → MSI LTS fallback) with in-session PATH refresh, with a Windows OS guard and `exit 1` on failure.
- **Automatic dashboard rebuild (Apps Script).** After tab cleanup, `tab_manager.gs` calls `rebuildDashboard()` from the new `dashboard_builder.gs` (hidden tabs excluded; failure is non-fatal — colors/order preserved). `deploy_appscript.js` adds `dashboard_builder.gs` to the deploy set and enables the Advanced Sheets Service it needs.

### Changed
- **TC-quality learnings (2026-06-29).** `tc-리뷰`/`tc-생성`/`tc-설계` skills: detect meaningless duplicate TCs that clone a normal case into negative/exception with **no change in expected result** (EVAL-07); for decal-less basic/non-target attacks (always-hit), **do not** create avoid/negative cases (avoidance cannot occur).
- `validate_tc_rows.js` — adds `유저상태` and `권한` to the recognized tree tags.
- `tc-학습-관찰` log — records a missed `status_ailment` clear-transition case (2026-06-19).

### Fixed
- **Setup robustness** — Windows PowerShell 5.1 compatibility fixes (3 clean-PC install blockers); restored `run_pipeline.sh` placeholders after a prior push had shipped a setup-substituted copy (real paths) that broke install.

---

## [v2.3.2] — 2026-06-19

A patch release adding an **optional, off-by-default** DXR design cross-reference stage, plus a quality-gate fix.

### Added
- **DXR cross-reference (대조) — optional plugin, off by default.** A new `tc-대조-v2` agent runs just before the STEP 2 review, **deterministically invoked by the pipeline runner** (not left to LLM discretion) when `crossref_brain=on`. It cross-checks unresolved / under-specified design items against an indexed design-wiki "brain" (context-mode `brain-corpus`) and classifies each as **apply / locate / discover / keep**; `discover` and approved `apply` findings deterministically trigger the STEP 3 design-fix. Fully **fail-safe**: with no brain — the default for cloners (`crossref_brain=off`) — the stage is skipped and behavior is identical to v2.3.1. Brain corpus data is never published; only the toggle + skill rules ship.
- `team/tc_config.json.example` — documents the `crossref_brain` off/on toggle (the runtime `tc_config.json` is git-ignored, machine-local).

### Fixed
- **FINAL-4 integrity gate false positive** — the abstract-phrasing regex matched `정상적으로` ("normally", a vague qualifier) as a substring of `비정상적으로` ("abnormally", a concrete negative-test term), wrongly stopping clean runs. Added a negative-lookbehind so concrete negative-test wording no longer trips the gate.

### Changed
- `tc-설계검수`, `tc-분석`, `tc-설계` skills — DXR cross-reference consumption contract + boss combat decal/AoE design rules.

---

## [v2.3.1] — 2026-06-15

A patch release that adds a gentle post-completion notice for the **optional, manual** image-matching step.

### Added
- **FINAL-6 image-matching notice** — when all requested test cases are complete, the completion step now appends a one-line reminder that visual references can be added manually via `/tc-이미지매칭`. Image matching is **not** auto-run — it stays on-demand (avoids per-run cost, token, and attachment-token dependency); the notice only surfaces the option. In batch runs it appears once, after the last feature.

### Changed
- `완료처리` skill — documents FINAL-6 (notice only, no execution).
- `run_pipeline.sh` — chain completion emits the FINAL-6 notice line.
- `tc-팀-v2` agent — final report appends the image-matching notice line.

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
