---
description: TC 시트 K열(담당자)에 Confluence 이미지 링크를 선택적으로 임베드 (on-demand).
---

# /tc-이미지매칭

`tc-이미지매칭` 스킬을 호출하여 TC 시트의 K열(담당자)에 기획서 이미지 링크를 추가합니다. (비고 J열은 절대 건드리지 않음)

본 TC-v2 파이프라인과 분리된 단독 명령. 사용자가 필요할 때만 실행.

## 사용법

```
/tc-이미지매칭
```

또는 자연어로:
- "이미지 매칭해줘"
- "TC에 이미지 링크 추가해줘"
- "비고에 Confluence 이미지 붙여줘"

## 처리 흐름
1. 대상 스프레드시트 + 탭 + 범위 확인 (사용자 입력)
2. Confluence 첨부/페이지 분석 → 이미지 인벤토리 생성
3. TC ↔ 이미지 LLM 매칭 (시각자료가 유용한 케이스만, 10~20% 권장)
4. K열에 `=HYPERLINK(preview_url, "라벨")` 임베드 (이모지 금지 — 스킬 규칙)
5. 결과 리포트

상세 규칙: `{CLAUDE_SKILLS_DIR}/tc-이미지매칭/SKILL.md`

## 요구사항
- **Google Sheets 출력 경로 전용** (시트에 쓰므로 구글 연결 필요 — docs/SETUP.md Step 2·5)
- **Atlassian MCP** 등록 (docs/SETUP.md Step 4) — 첨부 attID 조회(`confluence_get_attachments`)에 필요
