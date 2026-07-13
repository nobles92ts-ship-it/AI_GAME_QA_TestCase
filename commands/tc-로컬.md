# /tc-로컬 — 로컬 .xlsx 테스트케이스 생성 (Google·Confluence 불필요)

기획서 파일 1개로 테스트케이스를 만들어 **로컬 엑셀(.xlsx)** 로 저장한다.
구글 시트·Confluence·OAuth 설정이 전혀 필요 없다. 본인 Claude 구독으로 본인 PC에서 실행된다.

## 사용법

```
/tc-로컬 <기능명> <기획서파일경로>
```

예시:
```
/tc-로컬 소환배너 %USERPROFILE%\Downloads\소환배너_기획.md
```

## 실행 절차

1. `$ARGUMENTS` 에서 **기능명**과 **기획서 파일 경로**를 파싱한다. (둘 중 하나라도 없으면 사용자에게 요청)
2. 다음을 Bash로 실행한다:
   ```
   bash "{WORK_ROOT}/scripts/util/run_local_xlsx.sh" "<기능명>" "<기획서파일경로>"
   ```
3. 완료되면 출력된 **`.xlsx` 경로**를 사용자에게 안내한다. (보통 `{WORK_ROOT}/team/specs/<기능명>/<기능명>.xlsx`)
4. 실패 시 `team/specs/<기능명>/chain.log` 의 마지막 부분을 읽어 원인을 요약 보고한다.

## 지원 입력 형식
- **md / txt**: 바로 사용 (추가 도구 불필요)
- **pdf**: `poppler(pdftotext)` 가 있으면 자동 추출
- **doc / docx**: `pandoc` 이 있으면 자동 추출
- pdf/docx 도구가 없으면 기획서를 **md/txt 로 저장**해 다시 시도하도록 안내한다.

## 참고
- 이 모드는 STEP 1~4(설계→검수→수정→작성)만 수행하고 **시트 기반 2차 리뷰는 생략**한다(로컬 출력 특성). 더 다듬은 결과가 필요하면 구글 시트 모드(`/tc-team` 또는 `/tc-v2`)를 사용한다.
- 긴 실행은 Claude 사용량이 많으므로 **Max 플랜 권장**.
