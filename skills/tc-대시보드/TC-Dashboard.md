---
name: tc-대시보드
description: TC 대시보드 생성·갱신·수정 작업을 수행합니다. 대시보드 스크립트 실행, 합계/수식 변경, 새 TC 시트 반영 등 대시보드 관련 모든 작업 시 사용합니다.
user-invocable: true
allowed-tools: Read, Bash, Edit, Write
---

# TC 대시보드 스킬

## 트리거 (이 스킬을 사용하는 상황)
- "대시보드 업데이트해줘"
- "대시보드 수식 바꿔줘"
- "새 TC 시트 추가했는데 대시보드 반영해줘"
- 대시보드 관련 질문·수정 요청 전반

---

## 대시보드 목록

| 이름 | 스프레드시트 | 스크립트 | 세부 문서 |
|------|------------|---------|---------|
| 마스터 (DX 전체) | `1Q-CsPTRB2UO9hPxG50aigBBEEXi4uQuVAMeTFHCP_hY` | `update_dashboard.js` | [master.md](./master.md) |
| 통합 TC (구형) | `1N8NHdBg1OyrQR46jCMJ5lQOKNN2aYiagjXcZhCqhb-4` | `update_dashboard_alpha.js` | [alpha.md](./alpha.md) |
| Game QA TC | `1-ICt7w5haohb4S1r3cwX7Z8ZY1tnYCQ6Xawysaocl3E` | `update_dashboard_gameqa.js` | — |

스크립트 위치: `{WORK_ROOT}\scripts\util\`

---

## 공통 구조

```
행 구성 (블록당):
  섹션헤더 (1행) — 시트명 표시
  플랫폼   (1행) — PC | 모바일
  데이터   (5행) — PASS / FAIL / BLOCK / 미진행 / 합계
```

### Game QA 특이사항
- **데이터 6행**: PASS / FAIL / BLOCK / 미진행 / N/A / 합계 (`BLOCK_HEIGHT=8`)
- **숨김 시트 자동 제외**: `!s.properties.hidden` 필터 적용
- **진행 현황 패널**: 타이틀 행 아래 좌측에 PC·모바일 SPARKLINE 게이지 + 진행률 텍스트 배치

### 섹션 헤더 하이퍼링크 (공통)
- TC 시트명 셀에 `HYPERLINK` 수식을 넣어 클릭 시 해당 시트로 이동
- 형식: `=HYPERLINK("https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit#gid={시트GID}","시트명")`
- "통합" 섹션은 하이퍼링크 없이 텍스트만 표시
- `sheetGidMap` 객체로 시트명 → gid 매핑 (스프레드시트 메타데이터에서 자동 추출)

### 합계 수식 기준 (공통)
```
합계 = PASS + FAIL + BLOCK + 미진행
N/A는 합계에 포함하지 않음
```
`sumFormula` 함수:
```js
SUMPRODUCT(COUNTIF(시트!열:열, {"PASS","FAIL","BLOCK","미진행"}))
```

### 빈칸 유지 규칙 (공통)
- **원래 비어 있어야 할 셀에는 값을 쓰지 않는다** — 빈 문자열(`""`)도 넣지 않음
- 수식 결과가 0인 셀은 **0으로 표시** (빈칸으로 바꾸지 않음)
- TC 데이터 행 작성 시: 값이 없는 칸은 API에 빈 값을 전송하지 않고 skip
- 대시보드 `rowData` 배열에서도 불필요한 `''` 자리채우기 금지

### 스크립트 실행 시점
- **새 TC 시트 추가 시**: 스크립트 재실행 필수 (열/블록 자동 재생성)
- **TC 결과 값 변경 시**: COUNTIF 수식 자동 반영 → 재실행 불필요
- **수식/서식 변경 시**: 스크립트 수정 후 재실행

---

## 작업 절차

### 1. 대시보드 갱신 (스크립트 실행)
```bash
cd {WORK_ROOT}/scripts/util
node update_dashboard.js        # 마스터
node update_dashboard_alpha.js  # 통합 TC (구형)
```

### 2. 수식 변경 요청 시
1. 해당 스크립트 파일 읽기
2. `sumFormula` 또는 `countif` 함수 수정
3. 스크립트 재실행으로 반영

### 3. 새 대시보드 추가 시
- `update_dashboard_alpha.js`를 복사해 `SPREADSHEET_ID`와 `DASHBOARD_TITLE` 변경
- 이 SKILL.md의 대시보드 목록에 추가
- 세부 문서 (.md) 신규 작성

---

## 주의사항
- 스크립트 실행 시 대시보드 시트 **전체 초기화 후 재생성** (기존 수동 편집 내용 사라짐)
- TC 데이터 시트는 건드리지 않음 (읽기만 함)
- OAuth 인증: `google_auth.js` 자동 처리 (토큰 만료 시 재인증 필요)
