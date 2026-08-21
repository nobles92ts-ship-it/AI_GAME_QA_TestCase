# Setup Walkthrough

End-to-end setup guide for a fresh machine. Follow in order.

> **Assumption**: Claude Code is already installed. If not, see [PREREQUISITES.md](./PREREQUISITES.md) section 6.

---

## Step 1 — Clone the repo

```bash
git clone https://github.com/nobles92ts-ship-it/AI_GAME_QA_TestCase.git
cd AI_GAME_QA_TestCase
```

---

## Step 2 — Run setup

**macOS / Linux / Git Bash:**
```bash
bash ./setup.sh
```

**Windows (PowerShell):**
```powershell
.\setup.ps1
```

The setup script:
1. Detects Node.js, and stops with instructions if it is missing
2. Copies `agents/` into `$CLAUDE_HOME/agents/` and `skills/` into `$CLAUDE_HOME/skills/`
3. Substitutes `{PROJECT_ROOT}` / `{NODE_PATH}` / `{CLAUDE_HOME}` placeholders — in the installed skills **and** in the repo's `tc-team/` and `scripts/` trees
4. Runs `npm install`
5. Creates `pipeline_config.json` and `.env` from their templates, if they don't already exist

Existing `.env` and `pipeline_config.json` files are never overwritten — the script skips them and says so.

---

## Step 3 — Fill in `.env`

Setup created `.env` from the template. Edit it and provide real values for:

| Variable | What to put |
|----------|-------------|
| `WORK_ROOT` | Absolute path to a runtime data directory. Can be the repo root itself. |
| `CLAUDE_HOME` | Absolute path to your Claude Code user directory (`~/.claude`). |
| `GOOGLE_OAUTH_CLIENT_SECRET_PATH` | Leave as default (`./credentials/client_secret.json`) and place the file there in Step 4. |
| `MASTER_SPREADSHEET_ID` | Google Sheets ID of your master sheet (from the sheet URL). |
| `TC_DRIVE_FOLDER_ID`, `SPEC_DRIVE_FOLDER_ID` | Google Drive folder IDs for output sync (optional). |
| `MASTER_DASHBOARD_ID` | Dashboard sheet ID (optional — leave the placeholder if you don't use the dashboard). |
| `INTEGRATION_TC_ID`, `GAME_QA_ID` | Other dashboard targets (optional). |
| `CONFLUENCE_SITE` | Your Atlassian site, e.g. `https://acme.atlassian.net`. |
| `CONFLUENCE_SITE_HOST` | Host only, e.g. `acme.atlassian.net`. |

No local model, Ollama instance, or third-party API key is required — every model call goes through the Claude Code CLI.

---

## Step 4 — Place OAuth credentials

1. Go to https://console.cloud.google.com/apis/credentials
2. Create an OAuth 2.0 Client ID (Desktop app)
3. Download the JSON → save it as `credentials/client_secret.json`
4. Enable **Google Sheets API** and **Google Drive API** in the same project

---

## Step 5 — Edit `pipeline_config.json`

Setup created this from `pipeline_config.json.template`. Fill in your Drive folder ID and Confluence site. The file is gitignored, so your values stay local.

---

## Step 6 — Register MCP servers

Register a Google Sheets MCP server and an Atlassian MCP server in `~/.claude/.mcp.json`. Use [`.mcp.json.example`](../.mcp.json.example) as the shape, then verify:

```bash
claude mcp list
```

---

## Step 7 — First-run OAuth authorization

Run the auth helper once to generate `oauth_token.json`:

```bash
npm run auth
```

A browser window opens. Log in to Google and authorize the app. The token is written to `credentials/oauth_token.json` automatically.

Then verify the deterministic core before your first run:

```bash
npm test
```

All 13 suites must report GREEN.

---

## Step 8 — Run the pipeline

Open Claude Code and run:

```
/tc-team <spreadsheet-url> <spec-source>
```

**The spreadsheet link and the spec link must be given together.** A spec on its own is rejected — the pipeline asks for the sheet rather than guessing one.

**A spec source can be**:
- Confluence URL (`atlassian.net/wiki/...`)
- PDF file path (`*.pdf`)
- Word file path (`*.doc`, `*.docx`)
- Excel file path (`*.xlsx`, `*.xls`)

Examples:
```bash
# Confluence
/tc-team https://docs.google.com/spreadsheets/d/ABC.../edit https://your.atlassian.net/wiki/spaces/PROJECT/pages/111

# PDF
/tc-team https://docs.google.com/spreadsheets/d/ABC.../edit C:/specs/my_feature.pdf

# Word docx
/tc-team https://docs.google.com/spreadsheets/d/ABC.../edit /home/user/specs/feature.docx
```

### What to expect while it runs

This is a **semi-automatic runbook**, not a fire-and-forget command. Your session drives stages S0–S7 in order, reports as it goes, and **halts on any gate failure** rather than working around it. Budget attention for gate outcomes; the sheet is written exactly once, at S6, after every gate has passed.

**Notes**:
- One feature per run — there is no batch mode.
- Paths with spaces must be quoted.
- Prefer absolute paths — relative paths resolve from Claude Code's working directory.
- If a tab of the same name already exists and is not owned by the pipeline, a `_v2` / `_v3` suffixed tab is created instead. Existing tabs are never overwritten.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the stage flow and gate table.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `node: command not found` | Node.js not on PATH. Use full path in `NODE_PATH`. |
| `client_secret.json not found` | Complete Step 4 above. |
| `Placeholder {...}` appears literally in a rule file | Re-run `setup.sh` / `setup.ps1` — it substitutes placeholders in `skills/`, `tc-team/`, and `scripts/`, not just `agents/`. |
| `/tc-team` not recognized in Claude Code | Confirm `skills/tc-team/` was copied to `$CLAUDE_HOME/skills/`. |
| A gate fails and the run stops | That is the intended behaviour. The gate table in [ARCHITECTURE.md](./ARCHITECTURE.md) lists what each failure means and the recovery step. |
