# Setup Walkthrough

End-to-end setup for a fresh machine. Follow in order. Most of this is automated by one script — `setup.ps1` (Windows) or `setup.sh` (macOS/Linux).

> **Assumption**: [Claude Code](https://claude.com/claude-code) is already installed. If not, install it first — see [PREREQUISITES.md](./PREREQUISITES.md#2-claude-code-cli).

---

## Step 1 — Clone the repo

```bash
git clone https://github.com/nobles92ts-ship-it/AI_GAME_QA_TestCase.git
cd AI_GAME_QA_TestCase
```

---

## Step 2 — (Optional) Place your Google OAuth credentials

> **Skip this step for the default local `.xlsx` output (`/tc-로컬`)** — it needs no Google setup. Required only for the optional Google Sheets output path.

The Google Sheets path reads/writes Google Sheets and uploads spec MDs to Google Drive, so it needs a Google OAuth desktop client:

1. Go to https://console.cloud.google.com/apis/credentials
2. Create an **OAuth 2.0 Client ID** → application type **Desktop app**
3. Download the JSON and save it as **`credentials/client_secret.json`** (this folder is gitignored)
4. In the same Google Cloud project, enable **Google Sheets API** and **Google Drive API**

> No environment variables are required for this — the scripts default to `./credentials/client_secret.json`. To use a different location, see [Optional: `.env` overrides](#optional-env-overrides).

---

## Step 3 — Run the setup script

**Windows (PowerShell):**
```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

> Plain `.\setup.ps1` is blocked on a fresh PC (default execution policy `Restricted`) — the `-ExecutionPolicy Bypass -File` form works everywhere without changing system policy.

**macOS / Linux / Git Bash:**
```bash
bash ./setup.sh
```

The script automatically:
1. Detects your **Node.js** and **Claude Code `cli.js`** paths
2. Resolves all path placeholders (`{NODE_PATH}`, `{CLI_JS}`, `{PROJECT_ROOT}`, `{WORK_ROOT}`, `{CLAUDE_HOME}`, `{CLAUDE_AGENTS_DIR}`, `{CLAUDE_SKILLS_DIR}`) inside the agent / skill / script files
3. Installs **agents** → `~/.claude/agents/` and **skills** → `~/.claude/skills/`
4. Runs `npm install` (installs `googleapis` + `xlsx`)
5. Creates an optional `.env` from `.env.example` (you can leave it untouched)

If Node.js or Claude Code can't be found, the script tells you exactly what to install and stops.

---

## Step 4 — Register MCP servers

The pipeline uses two MCP integrations inside Claude Code:

| MCP | Purpose | How to set up |
|-----|---------|---------------|
| **google-sheets** | Read/write the TC sheet | Install any Google Sheets MCP server and add it to `~/.claude/.mcp.json` — see [`.mcp.json.example`](../.mcp.json.example) |
| **Atlassian / Confluence** | Read spec pages | Easiest path is Claude Code's **built-in Atlassian connector** (no `.mcp.json` entry needed). A community `mcp-atlassian` server also works. |

```bash
# Verify what Claude Code currently has registered:
claude mcp list
```

> Confluence is only needed if you feed the pipeline Confluence URLs. PDF / Word / Excel specs need **no** MCP server — Claude Code reads those files directly. The **google-sheets** MCP is likewise only for the Google Sheets output path — the local `.xlsx` flow needs neither.

---

## Step 5 — (Optional) First-run OAuth authorization

> Google Sheets output path only — skip for the local `.xlsx` flow.

Run the auth helper once to generate `credentials/oauth_token.json`:

```bash
npm run auth
# equivalent to: node scripts/util/google_auth.js
```

A browser window opens. Log in to Google and authorize the app. The token is cached automatically; you won't be prompted again unless it expires.

---

## Step 6 — Run the pipeline

Open Claude Code in the repo. **Easiest — local Excel output, no Google needed:**

```
/tc-로컬 <feature-name> <spec-file>
```

…produces a local **`.xlsx`** file. Or, for **Google Sheets output** (Steps 2 & 5 required), use the slash command or the natural-language trigger (the older `/tc-v2` / `TC 팀 v2로 진행` still work):

```
/tc-team <google-sheets-url> <spec-source-1> [<spec-source-2> ...]
```
or simply:
```
tc-team으로 진행
Spreadsheet: https://docs.google.com/spreadsheets/d/<ID>/edit
Confluence: https://your-site.atlassian.net/wiki/spaces/PROJECT/pages/111
```

**A spec source can be any of**:

| Type | How it's read |
|------|---------------|
| Confluence URL (`atlassian.net/wiki/...`) | Atlassian MCP / built-in connector |
| PDF (`*.pdf`) | Claude Code reads it natively |
| Word (`*.doc`, `*.docx`) | Claude Code reads it natively |
| Excel (`*.xlsx`, `*.xls`) | parsed by the `xlsx` Node module |

You can mix multiple types in one batch run — each feature gets its own isolated run with independent checkpoint state.

```bash
# Confluence
/tc-team https://docs.google.com/spreadsheets/d/ABC.../edit https://your.atlassian.net/wiki/spaces/PROJECT/pages/111

# PDF
/tc-team https://docs.google.com/spreadsheets/d/ABC.../edit C:/specs/my_feature.pdf

# Mixed batch (quote paths that contain spaces)
/tc-team https://docs.google.com/spreadsheets/d/ABC.../edit \
       https://your.atlassian.net/wiki/.../pages/111 \
       C:/specs/feature2.pdf \
       "C:/my docs/feature3.docx"
```

**Notes**:
- Prefer absolute paths — relative paths resolve from Claude Code's working directory.
- If a file doesn't exist, the pipeline skips that item and logs a warning.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full pipeline flow.

---

## Optional: `.env` overrides

The pipeline works without a `.env` file. It exists only to override defaults, and the keys are read straight from the **process environment** (there is no auto-`.env` loader by design), so export them in the shell that runs the pipeline if you need non-default values:

| Variable | Default | When to set |
|----------|---------|-------------|
| `GOOGLE_OAUTH_PATH` | `./credentials/client_secret.json` | Credentials stored elsewhere |
| `GOOGLE_TOKEN_PATH` | `./credentials/oauth_token.json` | Token cached elsewhere |
| `SPREADSHEET_ID` | (passed as CLI arg) | A default sheet for `npm run dashboard` |
| `SLACK_BOT_TOKEN` | (disabled) | Enable Slack QA notifications |
| `SLACK_CHANNEL_ID` | (disabled) | Channel for the pipeline-kickoff notice |

### Optional: Slack kickoff notice

When the pipeline starts, it can post a "TC 생성 요청 접수" notice to **any Slack channel you choose** — useful when several people share one TC sheet and want to see who kicked off which feature. To enable it (one-time, per machine):

1. In your Slack workspace, create a bot: https://api.slack.com/apps → **Create New App** → *OAuth & Permissions* → add the `chat:write` bot scope → **Install to Workspace** → copy the **Bot User OAuth Token** (`xoxb-…`)
2. Pick the channel to notify, **invite the bot** to it (`/invite @your-bot`), then copy the **channel ID** (channel name → *About* tab → bottom, `C0…`)
3. Copy `scripts/util/slack_config.json.example` → `scripts/util/slack_config.json` (this file is **gitignored** — the token never reaches the repo) and fill in both values

Environment variables `SLACK_BOT_TOKEN` + `SLACK_CHANNEL_ID` work as an alternative. If unset, the notice is simply skipped with a hint in `chain.log` and the pipeline continues normally.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `node: command not found` | Install Node.js 20 LTS, then re-run the setup script. |
| `client_secret.json not found` | Complete Step 2. |
| Placeholder `{WORK_ROOT}` still visible in an installed file | Re-run `setup.ps1` / `setup.sh` — it resolves tokens in place. |
| `/tc-team` not recognized in Claude Code | Confirm `commands/tc-team.md` was copied to `$CLAUDE_HOME/commands/` (re-run setup). |
| Confluence page can't be read | Register the Atlassian connector (Step 4), or feed the spec as a PDF/Word/Excel file instead. |
| Slack "TC 생성 요청 접수" kickoff notice never appears | Expected until you enable it — the bot token is gitignored, so a freshly cloned repo has none. Set it up via [Optional: Slack kickoff notice](#optional-slack-kickoff-notice). When skipped, a hint is logged to `chain.log` and the pipeline continues normally. |
