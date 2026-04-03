# Game QA Testcase — TC Team v2

<a href="https://claude.ai/code">
  <img src="https://img.shields.io/badge/Built%20with-Claude%20Code-7C3AED?style=for-the-badge&logo=anthropic&logoColor=white" alt="Built with Claude Code">
</a>
<a href="https://github.com/nobles92ts-ship-it/AI_GAME_QA_TestCase">
  <img src="https://img.shields.io/badge/GitHub-AI__GAME__QA__TestCase-181717?style=for-the-badge&logo=github&logoColor=white" alt="GitHub">
</a>
<a href="LICENSE">
  <img src="https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge" alt="MIT License">
</a>

An AI-powered Test Case automation pipeline **built entirely with [Claude Code](https://claude.ai/code)**.  
Reads spec documents from Confluence and automatically generates, reviews, and fixes structured Test Cases in Google Sheets — with multi-round QA review built in.

---

## What It Does

```
Confluence Spec  ──►  Design  ──►  Write TC  ──►  Review × 3  ──►  Google Sheets
```

| Stage | Agent | What happens |
|-------|-------|-------------|
| Design | tc-designer-v2 | Analyzes spec, produces structured analysis + TC design |
| Design Review | tc-설계검수-v2 | Validates design quality |
| Write | tc-writer-v2 | Writes TC rows directly into Google Sheets |
| Review 1 | qa-reviewer-v2 | Structural review |
| Fix 1 | tc-fixer-v2 | Applies fixes |
| Review 2 | qa-reviewer-v2 | Quality review |
| Fix 2 | tc-fixer-v2 | Applies fixes |
| Review 3 | qa-reviewer-v2 | Final review |
| Fix 3 _(if needed)_ | tc-fixer-v2 | Conditional final fix |
| Quick Verify _(if needed)_ | qa-reviewer-v2 | Lightweight post-fix check |

---

## Prerequisites

| Tool | Purpose |
|------|---------|
| [Claude Code](https://claude.ai/code) | AI agent runtime — required |
| [Node.js](https://nodejs.org) v18+ | Scripts for Google Sheets integration |
| Google Cloud OAuth credentials | Read/write access to Google Sheets & Drive |
| Atlassian account | Read access to Confluence spec pages |

---

## Quick Setup

### 1. Clone

```bash
git clone https://github.com/nobles92ts-ship-it/AI_GAME_QA_TestCase.git
cd AI_GAME_QA_TestCase
```

### 2. Run the setup script

**Windows (PowerShell):**
```powershell
.\setup.ps1
```

**Mac / Linux:**
```bash
chmod +x setup.sh && ./setup.sh
```

The script automatically:
- Detects your Node.js and Claude Code CLI paths
- Copies agent files to `~/.claude/agents/` and replaces path placeholders
- Copies skill files to `~/.claude/skills/`
- Creates `pipeline_config.json` and `.env` from templates
- Runs `npm install`

### 3. Configure credentials

**Google Sheets (MCP)** — add to `~/.claude/.mcp.json`:

```json
{
  "mcpServers": {
    "google-sheets": {
      "command": "node",
      "args": ["PATH/mcp-google-sheets/dist/index.js"],
      "env": {
        "GOOGLE_SHEETS_CLIENT_ID": "YOUR_CLIENT_ID",
        "GOOGLE_SHEETS_CLIENT_SECRET": "YOUR_CLIENT_SECRET",
        "TOKEN_PATH": "PATH/.mcp-google-sheets-token.json"
      }
    }
  }
}
```

> See [`.mcp.json.example`](.mcp.json.example) for the full template including Atlassian MCP.

**Google OAuth (for scripts):**
1. Go to [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials
2. Create an OAuth 2.0 Client ID (Desktop app)
3. Download the JSON → save as `credentials/client_secret.json`
4. Run `npm run auth` to complete authentication

**Atlassian (Confluence):**
1. Go to `https://id.atlassian.com/manage-profile/security/api-tokens`
2. Create an API token
3. Add to `~/.claude/.mcp.json` (see `.mcp.json.example`)

### 4. Fill in remaining config

Edit `.env`:
```env
MASTER_SPREADSHEET_ID=your_google_sheet_id
TC_DRIVE_FOLDER_ID=your_drive_folder_id
SPEC_DRIVE_FOLDER_ID=your_spec_folder_id
WORK_ROOT=/absolute/path/to/this/repo
```

Edit `pipeline_config.json` — set your Drive folder IDs and Confluence site:
```json
{
  "drive": {
    "specsFolderId": "YOUR_SPECS_FOLDER_ID",
    "tcFolderId": "YOUR_TC_FOLDER_ID"
  },
  "confluence": {
    "site": "your-site.atlassian.net"
  }
}
```

---

## Usage

Open Claude Code and type:

```
TC 팀 v2로 진행
Spreadsheet: https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit
Confluence: https://your-site.atlassian.net/wiki/spaces/.../pages/...
```

The TC Team orchestrator picks it up and runs the full pipeline automatically.

### TC Update (when spec changes)

```
기획 변경됐어
Confluence: https://...updated-page...
```

The `tc-updater-v2` agent diffs the old spec against the new one and updates only the affected TCs.

---

## Repository Structure

```
AI_GAME_QA_TestCase/
├── agents/                 # Claude agent definitions (install to ~/.claude/agents/)
│   ├── tc-팀-v2.md        # Orchestrator — runs the full pipeline
│   ├── tc-designer-v2.md  # Spec analysis + TC design
│   ├── tc-writer-v2.md    # Writes TCs to Google Sheets
│   ├── qa-reviewer-v2.md  # Multi-round QA review
│   ├── tc-fixer-v2.md     # Applies review fixes
│   ├── tc-updater-v2.md   # Updates TCs when spec changes
│   └── tc-설계검수-v2.md  # Design quality inspection
│
├── skills/                 # Knowledge modules (install to ~/.claude/skills/)
│   ├── tc-설계/           # TC design rules
│   ├── tc-생성/           # TC writing format & spec
│   ├── tc-리뷰/           # Review criteria
│   ├── tc-수정/           # Fix rules
│   ├── tc-갱신/           # Update rules
│   └── tc-설계검수/       # Design inspection rules
│
├── scripts/util/           # Google Sheets integration scripts
│   ├── google_auth.js      # OAuth authentication
│   ├── create_gsheet_tc.js # Write TC rows to sheet
│   ├── update_dashboard.js # Dashboard refresh
│   └── v2/                 # Pipeline state & timing infrastructure
│
├── .env.example            # Environment variable template
├── .mcp.json.example       # MCP server config template
├── pipeline_config.json.template  # Pipeline path config template
├── setup.sh                # Setup script (Mac/Linux)
└── setup.ps1               # Setup script (Windows)
```

---

## Built with Claude Code

This entire project was designed, built, and iterated using **[Claude Code](https://claude.ai/code)** — Anthropic's agentic coding tool.

- The multi-agent pipeline architecture was conceived and refined through Claude Code
- All agent definition files were authored with Claude Code
- Scripts, skill modules, and orchestration logic were written with Claude Code assistance
- Even the review criteria and QA rules were developed iteratively inside Claude Code sessions

Claude Code makes it possible to build sophisticated multi-agent workflows like this one — where AI agents design, write, review, and fix test cases in a fully automated pipeline, end to end.

> Want to build something similar? Start at [claude.ai/code](https://claude.ai/code).

---

## License

MIT License
