# Game QA Testcase — TC Team v2

[![GitHub](https://img.shields.io/badge/GitHub-AI__GAME__QA__TestCase-181717?style=for-the-badge&logo=github)](https://github.com/nobles92ts-ship-it/AI_GAME_QA_TestCase)

An AI-powered Test Case automation pipeline built on Claude Code.  
Analyzes spec documents (Confluence) and automatically generates, reviews, and fixes TCs in Google Sheets.

## Installation

### 1. Clone the repo

```bash
git clone https://github.com/nobles92ts-ship-it/Game_QA_Testcase.git
cd Game_QA_Testcase
```

### 2. Configure pipeline_config.json

```bash
cp pipeline_config.json.template pipeline_config.json
```

Open `pipeline_config.json` and update the paths for your environment:

```json
{
  "paths": {
    "nodejs": "C:/YOUR_PATH/node.exe",
    "projectRoot": "C:/YOUR_PATH/Game_QA_Testcase"
  }
}
```

### 3. Install agents and skills

```bash
# Copy agents to Claude agents folder
cp agents/*.md ~/.claude/agents/

# Copy skills to Claude skills folder
cp -r skills/* ~/.claude/skills/
```

### 4. Update placeholders in agent files

Replace the placeholders in each `.md` file inside `agents/` with your actual paths:

| Placeholder | Example |
|---|---|
| `{PROJECT_ROOT}` | `C:/Users/YourName/Game_QA_Testcase` |
| `{NODE_PATH}` | `C:/Program Files/nodejs/node.exe` |
| `{CLAUDE_SKILLS_DIR}` | `C:/Users/YourName/.claude/skills` |
| `{CLAUDE_AGENTS_DIR}` | `C:/Users/YourName/.claude/agents` |
| `{CLI_JS}` | Path to Claude Code CLI |

### 5. Authentication setup

- **Google Sheets**: Add your Google OAuth credentials to `~/.claude/.mcp.json`
- **Jira/Confluence**: Create `scripts/util/jira_config.json` (refer to the template)

## Usage

In Claude Code:

```
Start with TC Team v2
Spreadsheet: https://docs.google.com/spreadsheets/d/...
Confluence: https://your-site.atlassian.net/wiki/spaces/.../pages/...
```

## Pipeline

```
Design → Design Review → Write TC → Review 1 → Fix 1 → Review 2 → Fix 2 → Review 3 → (Fix 3) → (Quick Verify)
```

## Repository Structure

```
agents/       # Claude agent files (tc-team-v2 and 6 others)
skills/       # Design / Write / Review / Fix / Update / Inspect skills
scripts/util/ # Google Sheets integration scripts
```
