# /tc-v2 — TC 팀 v2 파이프라인 실행

`tc-팀-v2` 에이전트를 사용해 TC 전체 파이프라인을 실행한다.

## 사용법
```
/tc-v2 <스프레드시트 링크> <Confluence URL 1> <Confluence URL 2> ...
```

## 예시
```
# 단일
/tc-v2 https://docs.google.com/spreadsheets/d/1xKq.../edit {{CONFLUENCE_SITE}}/.../pages/111

# 배치 (3~4개)
/tc-v2 https://docs.google.com/spreadsheets/d/1xKq.../edit {{CONFLUENCE_SITE}}/.../pages/111 {{CONFLUENCE_SITE}}/.../pages/222 {{CONFLUENCE_SITE}}/.../pages/333
```

## 동작
1. $ARGUMENTS를 그대로 `tc-팀-v2` 에이전트에 전달한다
2. Confluence URL이 여러 개면 **순서대로** 각각 전체 파이프라인 실행
3. 각 기능 완료 후 다음 기능으로 자동 진행 (중간 개입 불필요)
4. 모든 기능 완료 후 배치 결과 요약 보고

## 주의
- 스프레드시트 링크 + Confluence 링크 **둘 다** 필요
- Confluence만 제공 시 에이전트가 스프레드시트 링크를 요청 후 대기
- 배치 실행 시 앞 기능이 실패하면 해당 기능만 중단하고 다음 기능 계속 진행
