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

## Step 2 — Run preflight

**Windows (PowerShell):**
```powershell
.\scripts\preflight\preflight.ps1
```

**macOS / Linux / Git Bash:**
```bash
bash ./scripts/preflight/preflight.sh
```

Preflight will:
1. Check for Node.js, Python, Ollama, `gh` — offer to install missing ones
2. Pull the Gemma model (default `gemma4:31b`, or pick another)
3. Run `npm install` and `pip install -r requirements.txt`
4. Check for `credentials/client_secret.json`
5. Create `.env` from `.env.example` if missing

On first run, preflight will **stop after creating `.env`** and open it in your editor. Fill in the real values then re-run preflight.

---

## Step 3 — Fill in `.env`

Edit `.env` and provide real values for:

| Variable | What to put |
|----------|-------------|
| `WORK_ROOT` | Absolute path to a runtime data directory (e.g. `C:/Users/You/tc-work`). Can be the repo root itself. |
| `CLAUDE_HOME` | Absolute path to your Claude Code user directory (`~/.claude`). |
| `NODE_PATH` | `node` (if on PATH) or full path to `node.exe`. |
| `CLI_JS` | Absolute path to `claude-code/cli.js`. Find it with `where claude` (Windows) or `which claude` (Unix) and walk up to `cli.js`. |
| `GOOGLE_OAUTH_CLIENT_SECRET_PATH` | Leave as default (`./credentials/client_secret.json`) and place the file there. |
| `MASTER_DASHBOARD_ID` | Google Sheets ID of your master dashboard (from the sheet URL). |
| `INTEGRATION_TC_ID`, `GAME_QA_ID` | Other dashboard targets (optional — leave placeholder if unused). |
| `CONFLUENCE_SITE` | Your Atlassian site, e.g. `https://acme.atlassian.net`. |
| `CONFLUENCE_SITE_HOST` | Host only, e.g. `acme.atlassian.net`. |
| `GEMMA4_MODEL` | Model tag you pulled (e.g. `gemma4:12b`). |

---

## Step 4 — Place OAuth credentials

1. Go to https://console.cloud.google.com/apis/credentials
2. Create OAuth 2.0 Client ID (Desktop app)
3. Download JSON → save as `credentials/client_secret.json`
4. Enable **Google Sheets API** and **Google Drive API** in your project

---

## Step 5 — Re-run preflight

```powershell
.\scripts\preflight\preflight.ps1
```

This time preflight will proceed past the `.env` check and run `install.mjs`, which:
- Substitutes `{{NODE_PATH}}`, `{{WORK_ROOT}}`, `{{CLAUDE_HOME}}`, etc. in all `.claude/**/*.md` files
- Copies the `.claude/` subtree into your `CLAUDE_HOME` (agents, commands, skills, scripts)

---

## Step 6 — Register MCP servers

After preflight, manually register the Gemma4 MCP server:

```bash
claude mcp add gemma4 node $CLAUDE_HOME/scripts/mcp-gemma4.js
```

(Replace `$CLAUDE_HOME` with the actual path from `.env`.)

If you use a Google Sheets MCP server and an Atlassian MCP server, register those as well. Check the list:

```bash
claude mcp list
```

---

## Step 7 — First-run OAuth authorization

Run the auth helper once to generate `oauth_token.json`:

```bash
node scripts/util/google_auth.js
```

A browser window opens. Log in to Google and authorize the app. The token is saved to `credentials/oauth_token.json` automatically.

---

## Step 8 — Start Ollama

Gemma4 needs Ollama running in the background:

```bash
ollama serve
```

On Windows, Ollama typically starts on boot after install — check Task Manager.

---

## Step 9 — Run the pipeline

Open Claude Code and run:

```
/tc-v2 <spreadsheet-url> <spec-source-1> <spec-source-2> ...
```

**Spec sources can be any of**:
- Confluence URL (`atlassian.net/wiki/...`)
- PDF file path (`*.pdf`)
- Word file path (`*.doc`, `*.docx`)
- Excel file path (`*.xlsx`, `*.xls`)

You can mix multiple types in a single batch run.

Examples:
```bash
# Confluence
/tc-v2 https://docs.google.com/spreadsheets/d/ABC.../edit https://your.atlassian.net/wiki/spaces/PROJECT/pages/111

# PDF
/tc-v2 https://docs.google.com/spreadsheets/d/ABC.../edit C:/specs/my_feature.pdf

# Word docx
/tc-v2 https://docs.google.com/spreadsheets/d/ABC.../edit /home/user/specs/feature.docx

# Mixed batch
/tc-v2 https://docs.google.com/spreadsheets/d/ABC.../edit \
       https://your.atlassian.net/wiki/.../pages/111 \
       C:/specs/feature2.pdf \
       "C:/my docs/feature3.docx"
```

**Notes**:
- Paths with spaces must be quoted.
- Prefer absolute paths — relative paths are resolved from Claude Code's working directory.
- If a file doesn't exist, the pipeline skips that item and logs a warning.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full pipeline flow.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `node: command not found` | Node.js not on PATH. Use full path in `NODE_PATH`. |
| `ollama: connection refused` | Start `ollama serve`. |
| `client_secret.json not found` | Complete Step 4 above. |
| `Placeholder {{...}} not substituted` | Re-run preflight after editing `.env`. |
| `claude mcp list` shows no gemma4 | Run Step 6 with correct `CLAUDE_HOME` path. |
| `/tc-v2` not recognized in Claude Code | Confirm `.claude/commands/tc-v2.md` was copied to `$CLAUDE_HOME/commands/`. |
