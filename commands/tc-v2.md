# /tc-v2 — TC 팀 v2 파이프라인 실행

`tc-팀-v2` 에이전트를 사용해 TC 전체 파이프라인을 실행한다.

## 사용법

```
/tc-v2 <스프레드시트 링크> <기획서 소스 1> <기획서 소스 2> ...
```

**기획서 소스로 허용되는 것** (여러 유형 혼합 가능):
- Confluence URL (`atlassian.net/wiki/...`)
- PDF 파일 경로 (`*.pdf`)
- Word 파일 경로 (`*.doc`, `*.docx`)
- Excel 파일 경로 (`*.xlsx`, `*.xls`)

## 예시

```
# Confluence 단일
/tc-v2 https://docs.google.com/spreadsheets/d/1xKq.../edit https://your-site.atlassian.net/wiki/.../pages/111

# PDF 단일
/tc-v2 https://docs.google.com/spreadsheets/d/1xKq.../edit C:/specs/my_feature.pdf

# docx 단일
/tc-v2 https://docs.google.com/spreadsheets/d/1xKq.../edit /home/user/specs/feature.docx

# xlsx 단일
/tc-v2 https://docs.google.com/spreadsheets/d/1xKq.../edit C:/specs/test_matrix.xlsx

# 배치 (혼합 가능)
/tc-v2 https://docs.google.com/spreadsheets/d/1xKq.../edit \
  https://your-site.atlassian.net/wiki/.../pages/111 \
  C:/specs/feature2.pdf \
  C:/specs/feature3.docx
```

## 동작

1. `$ARGUMENTS`를 그대로 `tc-팀-v2` 에이전트에 전달한다
2. 에이전트가 입력을 파싱해 기획서 소스 목록을 추출:
   - `docs.google.com/spreadsheets` → 스프레드시트 ID
   - `atlassian.net/wiki` → Confluence 소스
   - `*.pdf` / `*.doc` / `*.docx` → 로컬 파일 소스 (Read 도구로 읽음)
   - `*.xlsx` / `*.xls` → 로컬 파일 소스 (xlsx 모듈로 CSV 변환)
3. 소스가 여러 개면 **순서대로** 각각 전체 파이프라인 실행
4. 각 기능 완료 후 다음 기능으로 자동 진행 (중간 개입 불필요)
5. 모든 기능 완료 후 배치 결과 요약 보고

## 주의

- 스프레드시트 링크 + 기획서 소스 **둘 다** 필요
- 기획서 소스만 제공 시 에이전트가 스프레드시트 링크를 요청 후 대기
- 로컬 파일 경로는 **절대 경로**로 입력 권장 (상대 경로는 Claude Code 실행 디렉토리 기준)
- 경로에 공백이 있으면 **쌍따옴표로 감싸기**: `"C:/my docs/spec.pdf"`
- 배치 실행 시 앞 기능이 실패하면 해당 기능만 중단하고 다음 기능 계속 진행
- PDF/doc/xlsx 파일이 존재하지 않으면 해당 항목은 스킵되고 경고 출력
