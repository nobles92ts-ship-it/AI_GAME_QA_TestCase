# Architecture

TC Team turns a game-feature spec (Confluence / PDF / Word / Excel) into a fully reviewed test-case sheet — local Excel or Google Sheets — with near-zero human click-through.

**Two generations live in this repo. Read this table first — it is the honest map of what is what:**

|  | Multi-agent pipeline | Deterministic engine (`tc_v3/`) |
|--|----------------------|--------------------------------|
| **Status** | **Runs today.** The proven, battle-tested path — what `install.ps1` / `setup.ps1` install and what `/tc-v2` · `/tc-로컬` execute end-to-end. | **Library preview.** Every stage is runnable and regression-tested individually; the `/tc-team` skill (`skills/tc-team/`) now drives them from the main session as a semi-automatic preview. The fully-unattended single-command driver that chains them end-to-end is still on the roadmap. |
| **Design** | orchestrator + isolated LLM worker processes | two lanes — LLM owns sentences & judgment, deterministic code owns structure & facts |
| **Where documented** | second half of this page | first half of this page · [`tc_v3/README.md`](../tc_v3/README.md) · [engine guide](../tc_v3/docs/tc-v3-guide.html) |

The engine is the **target architecture**, so it is presented first. The multi-agent pipeline is the **production path today** and is documented in full below it. Both engines run from the same clone and ship side by side: `/tc-v2` runs the proven pipeline end-to-end, while the `/tc-team` skill drives the deterministic engine as a main-session-driven preview.

---

## The deterministic engine — target architecture (`tc_v3/`)

### Two lanes

The engine splits all work into two lanes, with machine gates at every crossing:

| Lane | Owns |
|------|------|
| **LLM lane** — creative segments only, parallel fan-out allowed | design judgment · step sentences · review findings · fix-plan verdicts · semantic rule-to-TC mapping |
| **Deterministic lane** — code-owned, regression-tested | row skeletons · ids, formatting, grouping · patch application · gate checks · ledger math · the single sheet write |

Three principles:

1. **Code owns structure.** The LLM never creates rows. Row skeletons come from a deterministic convert of the design document; the LLM only fills in each row's natural-language step text.
2. **Don't trust and verify — just verify.** Every LLM output is machine-checked: echo of its own row positions, design hashes, precondition matching. Even the judge's fix instructions are applied only if the recorded "before" value matches the actual cell.
3. **Review is adversarial.** Independent lenses hunt for flaws in parallel; a judge cross-examines them so only real fixes survive — structurally blocking the single-reviewer trap of being lenient toward one's own output.

### Stage sequence (S1–S6)

| Stage | Lane / model | What happens |
|-------|--------------|--------------|
| **S1 · Design** | LLM — Opus, exactly once | spec source → analysis + design docs; an identical design hash on re-run skips the stage |
| **S2 · Gate + Slice** | deterministic | design gate (convert dry-run on an isolated copy) · slicer decomposes the source into sections + rules — the anchors the coverage ledger is built on |
| **S3 · Sentence fan-out** | LLM — Sonnet, parallel | code converts the design into a row skeleton; sentence agents fill in **only the step-sentence column**, 25-row chunks in parallel; merge blocks mechanically on any echo / hash / count mismatch |
| **S4 · Adversarial review** | LLM — Sonnet | 3 independent lenses (structure / quality / source-check) run in parallel → a judge cross-examines, drops false positives, and emits fix-plan patches + the coverage ledger |
| **S5 · Apply + Gates** | deterministic | patches applied only when the recorded before-value matches the actual cell (add-rows must anchor to an existing row); regroup restores category contiguity; content gate |
| **S6 · Live write + Finalize** | deterministic | the **single** sheet contact — owner-marker check, idempotent create or clear-and-rewrite, read-back QA (what was written == what is there), then housekeeping (dashboard, panel, sync) |

**The sheet is written exactly once**, at S6, and only after every gate passes. A failed gate re-runs only the failing chunk (S3) or triggers a second fix-plan round (S4).

### Deterministic gates

Four gate families — all machine-enforced, all blocking:

| Gate family | Enforced at | Blocks on |
|-------------|-------------|-----------|
| **convert** | S2 (dry-run) and the skeleton build | a design document that cannot be deterministically expanded into rows |
| **merge** | S3 | row echo mismatch · design-hash mismatch · row-count mismatch — one shifted row stops the merge |
| **content** | S5 | abstract phrasing · unflagged deferral phrasing (two-tier: block / warn) |
| **ledger** | S4/S5 | any source rule that is neither covered nor justifiably excluded · ghost TC ids |

New content rules are born as warnings and promoted to blocking after field data — a false positive that halts the pipeline is also a cost. The full layered gate catalog is in the [engine guide](../tc_v3/docs/tc-v3-guide.html).

### Model routing (engine)

| Route | Used for |
|-------|----------|
| **Opus — exactly once** | S1 design judgment |
| **Sonnet — parallel fan-out** | S3 step sentences · S4 review lenses + judge |
| **No LLM — deterministic code** | structure, gates, ledger math, patch application, the sheet write |

All LLM calls go through the Claude Code CLI — no external API keys or model servers.

### Coverage ledger

A single coverage percentage tells two lies: it misreads rewording as loss, and it hides *which* rule is missing. The engine keeps a **ledger** instead: every rule the slicer extracts from the source must end the run as **covered** (mapped to concrete TC ids), **justifiably excluded** (only four reasons allowed: deferred · other-document · non-testable · duplicate), or a **gate FAIL** that names the rule. Caveat, stated honestly: the semantic rule-to-TC mapping is itself LLM output — which is why the A/B adjudication re-verified the ledger's claims against the artifact files.

### Artifacts and replay

Every intermediate artifact is a file in a per-feature work directory — slices, skeleton, sentence map, merged data, fix plans, ledger files, gate-passed final, owner marker, applied-patch audit trail. **Any stage can be replayed and audited** from its files. The engine's regression tests run with no setup: `node tc_v3/test/run_all.js`.

### Measured results

Cold-run A/B against the multi-agent pipeline (same source spec, both from cold, **n=1**): **2.2× faster wall-clock** (158.8 → 73.0 min), **−64%** on pipeline-specific segments, **0 invented numerics** in the final output (vs 2), and **100% of source rules explained** by the ledger. Treat this as a validated case study, not a benchmark suite — full table and honesty notes in [`tc_v3/README.md`](../tc_v3/README.md).

### Current status — honest scope

- **What exists**: the S1–S6 stage libraries (`tc_v3/lib/`), their gates, the ledger, and the tests. Each stage is individually runnable from the CLI; the conceptual sequence is documented in the engine README.
- **What does not exist yet**: a single driver executable that chains S1–S6 (+ finalize) with kickoff, state ledger, and per-stage timing built in. That is the top roadmap item.
- **Until then**: the multi-agent pipeline below is the supported way to run TC generation end-to-end.

---

## The multi-agent pipeline — what runs today

The production execution path: a multi-agent pipeline that turns a spec source into a fully-reviewed test-case tab, automatically.

### Roles

#### The orchestrator

`tc-팀-v2` is a hybrid subagent + orchestrator. It is:
- **A subagent**: invoked by main Claude via the Task tool (`agents/tc-팀-v2.md`)
- **An orchestrator**: internally spawns other agents as independent `claude` CLI processes via Bash, so each team member gets its own context window

#### The team members (workers)

| Agent | Role |
|-------|------|
| `tc-designer-v2` | Analyzes the spec page, produces an analysis MD + a design MD |
| `tc-설계검수-v2` | Reviews the design MD for completeness and structural issues |
| `tc-writer-v2` | Writes the actual test cases into a new Google Sheets tab |
| `tc-리뷰1수정1-v2` | STEP 5 — structural review **and** fix applied in one context (round 1) |
| `tc-리뷰2수정2-v2` | STEP 6 — quality review **and** fix applied in one context (round 2) |
| `qa-reviewer-v2`, `tc-fixer-v2` | Legacy split review/fix agents — kept for rollback, **not** called by the active pipeline |
| `tc-updater-v2` | Handles spec changes by diffing old vs new and updating affected TCs |

---

### Pipeline flow

```
Input: spreadsheet URL + Confluence URL(s)
  |
  v
+-------------------------------+
| Initialize / Resume           |  parse URLs, create specs/, load state.json
+-------------------------------+
  |
  v
+===== Main pipeline (STEP 1-6) =====+
| STEP 1: Analysis + Design (designer, Opus)    |
| STEP 2: Design review     (설계검수)          |
| STEP 3: Design fix        (conditional, max 1x)
| STEP 4: TC writing        (writer)    |  -> new Google Sheets tab
| STEP 5: Review1 + Fix1 merged (리뷰1수정1)    |
| STEP 6: Review2 + Fix2 merged (리뷰2수정2)    |
+================================================+
  |
  v
+-------------------------------+
| Completion skill              |  SSoT: .claude/skills/완료처리/완료처리.md
|   STEP 1: Dashboard update    |  -> delegates rules to .claude/skills/tc-대시보드/
|   STEP 2: K/L project info    |  add_project_info.js
|   STEP 3: Drive sync          |  upload_md_to_drive.js
+-------------------------------+
  |
  v
Final user report
```

STEP 3 is conditional — it only runs if STEP 2 flagged design issues. STEP 5 and STEP 6 always run; each performs its review **and** applies the resulting fixes within the same context (the round-1 and round-2 review/fix passes were merged in Phase 2-B).

**STEP numbering caveat**: the pipeline uses STEP 1-6 for the main flow, and the completion skill uses its own STEP 1-3 internally. They do not share a namespace. Pipeline STEP 1 (design) is unrelated to completion STEP 1 (dashboard).

---

### Model routing (pipeline)

All LLM calls go through the Claude Code CLI. The orchestrator selects the model per task:

| Task type | Model | CLI flag |
|-----------|-------|----------|
| Spec analysis & TC design (STEP 1) | Opus | `--model opus --effort medium` |
| Everything else (STEP 2-6: review, writing, fix) | Sonnet | `--model sonnet` |

Every worker agent is invoked through the `run-agent.sh` wrapper, which resolves to:
```bash
claude --model <model> --agent <agent-name> -p "<prompt>"
```

No local LLM, Ollama, or external model server is required — all inference is handled by Claude Code itself.

---

### Completion skill and dashboard SSoT

The completion step runs after the main pipeline succeeds. It is its own skill (`.claude/skills/완료처리/완료처리.md`) with three internal steps:

| Internal step | Command | SSoT for rules |
|---------------|---------|----------------|
| 1. Dashboard | `update_dashboard.js $SHEET_ID` | delegates to `.claude/skills/tc-대시보드/TC-Dashboard.md` |
| 2. K/L panel | `add_project_info.js $SHEET_ID $TAB $URL` | self |
| 3. Drive sync | `upload_md_to_drive.js --sync $FEATURE` | self |

The 완료처리 skill handles execution; `tc-대시보드` skill owns the dashboard formula/formatting rules. This split exists so ad-hoc "update the dashboard" requests (handled by `tc-대시보드` as a user-invokable skill) and automatic pipeline completion (handled by 완료처리) share the same rules without duplication.

---

### State and resume

The orchestrator writes a checkpoint file (`state.json` in `WORK_ROOT/team/`) before each step. If the pipeline is interrupted, it checks file existence under `specs/<feature>/` in a defined order to determine which step to resume from. This allows killing and restarting without losing work.

---

### Batch mode

When the user passes multiple Confluence URLs, the orchestrator iterates sequentially: initialize -> pipeline -> completion -> next URL. A batch summary is printed at the end. Failed features do not block successful ones — each URL is independent.
