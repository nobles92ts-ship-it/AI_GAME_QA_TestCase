# Prerequisites

The TC Team v2 pipeline coordinates Claude Code, Node.js, and (optionally) Google APIs and Confluence. This document lists every dependency, why it's needed, and how to install it.

> **Default output is a local Excel (`.xlsx`) file** via `/tc-로컬` — no Google account or OAuth setup needed. The Google section below is **only for the optional Google Sheets output path**.

Assume the target machine has **only Claude Code** installed. The setup script (`setup.ps1` on Windows, `setup.sh` on macOS/Linux) automates the rest — agent/skill installation, path resolution, and `npm install`.

---

## Required

### 1. Node.js 20 LTS

**Why**: Every utility script under `scripts/util/` is Node.js — Google Sheets read/write, dashboard updater, OAuth helper, and Excel parsing.

**Install**:
- Windows: `winget install OpenJS.NodeJS.LTS`
- macOS: `brew install node@20`
- Linux: your distro package manager, or `nvm install 20`

**Verify**: `node --version` → `v20.x.x`

The setup script auto-detects the `node` path. npm dependencies (`googleapis`, `xlsx`) are installed for you when you run it.

---

### 2. Claude Code CLI

**Why**: The `tc-팀-v2` orchestrator spawns each sub-agent as a separate `claude` CLI process in its own child shell, keeping each worker's context isolated.

**Install**: Follow the [Claude Code installation guide](https://claude.com/claude-code).

**Verify**: `claude --version`

The setup script auto-detects `cli.js` via `npm root -g`. If it can't be found, the script tells you and leaves a clearly-marked placeholder to fill in.

---

## Optional

### Google OAuth credentials (only for Google Sheets output)

**Why**: Only if you want output as a **Google Sheet** instead of the default local `.xlsx`. The pipeline then reads from and writes to Google Sheets for test-case tracking, and uploads MD spec files to Google Drive. **The local `.xlsx` flow (`/tc-로컬`) needs none of this.**

**Obtain**:
1. Go to https://console.cloud.google.com/apis/credentials
2. Create an OAuth 2.0 Client ID (application type: **Desktop app**)
3. Download the JSON and save it as `credentials/client_secret.json` (the folder is gitignored)
4. Enable **Google Sheets API** and **Google Drive API** in the same project

On first authorization (`npm run auth`), a browser window opens to authorize the app; a token (`credentials/oauth_token.json`) is then cached automatically.

> The scripts default to `./credentials/client_secret.json` and `./credentials/oauth_token.json`, so **no environment variable is required** if you use those paths.

### Python 3.10+ (only for Confluence image download during spec analysis)

**Why**: `scripts/util/confluence_image_downloader.py` — used by STEP 1 spec analysis to download Confluence-embedded images — needs Python. It uses the **standard library only** — there is no `pip install` step and no `requirements.txt`. (The optional `/tc-이미지매칭` command itself uses MCP calls, not Python.)

**Install**: Windows `winget install Python.Python.3.11` · macOS `brew install python@3.11` · Linux `apt-get install python3`

The core pipeline does **not** require Python.

### GitHub CLI (`gh`)

**Why**: Only if you'll use the `github-repo` skill to publish this repo back to GitHub. Not needed to run the pipeline.

**Install**: Windows `winget install GitHub.cli` · macOS `brew install gh` · Linux see https://cli.github.com/

---

## Input formats — no extra parsers needed

The pipeline accepts four spec-source types, and only one needs an npm package:

| Spec source | How it's read | Dependency |
|-------------|---------------|------------|
| Confluence URL | Atlassian MCP / built-in connector | MCP (below) |
| PDF (`.pdf`) | Claude Code reads it natively | none |
| Word (`.doc`, `.docx`) | Claude Code reads it natively | none |
| Excel (`.xlsx`, `.xls`) | parsed with the `xlsx` Node module | `xlsx` (installed by setup) |

There is **no** `pdf-parse` / `pdfjs-dist` / `mammoth` dependency — PDF and Word are handled by Claude Code's native file reading.

---

## MCP Servers

The pipeline uses these MCP integrations inside Claude Code:

| MCP Server | Purpose | How to register |
|------------|---------|-----------------|
| `google-sheets` | Sheets API wrapper used by the agents | Install a Google Sheets MCP server of your choice and add it to `~/.claude/.mcp.json` (template: [`.mcp.json.example`](../.mcp.json.example)) |
| Atlassian / Confluence | Spec-page fetch | Recommended: Claude Code's **built-in Atlassian connector** (no `.mcp.json` entry). A community `mcp-atlassian` server also works. |

```bash
claude mcp list   # see what's currently registered
```

> Confluence access is only needed for Confluence-URL specs. If you only feed PDF/Word/Excel files, you can skip the Atlassian setup entirely.

---

## Environment variables (all optional)

The pipeline runs without a `.env` file. The keys below are read straight from the **process environment** (no auto-`.env` loader by design) and exist only to override defaults — export them in the shell that runs the pipeline if needed:

| Variable | Default | Purpose |
|----------|---------|---------|
| `GOOGLE_OAUTH_PATH` | `./credentials/client_secret.json` | OAuth client secret location |
| `GOOGLE_TOKEN_PATH` | `./credentials/oauth_token.json` | Cached token location |
| `SPREADSHEET_ID` | passed as CLI arg | Default sheet for `npm run dashboard` |
| `SLACK_BOT_TOKEN` | disabled | Enable optional Slack QA notifications |
| `SLACK_CHANNEL_ID` | disabled | Channel for the pipeline-kickoff notice (or use `scripts/util/slack_config.json` — see `slack_config.json.example`) |

See [`.env.example`](../.env.example) for the annotated template.

---

## Verification

After setup, open Claude Code in the repo and run:
```
/tc-로컬
```
If the slash command is recognized (and `~/.claude/agents/tc-팀-v2.md` exists), the integration is complete. (`/tc-v2` — the Google Sheets path — should likewise be recognized.) See [SETUP.md](./SETUP.md) for the full first-run walkthrough.
