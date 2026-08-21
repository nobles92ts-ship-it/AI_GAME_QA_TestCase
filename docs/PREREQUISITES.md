# Prerequisites

The tc-team pipeline coordinates multiple tools. This document lists every dependency, why it is needed, and how to install it.

Assume the target machine has **only Claude Code** installed. The setup script (`setup.sh` / `setup.ps1`) automates most of the checks below.

---

## Required

### 1. Node.js 20 LTS

**Why**: All utility scripts under `scripts/util/` are Node.js, including Google Sheets R/W, dashboard updater, and OAuth helper.

**Install**:
- Windows: `winget install OpenJS.NodeJS.LTS`
- macOS: `brew install node@20`
- Linux: use your distro package manager or nvm

**Verify**: `node --version` → `v20.x.x`

---

### 2. Python 3.10+ (optional)

**Why**: Only needed if you use analysis utility scripts. Not required for the core pipeline.

**Install**:
- Windows: `winget install Python.Python.3.11`
- macOS: `brew install python@3.11`
- Linux: `sudo apt-get install python3 python3-pip`

**Verify**: `python --version` → `Python 3.10+`

---

### 3. Google OAuth credentials

**Why**: The pipeline reads from and writes to Google Sheets for test case tracking, and uploads MD spec files to Google Drive.

**Obtain**:
1. Go to https://console.cloud.google.com/apis/credentials
2. Create an OAuth 2.0 Client ID (application type: **Desktop app**)
3. Download the JSON file
4. Save it as `credentials/client_secret.json` in this repo (the folder is gitignored)
5. Enable the following APIs in your project:
   - Google Sheets API
   - Google Drive API

On first pipeline run, a browser window will open for you to authorize the app. A token (`oauth_token.json`) will be saved automatically.

---

### 4. Claude Code CLI

**Why**: The S1 design chain spawns the `tc-team-*` agents as separate `claude` CLI processes, so each gets an isolated context window.

**Install**: Follow the [Claude Code installation guide](https://claude.com/claude-code).

**Verify**: `claude --version`

**Note**: The agents are spawned through the `claude` executable on your `PATH` — no interpreter path has to be configured.

### 5. Workflow tool (multi-agent orchestration) — required for S3·S4

**Why**: Stages S3 (sentence fan-out) and S4 (adversarial review) are executed as `Workflow({scriptPath: "tc-team/workflows/..."})` calls from the driving Claude Code session. Without the Workflow tool, the pipeline runs cleanly through S0–S2 and then **stops at S3** — this is the single most common "why did it halt" for new installs.

**Verify**: In your Claude Code session, confirm the `Workflow` tool is available (multi-agent orchestration enabled). If your environment gates it behind an opt-in, enable it before the first run.

**If unavailable**: there is no shipped fallback — S3/S4 fan-out is Workflow-only in this release. The deterministic stages (S0, S2, S5–S7) and the S1 design chain still work, but you will not get a finished sheet.

---

## Optional

### GitHub CLI (`gh`)

**Why**: Only needed if you will use the `github-repo` skill to publish this repo back to GitHub. Not required for running the pipeline itself.

**Install**:
- Windows: `winget install GitHub.cli`
- macOS: `brew install gh`
- Linux: see https://cli.github.com/

---

## MCP Servers

The pipeline uses these MCP servers inside Claude Code. After running setup, register them manually:

| MCP Server | Purpose | How to register |
|------------|---------|-----------------|
| `google-sheets` | Sheets API wrapper | Install a Google Sheets MCP server of your choice and register with `claude mcp add` |
| `claude_ai_Atlassian` | Confluence page fetch | Usually configured globally in Claude Code settings |
| `context-mode` (optional) | Knowledge-index lookup (`ctx_search`) for the cross-reference step | Only needed if you set `crossref_brain: "on"` in `team/tc_config.json` — see below |

See the Claude Code docs for `claude mcp add` syntax.

### Cross-reference ("brain") — optional, off by default

The S1 chain can cross-check ambiguous spec items against a **knowledge index of your own design docs** (we call it the "brain"). This is controlled by `team/tc_config.json` (copy from [`team/tc_config.json.example`](../team/tc_config.json.example)):

- `crossref_brain: "off"` (default) — the step is skipped entirely; pipeline behavior is 100% identical. **Safe for every environment.**
- `crossref_brain: "on"` — requires the `context-mode` MCP server plus an index of your project's design wiki, with its name in `crossref_source`. The index itself is yours to build — nothing project-specific ships in this repo.

#### Why prepare one — and what "prepared" looks like

A spec page almost never defines every value it relies on. Without a brain, those under-specified items become TCs written from assumption — flagged for human confirmation at best. With a brain, each one is looked up in **your** index during S1 and resolved one of four ways:

| Resolution | Meaning |
|---|---|
| `apply` | Your wiki defines it → folded into the design |
| `locate` | The value lives in a data table → location cited on the TC |
| `discover` | The lookup reveals a spec area the design missed entirely → **added to the coverage denominator** |
| `keep` | No evidence → left as-is, flagged for spec confirmation |

**Preparation ladder** — every rung is a usable state:

1. **No index** (default). Pipeline fully works; ambiguous items are simply flagged for humans. Zero setup.
2. **Flat index.** Index your design docs with `context-mode` under one source name, put that name in `crossref_source`, set `crossref_brain: "on"`. Lookups work. One caveat: the anti-circular-citation guard keys off layered section headers, so with a flat index some evidence is conservatively downgraded to `keep`. The built-in fail-safe (no match / error → everything `keep`, non-blocking) means a rough index **degrades quietly — it never breaks the run**.
3. **Layered index.** Structure chunk headers by tier — design wiki vs. past TC output vs. working notes — so the guard can reject past TC output as evidence. This prevents the failure mode where a TC cites an older TC as if it were spec. This is the configuration the pipeline was validated with, and where the feature pays off fully.

One rule of thumb: it must be **your project's** docs. The step tests TCs against the design world they belong to — similarity to anyone else's wiki adds nothing.

---

## Environment variables

After installing everything, create `.env` from `.env.example` and fill in:

| Variable | Required | Example |
|----------|----------|---------|
| `WORK_ROOT` | yes | `C:/Users/You/tc-work` |
| `CLAUDE_HOME` | yes | `C:/Users/You/.claude` |
| `NODE_PATH` | yes | `node` (or full path) |
| `GOOGLE_OAUTH_CLIENT_SECRET_PATH` | yes | `./credentials/client_secret.json` |
| `MASTER_DASHBOARD_ID` | yes | Google Sheets ID |
| `CONFLUENCE_SITE` | yes | `https://yourcompany.atlassian.net` |

Run `setup.sh` / `setup.ps1` again after editing `.env` — it re-copies the agents and skills into your `CLAUDE_HOME` and re-substitutes every placeholder.

---

## Verification

After setup, verify the deterministic core:
```bash
node tc-team/test/run_all.js
```
All 13 suites must report GREEN. If they do, the engine is installed correctly.

Then confirm the skill is registered — `/tc-team` should be offered in Claude Code. If it is not, check that `skills/tc-team/` was copied into `$CLAUDE_HOME/skills/`.

