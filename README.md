# AI_GAME_QA_TestCase — TC Team v2

<a href="https://claude.ai/code">
  <img src="https://img.shields.io/badge/Built%20with-Claude%20Code-7C3AED?style=for-the-badge&logo=anthropic&logoColor=white" height="40">
</a>
&nbsp;
<a href="https://tc-team-v2-landing.vercel.app/">
  <img src="landing-button.svg" height="60" alt="Landing page">
</a>

> **Multi-agent, multi-model game-QA test-case automation pipeline.**
> Drop in a spec (Confluence / PDF / Word / Excel) — get back a fully reviewed **~100-TC test sheet** as a local **Excel (`.xlsx`)** file (no Google needed) — or a Google Sheet if you want one. Fully automated, zero manual click-through.

[![Landing](https://img.shields.io/badge/Landing-tc--team--v2--landing.vercel.app-10B981?style=flat)](https://tc-team-v2-landing.vercel.app/)
[![Docs — Architecture](https://img.shields.io/badge/docs-ARCHITECTURE.md-blue?style=flat)](docs/ARCHITECTURE.md)
[![Docs — Setup](https://img.shields.io/badge/docs-SETUP.md-blue?style=flat)](docs/SETUP.md)
[![Docs — Prerequisites](https://img.shields.io/badge/docs-PREREQUISITES.md-blue?style=flat)](docs/PREREQUISITES.md)

---

## ⚡ 딸깍 설치 (한 줄) — 당신의 Claude로, 무료로

> **이 도구는 "당신의" Claude Code 로그인(구독)으로 "당신 PC에서" 실행됩니다.**
> 추가 요금 0원 — 평소 Claude 쓰던 **구독 사용량만 약간 소모**됩니다. 로그인 토큰은 **이 PC를 절대 벗어나지 않습니다.**

PowerShell을 열고 아래 한 줄을 붙여넣으세요:

```powershell
irm https://raw.githubusercontent.com/nobles92ts-ship-it/AI_GAME_QA_TestCase/main/install.ps1 | iex
```

- **권장 플랜: `Max (5x / 20x)`** — TC 한 세트 생성은 사용량이 꽤 들어 `Pro`는 사용 한도에 빨리 닿을 수 있습니다. (Pro도 동작은 합니다.)
- **요구사항**: Windows · [Node.js LTS](https://nodejs.org) · Claude Code 로그인(`claude` → `/login`). 설치기가 Claude Code는 없으면 자동 설치합니다.
- **결과는 로컬 엑셀(`.xlsx`)로 바로 나옵니다 — 구글 설정 불필요.** 구글 시트로 받고 싶을 때만 최초 1회 구글 연결 → [docs/PREREQUISITES.md](docs/PREREQUISITES.md).

설치 후: 터미널에서 `claude` 실행 →
- **가장 쉬운 방법 (구글 불필요)**: `/tc-로컬 <기능명> <기획서파일>` → 테스트케이스가 **엑셀(`.xlsx`)** 파일로 자동 생성됩니다.
- **(선택) 구글 시트**: **스프레드시트 링크 + 기획서 링크**를 함께 주면 TC 팀 v2가 시트에 생성합니다.

---

## ⚡ TL;DR

- **6-stage multi-agent pipeline** — Claude Opus for analysis/design, Sonnet for all other stages
- **4 input formats** — Confluence URL / PDF / Word (`.doc`, `.docx`) / Excel (`.xlsx`, `.xls`), auto-detected
- **Smart model routing** — Opus for deep reasoning (STEP 1), Sonnet for everything else — all via Claude Code CLI, no external API needed
- **Hybrid subagent + orchestrator pattern** — orchestrator spawns each worker as an isolated `claude` CLI process
- **Resume logic** — checkpoint-based via `state.json`; survives mid-run interruptions
- **SSoT rule management** — one skill file per stage, every agent reloads on change
- **Auto-completion tail** — master dashboard refresh + K/L project panel + Google Drive sync + tab color/order sort
- **Zero human click-through time beyond the initial 2 links** (~1 min of human attention per ~100-TC run)

---

## 📊 Measured metrics (~100-TC feature run)

| Metric | Manual QA | TC Team v2 | Δ |
|--------|:---:|:---:|:---:|
| Hands-on engineer time | ~3 hours | ~40 min | **~80% ↓** |
| Actual human click/type time | ~3 hours | **~1 min** | **~180× ↓** |
| Review rounds | 1 (manual) | 2 (auto, merged R2+Fix) | 2× |
| Dashboard / Drive sync | manual | automatic | ∞ |
| Supported input formats | 1 | **4** | — |
| Resume on interruption | ❌ | ✅ checkpoint-based | — |
| External API/server required | — | **None** (Claude Code CLI only) | — |

Output quality benchmarked against a 3-year senior QA engineer: terminology consistency, verifiability, spec coverage, and the EVAL 01–19 review criteria all measured at parity or better.

---

## 🏗 Architecture

![TC Team v2 Pipeline](assets/pipeline-diagram.png)

**Hybrid subagent + orchestrator**. `tc-팀-v2` is called by main Claude via the Task tool — so it runs in its own context — and internally dispatches each stage to a dedicated worker agent as a **separate `claude` CLI process** spawned via Bash. Every worker gets an isolated context window; the orchestrator writes checkpoints to `state.json` before each step transition and resumes from the last successful step on restart.

### Pipeline stages

| # | Stage | Agent | Model | Conditional | ~Time |
|---|-------|-------|-------|-------------|:---:|
| INIT | Workspace init + spec ingestion | orchestrator | Node.js + MCP | — | — |
| 1 | Spec analysis & TC design | `tc-designer-v2` | Claude Opus · `effort:med` | — | ~40m |
| 2 | Design inspection (C-01 ~ C-13) | `tc-설계검수-v2` | Claude Sonnet | — | ~10m |
| 3 | Design fix (max 1×) | `tc-designer-v2` | Sonnet · Opus if analysis-gap | `needs_fix == true` | ~10m |
| 4 | TC authoring → Google Sheets | `tc-writer-v2` | Claude Sonnet | — | ~3m |
| 5 | Review R1 + Fix R1 (merged one-context pass) | `tc-리뷰1수정1-v2` | Claude Sonnet | — | ~40m |
| 6 | Review R2 + Fix R2 (merged one-context pass) | `tc-리뷰2수정2-v2` | Claude Sonnet | — | ~10m |
| DONE | Dashboard refresh + K·L panel + Drive sync + tab color sort | orchestrator | Node.js | — | ~2m |

> The round-1 and round-2 review/fix passes were each merged into a single agent in Phase 2-B. The earlier split agents (`qa-reviewer-v2`, `tc-fixer-v2`) are kept in `agents/` for rollback but are **not** called by the active pipeline.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full data-flow diagram, resume-logic implementation, and orchestration internals.

---

## 🧠 Smart model routing — the design decision

We don't throw the same model at every stage. Each model has a sweet spot:

| Model | Role | Stages |
|-------|------|--------|
| **Claude Opus** | Deep reasoning — spec analysis & design | STEP 1 (+ STEP 3 if an analysis gap is detected) |
| **Claude Sonnet** | Balanced — all other stages | STEP 2–6 |

- **Opus handles**: spec analysis (complex judgment, `--effort medium`)
- **Sonnet handles**: design inspection, TC authoring, review, fix-application, merged review+fix

All models are called through **Claude Code CLI** (`claude --model <model> --agent <agent>`) — no external API keys, no SDK dependencies, no local model servers needed.

| Stage | Before (v1 — Gemma4 local) | After (v2 — Sonnet CLI) | Improvement |
|-------|:---:|:---:|:---:|
| STEP 4 TC authoring | Gemma4 · ~10 min · preamble bugs | Sonnet CLI · ~3 min · clean output | 3× faster, no bugs |
| Review + fix passes | Gemma4 · quota limits | Sonnet CLI · merged review+fix, no limits | reliable, fewer rounds |
| Setup complexity | Ollama install + VRAM + API key | None (Claude Code built-in) | Zero setup |

---

## 🚀 Quick start

Assumes [Claude Code](https://claude.ai/code) is already installed. Everything else the setup script handles.

```bash
git clone https://github.com/nobles92ts-ship-it/AI_GAME_QA_TestCase.git
cd AI_GAME_QA_TestCase

# Windows (fresh PCs default to ExecutionPolicy Restricted — this form works everywhere)
powershell -ExecutionPolicy Bypass -File .\setup.ps1

# macOS / Linux
bash ./setup.sh
```

The setup script:
- Auto-detects Node.js and Claude Code CLI paths
- Installs agents / skills / commands into `~/.claude/`
- Resolves the 7 path placeholders in place — `{NODE_PATH}`, `{CLI_JS}`, `{PROJECT_ROOT}`, `{WORK_ROOT}`, `{CLAUDE_HOME}`, `{CLAUDE_AGENTS_DIR}`, `{CLAUDE_SKILLS_DIR}`
- Runs `npm install` (`googleapis` + `xlsx`)
- Creates an optional `.env` (the pipeline also runs without it)

**For Google Sheets output (optional)**, place your Google OAuth desktop-client JSON at `credentials/client_secret.json` and run `npm run auth` once — the local `.xlsx` flow needs none of this. Full details: [docs/SETUP.md](docs/SETUP.md).

Then in Claude Code — **local Excel output (no Google needed):**

```
/tc-로컬 <feature-name> <spec-file>
```

…produces a local **`.xlsx`** file. Or, for **Google Sheets output** (one-time Google connection required):

```
/tc-v2 <google-sheets-url> <spec-source> [<spec-source-2> ...]
```

`<spec-source>` can be any of:

```
Confluence URL         https://yoursite.atlassian.net/wiki/spaces/.../pages/111
PDF file               C:/specs/feature.pdf
Word doc               /home/you/specs/feature.docx
Excel spreadsheet      "C:/my specs/matrix.xlsx"
```

Multiple sources can be mixed in a single batch run — the orchestrator iterates sequentially and each feature gets its own isolated run with independent state.

Full walkthrough: [docs/SETUP.md](docs/SETUP.md) · Dependency details: [docs/PREREQUISITES.md](docs/PREREQUISITES.md)

### MCP servers

Two MCP servers need to be registered in `~/.claude/.mcp.json` (template: [`.mcp.json.example`](.mcp.json.example)):

```json
{
  "mcpServers": {
    "google-sheets": {
      "command": "node",
      "args": ["<NPM_GLOBAL>/mcp-google-sheets/dist/index.js"],
      "env": {
        "GOOGLE_SHEETS_CLIENT_ID": "...",
        "GOOGLE_SHEETS_CLIENT_SECRET": "...",
        "TOKEN_PATH": "<HOME>/.mcp-google-sheets-token.json"
      }
    },
    "claude_ai_Atlassian": { "...": "..." }
  }
}
```

`google-sheets` and `Atlassian` are third-party or Claude Code built-in. No local model server (Ollama) is required — all model calls go through Claude Code CLI.

---

## 🛠 Tech stack

| Layer | Tech |
|-------|------|
| Agent runtime | Claude Code CLI (Opus + Sonnet, selected via `--model` aliases) |
| Orchestration | Bash + Node.js (CLI process spawning, state persistence, Bash↔MCP bridging) |
| Input parsers | `xlsx` (Excel) · Claude Code native file read (PDF, Word) · MCP (Confluence) |
| Output | Local **Excel (`.xlsx`)** via `xlsx` (default, no Google) · Google Sheets API via `googleapis` (optional) |
| MCP integrations | `google-sheets` (third-party), `claude_ai_Atlassian` |

---

## 🗺 Repository structure

```
AI_GAME_QA_TestCase/
├── agents/                        # Claude agent definitions
│   ├── tc-팀-v2.md                # Orchestrator — state.json + worker spawning
│   ├── tc-designer-v2.md          # STEP 1 (Opus) + STEP 3 design fix
│   ├── tc-설계검수-v2.md          # STEP 2 — design quality gate (C-01~C-13)
│   ├── tc-대조-v2.md              # STEP 2 — optional DXR cross-reference (off by default)
│   ├── tc-writer-v2.md            # STEP 4 — TC authoring (Sonnet)
│   ├── tc-리뷰1수정1-v2.md        # STEP 5 — merged R1 review + fix
│   ├── tc-리뷰2수정2-v2.md        # STEP 6 — merged R2 review + fix
│   ├── tc-updater-v2.md           # Spec-change detection + surgical TC update
│   └── qa-reviewer-v2.md / tc-fixer-v2.md   # legacy split R1 agents — rollback only
│
├── commands/
│   ├── tc-v2.md                   # /tc-v2 slash command (entry point)
│   ├── tc-로컬.md                 # /tc-로컬 — local .xlsx output (no Google)
│   └── tc-이미지매칭.md           # /tc-이미지매칭 — optional spec-image link matching
│
├── skills/                        # Per-stage SSoT skill files
│   ├── tc-분석/  tc-설계/  tc-생성/  tc-리뷰/  tc-수정/  tc-갱신/  tc-설계검수/  tc-대조/
│   ├── tc-학습/  tc-모니터/       # Pattern learning + run monitoring
│   ├── haiku/                     # Sonnet writer/fixer skill definitions (STEP 4, 5)
│   └── 완료처리/  tc-대시보드/    # Pipeline-tail skills
│
├── appscript/
│   ├── tab_manager.gs             # Tab color/sort Apps Script (M3 button + daily 09:00 KST auto-run)
│   └── bvt_slack.gs               # BVT result → Slack push (M6 button)
│
├── scripts/
│   └── util/                      # Node utilities (flat)
│       ├── google_auth.js         # Google OAuth (client_secret + token flow)
│       ├── update_dashboard.js    # Master dashboard refresh
│       ├── add_project_info.js    # K/L project-info panel
│       ├── upload_md_to_drive.js  # Specs → Drive sync
│       ├── deploy_appscript.js    # One-shot deployer — pushes .gs to the Sheets-bound project
│       ├── create_gsheet_tc_from_json.js · read_gsheet_data.js · pipeline_monitor.js
│       ├── confluence_image_downloader.py   # /tc-이미지매칭 helper (Python stdlib only)
│       ├── v2/                    # Pipeline state / gate / timing / report infrastructure
│       └── expander/              # Analysis→design expander (Phase A)
│
├── docs/
│   ├── PREREQUISITES.md           # Full dependency install guide
│   ├── SETUP.md                   # Step-by-step walkthrough
│   ├── ARCHITECTURE.md            # Pipeline internals + data flow
│   └── stability.md               # Reliability / failure-recovery design notes
│
├── credentials/                   # OAuth files (gitignored, .gitkeep only)
├── assets/                        # Pipeline diagram
├── .env.example                   # Optional env overrides (pipeline runs without it)
├── .mcp.json.example              # google-sheets + Atlassian MCP template
├── package.json                   # npm deps: googleapis, xlsx
├── setup.ps1 / setup.sh           # Platform-specific installers (token resolver)
└── landing-button.svg             # Landing page link badge
```

---

## 🔮 Roadmap

### ✅ Phase 1 — Multi-source TC automation & auto-completion (shipped)
- Confluence / PDF / Word / Excel → local Excel (`.xlsx`) by default, or Google Sheets (optional)
- 6-stage multi-agent pipeline (Claude Opus for STEP 1, Sonnet for STEP 2–6, via CLI)
- Merged review + fix pass for faster quality cycles
- Auto-completion tail: dashboard / K·L panel / Drive sync
- Tab color/sort auto-management: M3 dashboard button trigger + daily 09:00 KST auto-sort (`tab_manager.gs` + `deploy_appscript.js`)
- `tc-updater-v2` for surgical spec-change updates (Confluence only for now)

### 🔜 Phase 2 — Intelligent TC management
- TC history version control & diff view
- Cross-feature dependency analysis
- Auto-classification of automatable TCs
- Auto QA-report generation (PDF / Markdown / Confluence)
- PDF/Word spec-change detection extension for `tc-updater-v2`

### 🌟 Phase 3 — Physical test execution
- Generate automation scripts from TCs
- Auto-run against game builds
- Auto-reflect execution results back to the TC sheet
- Regression test automation loop

---

## 🤖 Built with Claude Code

This entire project — every agent definition, every orchestration Bash block, every skill rule, all documentation — was designed, built, and iterated end-to-end using [Claude Code](https://claude.ai/code).

For non-developers or a higher-level overview of what this system does, see the **[landing page](https://tc-team-v2-landing.vercel.app/)**.
