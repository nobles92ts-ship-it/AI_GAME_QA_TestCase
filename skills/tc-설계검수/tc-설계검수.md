---
name: tc-설계검수
description: tc-designer-v2가 생성한 analysis.md + tc_design.md를 tc-설계.md 기준으로 검수하는 규격. 분류 구조, 커버리지, 기본기능 섹션, GlobalDefine, 플랫폼 태그 등 설계 품질 전반을 검증. tc-설계검수-v2 에이전트의 단일 소스(Single Source of Truth).
user-invocable: false
---

# TC 설계 검수 운용 지침

모든 답변과 보고는 **한국어**로 작성한다.

---

## 역할

STEP 1(설계) 결과물이 tc-설계.md 기준에 부합하는지 검수.

- 입력: `analysis.md` + `tc_design.md` (specs/[기능명]/ 내)
- 기준: `C:\Users\Admin\.claude\tc-team-v2\skills\tc-설계\tc-설계.md`
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

## 검수 항목 (C-01 ~ C-11)

### C-01 파일 완결성 [CRITICAL]
- analysis.md 존재 + 내용 있음
- tc_design.md 존재 + 내용 있음
- 둘 다 없거나 비어있으면 CRITICAL

### C-02 분류 구조 [CRITICAL]
- 대/중/소분류 3계층 tc_design.md에 명확히 정의
- 소분류 없는 중분류 또는 중분류 없는 대분류 → CRITICAL
- 소분류 3개 미만인 중분류 → MEDIUM

### C-03 분류 그룹핑 트리 [HIGH]
- tc_design.md에 "## 분류 그룹핑 트리" 섹션 존재
- 형식: `대분류 → 중분류 → 소분류 [리스크레벨] [플랫폼]` 계층
- 누락 → HIGH

### C-04 기본기능 섹션 [HIGH]
- tc_design.md에 "## 기본기능 검증 항목" 섹션 존재
- 항목 1개 이상
- 누락 → HIGH

### C-05 커버리지 완성도 [HIGH]
confluence_raw.md와 tc_design.md 분류 트리 비교 → 아래 10개 영역 누락 확인:

| # | 영역 (기획서에 존재 시만 체크) |
|---|------|
| 1 | 검색 기능 |
| 2 | 예외처리 전용 섹션 |
| 3 | 알림/뱃지 상세 동작 |
| 4 | 다른 기능에서의 진입점 |
| 5 | 연결 이동 기능 |
| 6 | 추천/자동화 알고리즘 |
| 7 | UI 안내/팁 요소 |
| 8 | 추후 구현 항목 |
| 9 | 목록 내 탭/필터 |
| 10 | 플랫폼 전용 조작 |

기획서에 해당 영역 존재 + 분류 트리에 없음 → HIGH 1건씩 기록.

### C-06 GlobalDefine 키 목록 [HIGH]
- confluence_raw.md에 GlobalDefine 키 있을 때
- tc_design.md에 "## GlobalDefine 키 목록" 섹션 존재 필요
- 기획서에 없으면 SKIP
- 누락 → HIGH

### C-07 암묵적 요구사항 태그 [MEDIUM]
- tc_design.md 소분류에 [세션] [권한] [데이터] [UI] [유저상태] [동시성] [연계] 태그
- 서버 로직 있는 기능에 태그 0개 → MEDIUM

### C-08 취소선 처리 [MEDIUM]
- confluence_raw.md에 취소선(`~~텍스트~~`) 있을 때
- analysis.md에 동일 `~~텍스트~~` 형식 반영 여부
- tc_design.md에 "추후 구현" 처리(비고=추후 구현, 결과=N/A) 여부
- 미처리 → MEDIUM

### C-09 플랫폼 태그 [MEDIUM]
- tc_design.md 분류 트리 소분류에 [PC/모바일] / [PC] / [모바일] 태그
- 태그 없는 소분류가 전체 20% 이상 → MEDIUM

### C-10 리스크 레벨 태그 [LOW]
- tc_design.md 분류 트리 소분류에 [HIGH] / [MEDIUM] / [LOW] 태그
- 태그 없는 소분류가 전체 30% 이상 → LOW

### C-11 원천 → 트리 링크 검증 [HIGH]
원천 섹션(트리 앞 8종) 각 항목이 **분류 그룹핑 트리의 `→` 케이스에 1회 이상 등장**하는지 기계 대조. 누락 1건당 HIGH 1건.

| # | 원천 섹션 | 검증 질문 | FAIL 조건 |
|---|----------|----------|----------|
| 1 | 섹션 전수 대조표 | 표의 모든 기획서 섹션이 트리 대/중/소분류에 매핑되는가 | 매핑 안 된 섹션 존재 |
| 2 | 취소선/추후구현 항목 | 취소선 항목이 트리에 **없는지**(역체크), 추후구현은 비고 "추후구현" 표기 대상인지 | 취소선이 트리에 존재 |
| 3 | NULL/빈상태 대상 목록 | "예외 TC 필요=O" 항목마다 해당 소분류에 `→ 예외-N` 케이스가 존재하는가 | O인데 `→ 예외` 없음 |
| 4 | 상태 전이 테이블 | 모든 전이 엣지(상태A→상태B)가 트리 `→` 케이스 1개 이상에 매핑되는가 | 미매핑 엣지 |
| 5 | 결정 테이블 | 모든 조건 조합 행이 트리 `→` 케이스에 매핑되는가 | 미매핑 조합 |
| 6 | GlobalDefine 키 목록 | 각 키(미지정 `⚠` 포함)가 최소 1개 트리 `→` 케이스 설명에 등장하는가 | 키가 트리 어디에도 없음 |
| 7 | 신뢰 파괴 위험 요소 | HIGH 체감 시나리오가 트리 `→` 부정/예외 케이스에 반영되었는가 | HIGH 체감 항목 미반영 |
| 8 | 리스크 태깅 비율 | HIGH 소분류 부정+예외 ≥ 60%, MEDIUM ≥ 49%, LOW ≥ 30% | 비율 미달 |

추가 역방향 체크(선택):
- B-8 오류 패턴(analysis.md): 각 패턴이 해당 소분류의 `→ 부정/예외`에 반영 → 미반영 시 MEDIUM
- C-1 미지정값(analysis.md): 각 항목이 "기획 확인 필요 항목" + GlobalDefine `미지정` 컬럼에 승격 → 미승격 시 MEDIUM

> **근거**: tc-설계.md 섹션 순서가 "원천 → 트리 → 배분·검증"으로 재정렬 후, 검수는 단방향(원천→트리) 기계 대조 가능. 학습 근거 P-05(교차 중복), P-08(상태 전이 엣지 누락) 재발 방지.

---

## 이슈 레벨 기준

| 레벨 | 기준 |
|------|------|
| CRITICAL | 파이프라인 진행 불가 (파일 없음, 분류 구조 없음) |
| HIGH | 설계 누락 → TC 품질 직접 영향 (커버리지 누락, 트리 없음) |
| MEDIUM | 서식/태그 누락 → tc-writer 작업에 영향 |
| LOW | 권고 수준 |

---

## Pass Gate

```
CRITICAL = 0  →  설계 수정(STEP 3) 없이 TC 작성(STEP 4) 진행
CRITICAL > 0  →  STEP 3 설계 수정 (최대 1회 재실행)
```

HIGH/MEDIUM/LOW 이슈는 design_review.md에 기록하되 STEP 3 트리거 조건 아님.
단, HIGH ≥ 2건이면 STEP 3 트리거 조건 포함.

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
| C-11 원천 → 트리 링크 검증 | PASS/FAIL | N |

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
