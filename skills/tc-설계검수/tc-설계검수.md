---
name: tc-설계검수
description: tc-designer-v2가 생성한 analysis.md + tc_design.md를 tc-설계.md 기준으로 검수하는 규격. 분류 구조, 커버리지, 기본기능 섹션, GlobalDefine, 플랫폼 태그 등 설계 품질 전반을 검증. tc-설계검수-v2 에이전트의 단일 소스(Single Source of Truth).
user-invocable: false
---

# TC 설계 검수 운용 지침

모든 답변과 보고는 **한국어**로 작성한다.

---

## 역할

STEP 1(설계)이 생성한 결과물이 tc-설계.md 기준에 맞게 작성되었는지 검수한다.

- 입력: `analysis.md` + `tc_design.md` (specs/[기능명]/ 내)
- 기준: `{{CLAUDE_HOME}}\skills\tc-설계\tc-설계.md`
- 출력: `design_review.md` + `step_result.json`

---

## 검수 전 준비

```
1. specs/[기능명]/analysis.md 읽기
2. specs/[기능명]/tc_design.md 읽기
3. specs/[기능명]/confluence_raw.md 읽기 (기획서 원문 비교용)
4. tc-설계.md 읽기 (검수 기준 확인)
```

---

## 검수 항목 (C-01 ~ C-10)

### C-01 파일 완결성 [CRITICAL]
- analysis.md 존재 + 내용 있음
- tc_design.md 존재 + 내용 있음
- 두 파일 모두 없거나 비어있으면 CRITICAL

### C-02 분류 구조 [CRITICAL]
- 대분류 / 중분류 / 소분류 3계층이 tc_design.md에 명확히 정의되어 있음
- 소분류가 없는 중분류 또는 중분류가 없는 대분류가 있으면 CRITICAL
- 소분류 항목이 3개 미만인 중분류: MEDIUM

### C-03 분류 그룹핑 트리 [HIGH]
- tc_design.md에 "## 분류 그룹핑 트리" 섹션이 존재
- 트리 형식: `대분류 → 중분류 → 소분류 [리스크레벨] [플랫폼]` 순 계층
- 누락 시 HIGH

### C-04 기본기능 섹션 [HIGH]
- tc_design.md에 "## 기본기능 검증 항목" 섹션이 존재
- 항목이 1개 이상 있음
- 누락 시 HIGH

### C-05 커버리지 완성도 [HIGH]
confluence_raw.md와 tc_design.md 분류 트리를 비교하여 아래 10개 영역 누락 여부 확인:

| # | 영역 | 확인 |
|---|------|------|
| 1 | 검색 기능 (기획서에 존재 시) | 분류 트리에 있는지 |
| 2 | 예외처리 전용 섹션 | 분류 트리에 있는지 |
| 3 | 알림/뱃지 상세 동작 (기획서에 존재 시) | 분류 트리에 있는지 |
| 4 | 다른 기능에서의 진입점 (기획서에 존재 시) | 분류 트리에 있는지 |
| 5 | 연결 이동 기능 (기획서에 존재 시) | 분류 트리에 있는지 |
| 6 | 추천/자동화 알고리즘 (기획서에 존재 시) | 분류 트리에 있는지 |
| 7 | UI 안내/팁 요소 (기획서에 존재 시) | 분류 트리에 있는지 |
| 8 | 추후 구현 항목 (기획서에 존재 시) | 분류 트리에 있는지 |
| 9 | 목록 내 탭/필터 (기획서에 존재 시) | 분류 트리에 있는지 |
| 10 | 플랫폼 전용 조작 (기획서에 존재 시) | 분류 트리에 있는지 |

기획서에 해당 영역이 존재하는데 분류 트리에 없으면 HIGH 1건씩 기록.

### C-06 GlobalDefine 키 목록 [HIGH]
- confluence_raw.md에 GlobalDefine 키가 있을 경우
- tc_design.md에 "## GlobalDefine 키 목록" 섹션이 존재해야 함
- 기획서에 GlobalDefine 없으면 이 항목 SKIP
- 누락 시 HIGH

### C-07 암묵적 요구사항 태그 [MEDIUM]
- tc_design.md 소분류에 [세션] [권한] [데이터] [UI] [유저상태] [동시성] [연계] 태그 존재 여부
- 서버 로직이 있는 기능에 암묵적 요구사항 태그가 하나도 없으면 MEDIUM

### C-08 취소선 처리 [MEDIUM]
- confluence_raw.md에 취소선(`~~텍스트~~`)이 있을 경우
- analysis.md에 동일하게 `~~텍스트~~` 형식으로 반영되어 있는지
- tc_design.md에 해당 항목이 "추후 구현" 처리(비고=추후 구현, 결과=N/A) 되었는지
- 미처리 시 MEDIUM

### C-09 플랫폼 태그 [MEDIUM]
- tc_design.md 분류 트리의 소분류 항목에 [PC/모바일] / [PC] / [모바일] 태그가 있는지
- 태그가 없는 소분류가 전체의 20% 이상이면 MEDIUM

### C-10 리스크 레벨 태그 [LOW]
- tc_design.md 분류 트리의 소분류 항목에 [HIGH] / [MEDIUM] / [LOW] 태그가 있는지
- 태그가 없는 소분류가 전체의 30% 이상이면 LOW

---

## 이슈 레벨 기준

| 레벨 | 기준 |
|------|------|
| CRITICAL | 파이프라인 진행 불가 수준 (파일 없음, 분류 구조 없음) |
| HIGH | 설계 누락으로 TC 품질에 직접 영향 (커버리지 누락, 트리 없음 등) |
| MEDIUM | 서식/태그 누락으로 tc-writer 작업에 영향 |
| LOW | 권고 수준 |

---

## Pass Gate

```
CRITICAL = 0  →  설계 수정(STEP 3) 없이 TC 작성(STEP 4)으로 진행
CRITICAL > 0  →  STEP 3 설계 수정 (최대 1회 재실행)
```

HIGH/MEDIUM/LOW 이슈는 design_review.md에 기록하되 STEP 3 트리거 조건 아님.
단, HIGH ≥ 2건이면 STEP 3 트리거 조건에 포함.

---

## 결과 파일

### design_review.md 형식

```markdown
## TC 설계 검수 보고서

- 기능명: [기능명]
- 검수 기준: tc-설계.md

### 검수 결과 요약

| 항목 | 결과 | 이슈 수 |
|------|------|---------|
| C-01 파일 완결성 | PASS/FAIL | N |
| C-02 분류 구조 | PASS/FAIL | N |
| C-03 분류 그룹핑 트리 | PASS/FAIL | N |
| C-04 기본기능 섹션 | PASS/FAIL | N |
| C-05 커버리지 완성도 | PASS/FAIL | N |
| C-06 GlobalDefine 키 목록 | PASS/FAIL/SKIP | N |
| C-07 암묵적 요구사항 태그 | PASS/FAIL | N |
| C-08 취소선 처리 | PASS/FAIL/SKIP | N |
| C-09 플랫폼 태그 | PASS/FAIL | N |
| C-10 리스크 레벨 태그 | PASS/FAIL | N |

### 이슈 목록

| # | 레벨 | 항목 | 내용 | 위치 |
|---|------|------|------|------|
| 1 | HIGH | C-05 | [기능명] 영역이 분류 트리에 없음 | tc_design.md |

### 결론
[PASS / STEP 3 수정 필요]
이슈 요약 및 수정 방향 간략 기술
```

---

## step_result.json 형식

```json
{
  "status": "success",
  "issues": {
    "critical": 0,
    "high": 0,
    "medium": 0,
    "low": 0
  },
  "total_issues": 0,
  "needs_fix": false,
  "review_path": "team/specs/[기능명]/design_review.md"
}
```

`needs_fix`: CRITICAL > 0 또는 HIGH ≥ 3이면 `true`.
