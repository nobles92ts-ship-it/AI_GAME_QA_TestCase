# Game QA Testcase — TC 팀 v2

Claude Code 기반 TC 자동 생성 파이프라인.  
기획서(Confluence)를 분석해 Google Sheets에 TC를 자동 생성·리뷰·수정한다.

## 설치

### 1. 레포 클론

```bash
git clone https://github.com/nobles92ts-ship-it/Game_QA_Testcase.git
cd Game_QA_Testcase
```

### 2. pipeline_config.json 설정

```bash
cp pipeline_config.json.template pipeline_config.json
```

`pipeline_config.json`을 열어 본인 환경에 맞게 경로 수정:

```json
{
  "paths": {
    "nodejs": "C:/YOUR_PATH/node.exe",
    "projectRoot": "C:/YOUR_PATH/Game_QA_Testcase"
  }
}
```

### 3. 에이전트 설치

```bash
# agents/ → Claude agents 폴더로 복사
cp agents/*.md ~/.claude/agents/

# skills/ → Claude skills 폴더로 복사
cp -r skills/* ~/.claude/skills/
```

### 4. 에이전트 파일 경로 수정

`agents/` 폴더의 각 `.md` 파일에서 아래 플레이스홀더를 본인 경로로 변경:

| 플레이스홀더 | 예시 |
|---|---|
| `{PROJECT_ROOT}` | `C:/Users/YourName/Game_QA_Testcase` |
| `{NODE_PATH}` | `C:/Program Files/nodejs/node.exe` |
| `{CLAUDE_SKILLS_DIR}` | `C:/Users/YourName/.claude/skills` |
| `{CLAUDE_AGENTS_DIR}` | `C:/Users/YourName/.claude/agents` |
| `{CLI_JS}` | Claude Code CLI 경로 |

### 5. 인증 설정

- **Google Sheets**: MCP 설정 (`~/.claude/.mcp.json`)에 Google OAuth 정보 입력
- **Jira/Confluence**: `scripts/util/jira_config.json` 생성 (템플릿 참고)

## 사용법

Claude Code에서:

```
TC 팀 v2로 진행
스프레드시트: https://docs.google.com/spreadsheets/d/...
Confluence: https://your-site.atlassian.net/wiki/spaces/.../pages/...
```

## 파이프라인 구조

```
설계 → 설계검수 → TC 작성 → 리뷰1 → 수정1 → 리뷰2 → 수정2 → 리뷰3 → (수정3) → (간이검증)
```

## 구조

```
agents/       # Claude 에이전트 파일 (tc-팀-v2 외 6개)
skills/       # 설계·생성·리뷰·수정·갱신·설계검수 스킬
scripts/util/ # Google Sheets 연동 스크립트
```
