# Architecture

TC Team v2 is a multi-agent pipeline that turns a Confluence spec page into a fully-reviewed Google Sheets test-case tab, automatically.

---

## Roles

### The orchestrator

`tc-팀-v2` is a hybrid subagent + orchestrator. It is:
- **A subagent**: invoked by main Claude via the Task tool (`agents/tc-팀-v2.md`)
- **An orchestrator**: internally spawns other agents as independent `claude` CLI processes via Bash, so each team member gets its own context window

### The team members (workers)

| Agent | Role |
|-------|------|
| `tc-designer-v2` | Analyzes the spec page, produces an analysis MD + a design MD |
| `tc-설계검수-v2` | Reviews the design MD for completeness and structural issues |
| `tc-writer-v2` | Writes the actual test cases into a new Google Sheets tab |
| `qa-reviewer-v2` | Reviews the generated TCs in three rounds (structure, quality, final) |
| `tc-fixer-v2` | Applies fixes based on reviewer reports |
| `tc-리뷰2수정2-v2` | Combined 2nd review + fix in a single context |
| `tc-updater-v2` | Handles spec changes by diffing old vs new and updating affected TCs |

---

## Pipeline flow

```
Input: spreadsheet URL + Confluence URL(s)
  |
  v
+-------------------------------+
| Initialize / Resume           |  parse URLs, create specs/, load state.json
+-------------------------------+
  |
  v
+===== Main pipeline (STEP 1-7) =====+
| STEP 1: Design           (designer)  |
| STEP 2: Design review    (설계검수)  |
| STEP 3: Design fix       (conditional, max 1x)
| STEP 4: TC writing       (writer)    |  -> new Google Sheets tab
| STEP 5: Review round 1   (structure) |
| STEP 6: Fix round 1      (conditional)
| STEP 7: Review2+Fix2 merged          |
+=======================================+
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

Steps 3 and 6 are conditional — they only run if the preceding review flagged issues.

**STEP numbering caveat**: the pipeline uses STEP 1-7 for the main flow, and the completion skill uses its own STEP 1-3 internally. They do not share a namespace. Pipeline STEP 1 (design) is unrelated to completion STEP 1 (dashboard).

---

## Model routing

All LLM calls go through the Claude Code CLI. The orchestrator selects the model per task:

| Task type | Model | CLI flag |
|-----------|-------|----------|
| Design, review, complex reasoning | Sonnet (default) | `--model sonnet` |
| TC writing, mechanical fixes, bulk analysis | Haiku | `--model haiku` |
| Architectural decisions | Opus | `--model opus` |

Every worker agent is invoked as:
```bash
claude --model <model> --agent <agent-path> -p "<prompt>"
```

No local LLM, Ollama, or MCP proxy is required — all inference is handled by the Anthropic API through Claude Code.

---

## Completion skill and dashboard SSoT

The completion step runs after the main pipeline succeeds. It is its own skill (`.claude/skills/완료처리/완료처리.md`) with three internal steps:

| Internal step | Command | SSoT for rules |
|---------------|---------|----------------|
| 1. Dashboard | `update_dashboard.js $SHEET_ID` | delegates to `.claude/skills/tc-대시보드/TC-Dashboard.md` |
| 2. K/L panel | `add_project_info.js $SHEET_ID $TAB $URL` | self |
| 3. Drive sync | `upload_md_to_drive.js --sync $FEATURE` | self |

The 완료처리 skill handles execution; `tc-대시보드` skill owns the dashboard formula/formatting rules. This split exists so ad-hoc "update the dashboard" requests (handled by `tc-대시보드` as a user-invokable skill) and automatic pipeline completion (handled by 완료처리) share the same rules without duplication.

---

## State and resume

The orchestrator writes a checkpoint file (`state.json` in `WORK_ROOT/team/`) before each step. If the pipeline is interrupted, it checks file existence under `specs/<feature>/` in a defined order to determine which step to resume from. This allows killing and restarting without losing work.

---

## Batch mode

When the user passes multiple Confluence URLs, the orchestrator iterates sequentially: initialize -> pipeline -> completion -> next URL. A batch summary is printed at the end. Failed features do not block successful ones — each URL is independent.
