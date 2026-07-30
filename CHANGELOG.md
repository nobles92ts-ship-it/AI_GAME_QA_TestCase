# Changelog

All notable changes to this project are documented here.

---

## [v4.0.1] — 2026-07-30

**Setup-completeness patch — closes the gaps between "all files present" and "someone else can actually run it".**

### Fixed
- **Workflow tool requirement was undocumented.** S3 (sentence fan-out) and S4 (adversarial review) run as `Workflow({...})` calls; a fresh install would sail through S0–S2 and halt at S3 with no explanation. Now stated in README scope, PREREQUISITES §5 (with verify step), and the skill itself now stops with an explicit message instead of proceeding blind.
- **`team/tc_config.json.example` restored** (dropped in the v4.0.0 tree cut). It is the only documented way to enable the optional cross-reference step; updated to include `crossref_source` (your own index name — nothing project-specific ships here). Default remains `off`, which skips the step with 100% identical behavior.
- **`context-mode` MCP documented** as the optional dependency behind `crossref_brain: "on"` (PREREQUISITES MCP table + explanation).
- `.gitignore`: added `team/tc_config.json` (machine-local, as its own example file promises) and `.env.local` / `.env.*.local`.
- `package.json` version now tracks releases (was stuck at 1.0.0).
- `scripts/util/dep_check.py` refreshed: path-reference check now covers `.sh` / `.ps1` / `.mjs` (the gap that let a nonexistent `preflight.ps1` instruction survive six weeks) and `tc-team/` relative paths.

---

## [v4.0.0] — 2026-07-29

**Breaking — the `tc-팀-v2` engine has been retired and removed.**
v2 remains permanently available at the `v3.1.0` tag. See *Migrating from v2* in the README.

### Added

#### tc-team — deterministic two-lane pipeline
- `tc-team/lib/` — 14 modules. The LLM writes sentences and makes judgment calls; **deterministic code owns structure, gates, and the coverage ledger.**
- **7 gates**, none of which consult a model: `design_gate`, `content_gate`, `dup_gate`, `origin_gate`, coverage seal, `golden_diff`, `traceability`
- `tc-team/scripts/confidence/` — rule-based (R1–R7) row confidence scoring with **zero LLM calls**; identical input always yields an identical score
- Single sheet touch: assemble and verify locally, write once, read back and diff
- `skills/tc-team/rules/` — 9 rule files as the customisation SSoT; no build step, no synchronised copy
- `agents/tc-team-designer`, `tc-team-대조`, `tc-team-설계검수`
- 13 deterministic test suites

#### Table-cell rule extraction (`tc-team/lib/slicer.js`)
- Rules are now extracted from Markdown **table cells**, not only from bullet and numbered lists. Specs written entirely as tables previously produced rows with no anchor.
- Excludes header rows, separator rows, repeated header rows, change-history rows, image-only cells, and non-prose cells
- Handles Confluence→Markdown conversion flattening nested bullets onto one line
- `--table-min-chars` (default 12) bounds the rule count so the coverage-sealing loop cannot be flooded

#### Ledger format contract (`tc-team/lib/traceability.js`)
- `coverage.json` and `exclusions.json` are plain arrays; wrapped objects are tolerated on read
- Exclusion `reason` is one of three exact values, with prose evidence moved to a `note` field

#### Path portability
- The engine, chain scripts, and both linters now derive their roots from `TCTEAM_PROJECT_ROOT` / `CLAUDE_CONFIG_DIR` or from the script's own location — no absolute paths
- `setup.sh` / `setup.ps1` now substitute placeholders inside `skills/`, `tc-team/`, and `scripts/` as well as `agents/`. Previously rule files kept their placeholders verbatim and every path reference in them was broken after install.

### Removed
- `tc-팀-v2` and the other 9 `*-v2` agents; the per-stage v2 skill directories; `commands/tc-v2.md`; `tc_v3/`
- v2-era pipeline diagram, landing badge, and `docs/tc_pipeline_v2.html`

### Unchanged
- `tc-대시보드`, `tc-이미지매칭`, `haiku` skills and their supporting scripts

### Measured — 277-row production run, 2026-07-29
| Check | Result |
|---|---|
| Sheet read-back diff | 0 |
| Exact duplicate rows reaching the sheet | 0 (prior v2-era run: 3 pairs) |
| Fabricated requirements caught before review | 7 — 5 confirmed and promoted to "spec confirmation needed" |
| Deterministic test suites | 13 ALL GREEN |

---

## [v3.1.0] — 2026-07-13

- `/tc-team` deterministic engine shipped alongside v2 (both engines present)

## [v3.0.0] — 2026-07-13

- tc-v3 deterministic pipeline (preview)

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
