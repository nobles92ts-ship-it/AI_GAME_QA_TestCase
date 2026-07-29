# AI_GAME_QA_TestCase — tc-team

<a href="https://claude.ai/code">
  <img src="https://img.shields.io/badge/Built%20with-Claude%20Code-7C3AED?style=for-the-badge&logo=anthropic&logoColor=white" height="40">
</a>

> **Deterministic game-QA test-case pipeline.**
> Hand it a spec and a sheet — get back a reviewed test-case tab whose structure, gates, and coverage ledger are owned by code, not by a model.

> **Scope, stated honestly:** this is a **semi-automatic runbook**, not a single unattended command. Your Claude Code session acts as the driver and steps through S0–S7, stopping at any gate that fails. A fully unattended driver is on the roadmap. Verified end-to-end on 3 production features.

[![Docs — Architecture](https://img.shields.io/badge/docs-ARCHITECTURE.md-blue?style=flat)](docs/ARCHITECTURE.md)
[![Docs — Setup](https://img.shields.io/badge/docs-SETUP.md-blue?style=flat)](docs/SETUP.md)
[![Docs — Prerequisites](https://img.shields.io/badge/docs-PREREQUISITES.md-blue?style=flat)](docs/PREREQUISITES.md)

---

## ⚠️ v4.0.0 — the v2 engine has been retired

This release replaces the `tc-팀-v2` multi-agent orchestrator with **tc-team**, a two-lane pipeline.
**If you are running v2, read [Migrating from v2](#-migrating-from-v2) before you pull.**

---

## ⚡ TL;DR

- **Two lanes, strictly separated** — the LLM writes sentences and makes judgment calls; **deterministic code owns structure, gates, and the coverage ledger**. No model ever decides whether a gate passes.
- **8 stages (S0–S7)** — each with a machine-checkable exit condition
- **7 deterministic gates** — design, content, duplicate, origin, coverage seal, golden diff, traceability ledger
- **Confidence scoring with zero LLM calls** — a rule-based score (R1–R7) tells you which rows deserve human attention
- **One sheet touch** — everything is assembled and verified locally, then written once and read back for a 0-diff check
- **4 input formats** — Confluence URL / PDF / Word / Excel, auto-detected
- **No external API** — all model calls go through the Claude Code CLI

---

## 🎯 The design decision — why determinism

v2 asked a model to author test cases *and* judge its own output. That works until it doesn't: duplicate rows reach the sheet, fabricated requirements pass review, and coverage is whatever the model says it is. None of it is reproducible.

tc-team draws a hard line:

| Owned by the **LLM** | Owned by **deterministic code** |
|---|---|
| Reading the spec, designing coverage | Slicing the spec into rules |
| Writing each test-case sentence | Row structure, IDs, column contracts |
| Adversarial review judgments | Every gate pass/fail decision |
| — | Coverage ledger, exclusions, traceability |
| — | Duplicate detection, origin verification |
| — | Sheet write + read-back diff |

**This is a tradeoff, stated plainly:** tc-team takes roughly **2.2× the wall-clock time** of the v2 engine. What you get back is reproducibility, an auditable coverage ledger, and gates that catch a class of defect v2 shipped silently.

---

## 📊 Measured — production run, 2026-07-29

A 277-row feature run, all figures measured rather than asserted:

| Check | Result |
|---|---|
| Rows written live | 277 |
| Sheet read-back diff | **0** |
| Exact duplicate rows reaching the sheet | **0** (the previous v2-era run shipped 3 duplicate pairs) |
| Fabricated requirements caught **before** review | **7** — 5 confirmed by the cross-reference lens and promoted to "spec confirmation needed" |
| Deterministic core test suite | **13 suites, ALL GREEN** |

The 7 fabrications are the important number. In the prior run the same failure mode was only found *after* the sheet was delivered, by hand.

---

## 🏗 Pipeline — S0 to S7

| # | Stage | Lane | What it produces |
|---|-------|------|------------------|
| **S0** | Preparation | main | Workspace, spec ingestion, run config |
| **S1** | Design | **LLM** (Opus) | Spec analysis → coverage design → cross-reference → design inspection |
| **S2** | Isolation gate + slicing | code | Spec sliced into addressable rules |
| **S3** | Sentence fan-out | code + LLM + code | Deterministic skeleton → LLM writes sentences → deterministic merge |
| **S4** | Adversarial review + coverage ledger | **LLM** judgment, code ledger | Findings, verdicts, coverage/exclusions ledger |
| **S5** | Apply + gates | code | Fix plan applied, every gate evaluated |
| **S6** | Live write | code | **One** sheet touch, then read-back 0-diff verification |
| **S7** | Completion | code | Confidence scoring, labelling, dashboard, Drive sync |

Full stage contracts: [`skills/tc-team/SKILL.md`](skills/tc-team/SKILL.md) · internals: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

### The gates

| Gate | Catches |
|------|---------|
| `design_gate` | Design that can't be converted into rows |
| `content_gate` | Abstract, unverifiable phrasing; column whitelist violations |
| `dup_gate` | Duplicate and logically-negated-duplicate rows |
| `origin_gate` | Requirements with no anchor in the source spec (fabrication) |
| coverage seal | Rules with no covering row, and unjustified exclusions |
| `golden_diff` | Any unintended drift against the approved snapshot |
| `traceability` | Rule ↔ row ledger integrity |

A gate failure stops the run. No gate consults a model.

### Confidence scoring — no LLM calls

`tc-team/scripts/confidence/` scores each row deterministically (rules R1–R7: spec-confirmation needed, image-only reference, unresolved cross-reference, weak anchor, coverage gap, design-technique bonus). The output tells a reviewer where to spend attention. Because it is pure code, the same input always yields the same score.

---

## 🚀 Quick start

Assumes [Claude Code](https://claude.ai/code) is installed.

```bash
git clone https://github.com/nobles92ts-ship-it/AI_GAME_QA_TestCase.git
cd AI_GAME_QA_TestCase
```

```bash
bash ./setup.sh
```

On Windows use `.\setup.ps1` instead.

The setup script auto-detects Node.js and the Claude Code CLI, installs agents and skills into `~/.claude/`, substitutes every `{PROJECT_ROOT}` / `{NODE_PATH}` / `{CLAUDE_HOME}` / `{CONFLUENCE_SITE}` placeholder, creates `.env` and `pipeline_config.json` from templates, and runs `npm install`.

Then, in Claude Code, hand it a sheet link and a spec link **together**:

```
/tc-team <google-sheets-url> <spec-source>
```

`<spec-source>` can be a Confluence URL, or a path to a `.pdf`, `.docx`, or `.xlsx` file.

Your session then drives S0–S7, reporting at each stage and halting on any gate failure. A spec link **without** a sheet link is rejected rather than guessed at. One feature per run — there is no batch mode.

Full walkthrough: [docs/SETUP.md](docs/SETUP.md) · Dependencies: [docs/PREREQUISITES.md](docs/PREREQUISITES.md)

---

## 🔧 Customising the rules — and the two linters

Every pipeline rule lives in `skills/tc-team/rules/` as a Markdown file. Edit those and the pipeline picks the change up on the next run; there is no build step and no copy to keep in sync.

But editing a rule can silently desynchronise it from the machinery that enforces it. Two linters exist for exactly that moment:

| Linter | Question it answers |
|--------|--------------------|
| `scripts/util/doc_reality_lint.js` | Does every path, script, and agent named in the docs actually exist? |
| `scripts/util/ssot_drift_check.js` | Has a rule document drifted from the deterministic code that implements it? |

```bash
node scripts/util/doc_reality_lint.js
node scripts/util/ssot_drift_check.js
```

**These are not part of the pipeline and do not run automatically.** They are maintenance tools: run them after you edit rules, not on every TC run. If you only *use* the pipeline as shipped, you will never need them.

---

## 🔁 Migrating from v2

**v2 is not deleted — it is pinned.** Everything from the v2 era remains permanently available at the [`v3.1.0`](https://github.com/nobles92ts-ship-it/AI_GAME_QA_TestCase/releases/tag/v3.1.0) tag.

**To stay on v2**, pin that tag and stop pulling `main`:

```bash
git checkout v3.1.0
```

**To move to tc-team**, note that v4.0.0 has an unrelated commit history, so `git pull` will fail with *"refusing to merge unrelated histories"*. Re-clone:

```bash
git clone https://github.com/nobles92ts-ship-it/AI_GAME_QA_TestCase.git
```

What changed for you:

| v2 | v4 (tc-team) |
|---|---|
| `/tc-v2 <sheet> <spec>` | `/tc-team <sheet> <spec>` |
| 10 `*-v2` agents | 3 `tc-team-*` agents |
| One skill directory per stage | `skills/tc-team/rules/` — 9 rule files |
| Review verdicts decide correctness | Deterministic gates decide; LLM only judges |

`tc-대시보드`, `tc-이미지매칭`, and `haiku` are unchanged and still ship.

---

## 🗺 Repository structure

```
AI_GAME_QA_TestCase/
├── agents/                       # 3 tc-team agent definitions
│   ├── tc-team-designer.md       # S1 — spec analysis & coverage design
│   ├── tc-team-대조.md            # S1 — cross-reference against the knowledge index
│   └── tc-team-설계검수.md        # S1 — design inspection gate
│
├── skills/
│   ├── tc-team/
│   │   ├── SKILL.md              # S0–S7 stage contracts (entry point)
│   │   └── rules/                # 9 rule files — the SSoT you customise
│   ├── tc-대시보드/               # Dashboard refresh
│   ├── tc-이미지매칭/             # Confluence image → sheet column matching
│   └── haiku/
│
├── tc-team/                      # The deterministic engine
│   ├── lib/                      # 14 modules — gates, slicer, ledger, sheet I/O
│   ├── scripts/                  # Chain drivers + confidence scoring
│   ├── test/                     # 13 suites
│   └── docs/                     # Driver reference, EVAL digest, guides
│
├── scripts/util/                 # Shared Node utilities + the 2 linters
│   └── expander/                 # Design expansion & schema validation
│
├── appscript/                    # Google Apps Script (tab colour/sort, Slack)
├── docs/                         # Setup, prerequisites, architecture
├── commands/                     # Slash commands
└── credentials/                  # OAuth files (gitignored, .gitkeep only)
```

---

## 🛠 Tech stack

| Layer | Tech |
|-------|------|
| Agent runtime | Claude Code CLI |
| Orchestration | Bash + Node.js |
| Input parsers | `xlsx` · `pdf-parse` / `pdfjs-dist` · `mammoth` · MCP (Confluence ADF) |
| Output | Google Sheets API via `googleapis` |
| MCP integrations | `google-sheets`, Atlassian |

---

## 🔮 Roadmap

### ✅ Shipped
- Two-lane pipeline with 7 deterministic gates
- Coverage ledger with explicit, reason-coded exclusions
- LLM-free confidence scoring
- Single-touch sheet write with read-back verification

### 🔜 Next
- Duplicate-gate threshold tuning against a larger corpus
- Coverage-denominator handling for superseded spec sections
- Spec-change detection and surgical TC update on the tc-team engine

---

## 🤖 Built with Claude Code

Every agent definition, orchestration script, rule file, and page of documentation in this project was designed and built using [Claude Code](https://claude.ai/code).
