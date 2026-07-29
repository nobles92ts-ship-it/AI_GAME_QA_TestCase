# Architecture

tc-team turns a spec (Confluence page, PDF, Word, or Excel) into a reviewed Google Sheets test-case tab. Unlike a conventional agent pipeline, **the model is not in charge of correctness** — deterministic code owns every structural decision and every gate.

---

## The two lanes

The central constraint of this design:

| Lane | Owns | Implemented in |
|------|------|----------------|
| **LLM** | Reading the spec, designing coverage, writing each test-case sentence, adversarial review judgments | Claude Code CLI agents |
| **Deterministic code** | Spec slicing, row structure, IDs, column contracts, all gate pass/fail decisions, coverage ledger, duplicate detection, origin verification, sheet write and read-back | `tc-team/lib/`, `tc-team/scripts/` |

No gate consults a model. A run is reproducible in every respect that matters for correctness; only the prose varies.

The practical consequence: a failing gate is a fact, not an opinion. It cannot be argued away by a more confident review pass.

---

## Stage flow (S0 → S7)

Each stage advances **only** on gate pass.

```
Input: spreadsheet URL + spec source
  │
  ▼
┌─ S0  Preparation ─────────────────────────────── main ──┐
│  execution lock · spec fetch (verbatim)                 │
│  self-check: ≥1KB · image count match · no truncation   │
└─────────────────────────────────────────────────────────┘
  │
  ▼
┌─ S1  Design ─────────────────────────────── LLM (Opus) ─┐
│  designer → design inspection → fix → cross-reference   │
│  → analysis.md + tc_design.md                           │
└─────────────────────────────────────────────────────────┘
  │
  ▼
┌─ S2  Isolation gate + slicing ───────────── code ───────┐
│  design_gate  → is the design convertible at all?       │
│  slicer       → spec becomes sections[] + rules[]       │
│                 (rules[] is the coverage ledger anchor) │
└─────────────────────────────────────────────────────────┘
  │
  ▼
┌─ S3  Sentence fan-out ────────── code + LLM + code ─────┐
│  ① deterministic skeleton (N rows)                      │
│  ② LLM writes sentences, 25 rows per chunk, parallel    │
│  ③ deterministic merge — index · echo · hash · count    │
│  content_gate (advisory pass)                           │
└─────────────────────────────────────────────────────────┘
  │
  ▼
┌─ S4  Adversarial review + ledger ── LLM judge, code ────┐
│  dup_gate    → exact + similar duplicate candidates     │
│  origin_gate → rows with no anchor in the source spec   │
│  3 lenses (structure · quality · source) in parallel    │
│  → mutual rebuttal → fix_plan                           │
│  coverage ledger: rules → tc_ids, plus exclusions       │
└─────────────────────────────────────────────────────────┘
  │
  ▼
┌─ S5  Apply + gates ──────────────────────── code ───────┐
│  apply_fix_plan  → before-match, anchor exists, no      │
│                    conflict; otherwise rejected         │
│  regroup · content_gate · dup_gate · traceability       │
│  uncovered rule → add_row sealing loop → re-apply       │
└─────────────────────────────────────────────────────────┘
  │
  ▼
┌─ S6  Live write ─────────── code, ONE sheet touch ──────┐
│  owner-marker based: create / idempotent rewrite /      │
│  _vN suffix if the tab belongs to someone else          │
│  read-back: A–G + J must diff to 0                      │
└─────────────────────────────────────────────────────────┘
  │
  ▼
┌─ S7  Completion ─────────────────────────── code ───────┐
│  confidence scoring · labelling · dashboard · Drive     │
└─────────────────────────────────────────────────────────┘
```

---

## Gates

| Gate | Stage | Fails when | On failure |
|------|:---:|---|---|
| Input self-check | S0 | Spec < 1KB, image count mismatch, truncation | One re-fetch, then refuse to start |
| `design_gate` | S2 | Design cannot be expanded into rows | Return to S1 fix loop |
| merge echo / hash / count | S3 | A chunk shifted or edited rows it did not own | Re-run only that chunk |
| `content_gate` | S3, S5 | Abstract unverifiable phrasing; column whitelist violation | Blocking at S5 — fix and re-run |
| `dup_gate` | S4, S5 | Identical rows survive to the final set | Blocking at S5 — merge or differentiate |
| `origin_gate` | S4 | A row asserts a requirement absent from the spec | Advisory — feeds the review lenses |
| apply before-match | S5 | The target text changed since the plan was made | Rejection is correct — regenerate the plan |
| `traceability` | S5 | A sliced rule has no covering row | `add_row` sealing loop, then re-verify |
| read-back diff | S6 | Written sheet differs from the local final set | Investigate before reporting success |

`origin_gate` is advisory by design: whether an unanchored row is a fabrication or a legitimate inference is a judgment call, so the gate surfaces candidates and the review lenses decide. Blocking there would reject valid rows.

---

## The coverage ledger

`slicer.js` turns the spec into `rules[]`. Every rule must end up either **covered** by at least one row, or **explicitly excluded** with a reason.

Exclusion reasons are a closed set of three exact values — *different spec*, *non-test-case prose*, *duplicate rule*. Free-text reasons fail the gate; evidence prose belongs in a separate `note` field. This exists because a free-text reason field degrades into "seemed fine" and the ledger stops meaning anything.

**"Not yet implemented" is not a valid exclusion.** Such rules must still be expanded into rows, flagged in the status column, with expected/actual marked N/A. Excluding them would hide scope from the QA engineer reading the sheet.

### One trap worth knowing

After the sealing loop inserts rows, the ID column is renumbered — so ledger `tc_ids` go stale. **Do not remap arithmetically.** Join on the full tuple (major category + minor category + verification stage + the full step column). Minor category plus steps alone is not unique: the basic-function section restates sentences from the QA section, and a partial-match search on step text will match the wrong row. When in doubt, regenerate the ledger against the final set.

---

## Confidence scoring — deterministic

`tc-team/scripts/confidence/` scores each row with rules R1–R7 (spec-confirmation flag, image-only reference, unresolved cross-reference, weak anchor, coverage gap, design-technique bonus), reading `tc_design.md`, `dxr_crossref.json`, and `coverage_gaps.json`.

**Zero LLM calls.** Identical input always yields an identical score, so the number is a stable signal about where a reviewer should look — not a second opinion from a model.

---

## State, locking, and resume

- `team/.pipeline.lock` holds the run epoch. A user-triggered run always reclaims the lock; a fresh lock (< 180 min) only produces a warning, since an async trigger path may legitimately overlap. Released on completion **and** on every abort path.
- `state.json` is projected by `state_projection.js` for monitoring and notification consumers.
- S1 skips when `design_hash` matches. Missing `tc_final.ok` is the signal to re-run S5.

---

## Where the rules live

| Path | Contains |
|------|----------|
| `skills/tc-team/SKILL.md` | Stage contracts S0–S7, gate table, invariants |
| `skills/tc-team/rules/` | 9 rule files — analysis, design, inspection, cross-reference, authoring, review, learning, labelling, completion |
| `tc-team/lib/` | 14 deterministic modules |
| `tc-team/workflows/` | S3 fan-out and S4 review workflow scripts |
| `tc-team/docs/` | Driver reference, EVAL digest, guides |
| `scripts/util/` | Shared utilities — deliberately *not* copied into `tc-team/`, to prevent a code fork |

Rule files are read at runtime. Editing one changes the next run; there is no build step and no second copy to keep in sync. The two linters in `scripts/util/` exist to catch the case where a rule edit desynchronises from the code that enforces it — see the README.
