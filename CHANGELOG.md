# Changelog

All notable changes to this project are documented here.

---

## [v4.2.0] — 2026-08-23

**Two silent failures made loud, one bottleneck cut by 60%, and a name for every item a tester has to pick up.**

### Added
- **Item citation, end to end.** A reproduction step that says "use a crafting material item" does not tell a tester what to pick up. On one 159-row run, 44 rows named only a *type*, and six rows assumed a material that serves two systems at once — a combination that does not exist in the tables at all. Type-only wording cannot distinguish "hard to reproduce" from "impossible to reproduce".

  Three pieces now cover it. `lib/item_dict.js` builds a dictionary by joining the game's own tables — type → representative real items, plus which consumption systems each item crosses. It is a *dictionary generator and nothing else*: it never writes a sentence. `lib/item_cite_gate.js` then decides what a machine can decide without context — a display name shared by many items but cited without an index, a name that is not in the tables at all (i.e. guessed), a single example attached to a sentence that verifies the whole type, and a repeated citation. Those four are confirmed violations. A fifth signal, "type named but no citation", is deliberately *not* a violation: it is a question for the review lens, because whether a citation is needed depends on whether the tester must hold that item, and that needs context the code does not have.

  Zero-count combinations are kept in the output on purpose. "The data contains no such item" is the most valuable thing the dictionary can report, and the design rules use it to raise a spec question instead of deleting the case.

  The table bindings live in config (`item_dict.systems.json.template`), not in the code — every game names its tables differently, and a tool that hardcodes one game's schema is not a tool.

- **`stampGate` — confidence stamping now fails loudly.** A parser returned zero design items, so every sheet row fell through as drift; the applier logged "0 rows coloured, 218 rows drifted" as a single warning and exited 0, and the finalizer reported it as a green check. A sheet with the confidence pass missing entirely looked like a clean run. Zero items, or drift above half the rows, is now a failure with a message that names the likely cause.

- **Evidence pack** (`lib/evidence_pack.js`) — a common envelope written best-effort at the chain's success point.

### Changed
- **Sentence generation runs in parallel** (`TCTEAM_S3_PAR`, default 4). It was the single largest cost in a run. Chunks are independent, so they now go out in waves. Measured on six live chunks: 5m40s wall clock against 14m19s serial — **60.4% saved**, with zero duplicates and zero retries.

  Isolation was the hard part, not the concurrency. stderr logs *and* validation-failure reasons are both split per chunk — sharing either one means a retry prompt gets fed another chunk's failure. Auth and quota exits propagate from the subshell through `wait`; retries stay local to their chunk; and fail-fast is preserved, because a re-entry deletes all chunk output anyway, so continuing to launch work would be pure waste.

- **Coverage ledger chunking** — chunk boundaries are passed as explicit rule-id lists rather than indices, so the model never has to recount the source order.

- **One lock, released.** A second lock nobody had documented was being taken and never released — found in nine spec folders, the oldest 21 days. The edit guard read those ghosts as "a run is in progress" and blocked script edits for three hours after a finished run, while any run *longer* than three hours lost its protection entirely.

- **S3 → S4 input contract** is now checked explicitly; resuming at S4 without the snapshot used to let the lenses proceed on empty input with only a warning.

- **Cross-reference resolution rate** is reported. A run where nothing resolved used to finish silently, which is exactly the run you most need to hear about.

### Rules
- **"Not yet implemented" outranks "needs spec confirmation."** If a feature is scheduled for later, an absent expected value is not a question for the planner — asking produces "it'll be decided when it's built" and the tester has no build to verify against. Of 104 rows in one run, 74 were labelled wrong. Deletion-type items are explicitly excluded: those *are* verifiable now.
- **QA scope directive** — an optional file that narrows what this round verifies. A design once expanded from "is the stat displayed" into "does the stat actually increase", and no review lens caught it, because the lenses did not know the scope.
- **Linked-page prefetch** — resolve unspecified values from pages the spec links to before raising a question. Also documents the opposite case: prose can name a document that does not exist yet.
- **Non-requirement sections** (competitor research, as-is descriptions) no longer become test-case candidates.
- **Re-query gate on cross-reference** — a batch where *everything* missed usually means the query was wrong, not that the knowledge base is empty. Re-querying with shorter noun-only terms flipped one run from 25 unresolved to 17 located / 2 discovered / 8 unresolved.
- **Spec-question hygiene** — do not ask about our own process, do not ask what the document already answers, and when asking for a number, offer candidate values.

### Tests
- New suites for the item dictionary, the citation gate, and the conversion gate; the confidence suite grows to 24 cases. Full deterministic core: **183 passing**.

---

## [v4.1.1] — 2026-07-31

**One cross-reference branch was swallowing the other.**

### Fixed
- **A row with any unresolved dependency ignored its located ones entirely.** The rule was `if (keeps) R3 else if (locates) R4` — exclusive — so `1 keep` and `1 keep + 5 locates` scored identically. The five located dependencies were invisible in both the score and the report. R3 and R4 are now recorded separately, each with its own penalty and its own term list.

  Making them simply additive would have been wrong: `1 keep + 1 locate` (−25 −12 = −37) would score *worse* than `2 keeps` (−33), inverting the meaning of the two branches — a located dependency is a more advanced state than an unresolved one, never a worse one. So the first unresolved dependency sets the base penalty and the rest add at their branch's incremental rate, with the combined total capped at R3's ceiling. Converting a keep into a locate now always improves the score, at every count:

  | 3 unresolved total | penalty |
  |---|---|
  | 3 keeps | −41 |
  | 2 keeps + 1 locate | −38 |
  | 1 keep + 2 locates | −35 |
  | 3 locates | −22 |

  Measured over 30 specs / 3347 test-case rows: **71 rows (2.1%)** had both branches and were losing the locate signal, average −6.2 further points, **17 of them changing grade**.

- **The report's rule appendix was hardcoded and had drifted.** It still listed R7 as a `+8` bonus after v4.1.0 demoted it to a display badge, and it showed R3/R4 as flat `-25`/`-12` with no mention of the count scaling added in the same release. The table is now generated from the rule definitions, so it cannot drift again, and it states the combined R3+R4 ceiling.

### Added
- Test for the ordering invariant: for every total count from 1 to 8, converting a keep into a locate must not increase the penalty. Confidence suite is now 17 tests.

---

## [v4.1.0] — 2026-07-30

**Confidence scoring: measured, tuned, and tested — plus two silent-failure fixes that affected every default install.**

The confidence score (stamped at S7, non-blocking) was shipped without a test suite and without ever being measured against real runs. This release closes both gaps. All findings below come from measurement over live pipeline output, not review.

### Fixed
- **Confidence scoring crashed under the default config.** `crossref_brain: "off"` is the shipped default, and it means `dxr_crossref.json` is never written — but the scorer read it (plus `coverage_gaps.json`, `tc_skeleton.json`) with an unguarded `JSON.parse`, so it threw `ENOENT` instead of degrading. Missing inputs now fall back to empty and scoring proceeds on the rules that still have data.
- **`crossref_source` was a documented-but-dead config key.** v4.0.1 added it to `tc_config.json.example`, but `run_pipeline_s1only.sh` hardcoded the index name in the agent prompt, so setting it did nothing. Now read from config, with the previous value as fallback.
- **`run-agent.sh` silently produced nothing under git-bash.** A git-bash `$HOME` — a POSIX path of the form `/c/<user-dir>` — was handed straight to a Windows-native `node`, which resolved it relative to the drive root as a nonexistent `C:\c\...` and failed. The failure mode was the bad part: the agent kept running and reported success while writing no file. Now converts via `cygpath` (with a manual `/c/x` → `C:/x` fallback), passes the path as `process.argv[1]` instead of interpolating it into JS source, and exits non-zero when the agent file is missing.
- **Item-level cross-reference matching leaked the section name into the haystack.** A term that appeared only in the screen/section title — not in the test case line — still penalized that line. 199 TC lines (6.1%) in measurement.

### Changed
- **R3/R4 now scale with the number of unresolved terms.** They were flat, so one unresolved dependency scored identically to ten. Now `R3 = 25 + 8/extra (cap 45)` and `R4 = 12 + 5/extra (cap 25)`, chosen from a coefficient sweep. Effect on a real run: distinct score values 28 → 46, and the two most common scores went from 55.7% of all rows to 42.5% — the score separates cases that used to collapse together.
- **R7 (design-technique correspondence) is now a display-only badge, not a bonus.** It was specified as `+8` gated on "no penalties on this row", but across live runs it fired 71 times and changed the score **0** times — the gate cannot realistically open. It stays visible in the report as a badge; it no longer implies a bonus that never arrives.
- Rule penalties are resolved through a single helper, so a non-scaling rule can no longer be silently clamped by a decorative `cap`.

### Added
- **`tc-team/test/confidence.test.js` — 16 tests, with fixtures.** Locks the item/leaf score tables, R5 stage selectivity, R2 inheritance, R7-as-badge, absence of the section-name leak, count scaling, the `R4 max ≤ R3 min` ordering invariant, operation with cross-reference disabled, and tokenization. Runs under `node tc-team/test/run_all.js` with the rest of the suite.
- **`tc-team/scripts/confidence/sweep.js`** — offline, read-only coefficient sweep. Re-tune the penalties against your own runs and see the score distribution before changing anything; it never writes pipeline output.
- **Silent-miss detector.** When unresolved terms exist but zero items matched them, the HTML report shows a banner and the run warns on stderr. This is exactly how the `crossref_brain: "off"` breakage above stayed invisible — a scorer reporting high confidence because its input never loaded.
- Knowledge-index preparation guide (`docs/`): what the optional cross-reference step actually needs, a three-rung readiness ladder, and the principle that you index your own documents — nothing project-specific ships in this repo.

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
