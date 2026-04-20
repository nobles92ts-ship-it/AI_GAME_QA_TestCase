# Prerequisites

The TC Team v2 pipeline coordinates multiple tools. This document lists every dependency, why it is needed, and how to install it.

Assume the target machine has **only Claude Code** installed. The preflight script (`scripts/preflight/preflight.ps1` or `.sh`) will automate most of the checks below.

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

**Why**: The `tc-팀-v2` agent orchestrates sub-agents by spawning `claude` CLI processes in separate child shells. This keeps each sub-agent's context isolated.

**Install**: Follow the [Claude Code installation guide](https://claude.com/claude-code).

**Verify**: `claude --version`

**Note**: The full path to `cli.js` is required in `.env` as `CLI_JS`. On Windows with npm global install, this is typically:
```
C:/Users/YourName/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/cli.js
```

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

The pipeline uses these MCP servers inside Claude Code. After running preflight, register them manually:

| MCP Server | Purpose | How to register |
|------------|---------|-----------------|
| `google-sheets` | Sheets API wrapper | Install a Google Sheets MCP server of your choice and register with `claude mcp add` |
| `claude_ai_Atlassian` | Confluence page fetch | Usually configured globally in Claude Code settings |

See the Claude Code docs for `claude mcp add` syntax.

---

## Environment variables

After installing everything, create `.env` from `.env.example` and fill in:

| Variable | Required | Example |
|----------|----------|---------|
| `WORK_ROOT` | yes | `C:/Users/You/tc-work` |
| `CLAUDE_HOME` | yes | `C:/Users/You/.claude` |
| `NODE_PATH` | yes | `node` (or full path) |
| `CLI_JS` | yes | `.../claude-code/cli.js` |
| `GOOGLE_OAUTH_CLIENT_SECRET_PATH` | yes | `./credentials/client_secret.json` |
| `MASTER_DASHBOARD_ID` | yes | Google Sheets ID |
| `CONFLUENCE_SITE` | yes | `https://yourcompany.atlassian.net` |

Run `preflight.ps1` / `preflight.sh` again after editing `.env` — it will substitute placeholders in the `.claude/` files and copy them to your `CLAUDE_HOME`.

---

## Verification

After preflight, run:
```bash
claude /tc-v2 --help
```
If the slash command is recognized, the integration is complete.

