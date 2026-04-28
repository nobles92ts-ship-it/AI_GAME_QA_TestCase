---
name: tc-갱신
description: 기획서 변경 시 TC 자동 수정 규격. Diff 비교, 재현스탭 변경 이력(최근 2건), 비고 기획변경 이력, 결과 열 리셋, specs 버전 관리 규칙 정의.
user-invocable: false
---

# TC 갱신 규격

**⚠️ TC 시트 입력 시 반드시 tc-생성 스킬 기준 적용:**
실제 TC를 시트에 입력(수정, 재작성)할 때는 `{CLAUDE_HOME}\tc-team-v2\skills\tc-생성\tc-생성.md`의 서식 규칙(정렬, 조건부서식, 드롭다운, 필터, 분류 그룹핑, 중복표기, 재현 스텝 한 문장 형식 등)을 전체 적용할 것.

## 트리거 조건

아래 중 하나에 해당하면 자동 시작:
- "기획서 비교해서 TC 갱신해"
- "기획 변경됐어" + Confluence 링크
- "TC 갱신" / "TC 업데이트" 요청

**필수 입력**: 변경된 Confluence 링크 + 기능명 (또는 specs 폴더에서 자동 매칭)

---

## Diff 비교 규칙

기존 `analysis.md`(또는 최신 버전 파일)와 새 기획서 내용을 비교하여 변경점 도출:

- **추가된 기능**: 새로 생긴 기능/스펙
- **수정된 기능**: 동작 방식, 수치, 조건 등이 바뀐 항목
- **삭제된 기능**: 제거되거나 취소선 처리된 항목

변경점을 `diff_report.md`로 정리:
```markdown
## 기획 변경 분석 보고

### 추가된 기능
- [기능명]: [설명]

### 수정된 기능
- [기능명]: 기존 [OO] → 변경 [XX]

### 삭제된 기능
- [기능명]: [삭제 사유]

### 영향받는 TC 범위 (예상)
- 대분류: [...]
- 중분류: [...]
```

**diff 비교 기준**: 항상 가장 최신 버전 파일과 새 기획서를 비교
- `analysis_v3.md`가 있으면 → v3 vs 새 기획서
- `analysis_v2.md`만 있으면 → v2 vs 새 기획서
- 버전 파일이 없으면 → `analysis.md`(원본) vs 새 기획서

---

## 재현스탭 변경 규칙 (F열 — 최근 2건만 유지)

```
[변경 전]
1. 기존 재현 스탭 내용

[변경 후 - 2026-03-05]
1. 새로운 재현 스탭 내용
```

- **이미 변경 이력이 있는 경우**: 기존 `[변경 전]`을 삭제하고, 기존 `[변경 후]`를 새 `[변경 전]`으로, 새 내용을 `[변경 후]`로
- **최초 변경인 경우**: 기존 내용 전체를 `[변경 전]`으로, 새 내용을 `[변경 후 - 날짜]`로

### 코드 로직
```javascript
function updateReproStep(currentStep, newStep, date) {
    const hasHistory = currentStep.includes('[변경 전]');
    if (hasHistory) {
        const afterMatch = currentStep.match(/\[변경 후[^\]]*\]\n([\s\S]*)/);
        const prevAfter = afterMatch ? afterMatch[1].trim() : '';
        return `[변경 전]\n${prevAfter}\n\n[변경 후 - ${date}]\n${newStep}`;
    } else {
        return `[변경 전]\n${currentStep.trim()}\n\n[변경 후 - ${date}]\n${newStep}`;
    }
}
```

---

## 비고 변경 규칙 (K열 — 최근 2건만 유지)

```
[기획변경 2026-03-05] 기존: OO → 변경: XX (기획서 v2 반영)
```

- 기존 비고 내용이 있으면 줄바꿈으로 append
- `[기획변경]` 항목은 최근 2건만 유지 (3건 이상이면 가장 오래된 것 삭제)
- `[기획변경]`이 아닌 기존 비고 텍스트(예: "기획서 미명시")는 삭제하지 않고 유지

### 코드 로직
```javascript
function updateNote(currentNote, changeNote, date) {
    const newEntry = `[기획변경 ${date}] ${changeNote}`;
    const lines = currentNote ? currentNote.split('\n') : [];
    const changeEntries = [];
    const otherLines = [];
    for (const line of lines) {
        if (line.trim().startsWith('[기획변경')) changeEntries.push(line.trim());
        else if (line.trim()) otherLines.push(line.trim());
    }
    const recentChange = changeEntries.length > 0 ? changeEntries[changeEntries.length - 1] : null;
    const parts = [];
    if (otherLines.length > 0) parts.push(otherLines.join('\n'));
    if (recentChange) parts.push(recentChange);
    parts.push(newEntry);
    return parts.join('\n');
}
```

---

## 결과 열 리셋 규칙 (H/I/J열)

- 값이 `PASS`, `FAIL`, `BLOCK` 중 하나이면 → `미진행`으로 변경
- `N/A`는 그대로 유지
- `미진행`도 그대로 유지

```javascript
function resetResult(value) {
    const v = (value || '').trim();
    if (['PASS', 'FAIL', 'BLOCK'].includes(v)) return '미진행';
    return v;
}
```

---

## 삭제된 기능의 TC
- 해당 행을 삭제

## 추가된 기능의 TC
- tc-수정 스킬의 삽입 규칙과 동일 (분류에 맞는 위치에 삽입)
- 삽입 후 분류별 그룹핑 + TC ID 재부여 + 분류 중복 표기 정리

---

## specs 폴더 버전 관리 (덮어쓰기 금지)

수정 완료 후 새 기획서 분석을 **v2, v3, ...** 파일로 추가 저장. 기존 파일은 절대 덮어쓰지 않는다.

**버전 번호 결정**: specs 폴더에서 가장 높은 버전 번호를 찾아 +1

**저장 파일**:
```bash
cp new_analysis.md "specs/[기능명]/analysis_v2.md"
cp new_tc_design.md "specs/[기능명]/tc_design_v2.md"
cp diff_report.md "specs/[기능명]/diff_v2.md"
# TC 스냅샷은 수정 스크립트에서 저장 (tc_snapshot_v2.xlsx)
```

**결과 폴더 구조** (2번 변경 후 예시):
```
specs/HUD/
  ├── analysis.md          ← 원본 (v1)
  ├── analysis_v2.md       ← 1차 변경
  ├── analysis_v3.md       ← 2차 변경
  ├── tc_design.md         ← 원본 (v1)
  ├── tc_design_v2.md      ← 1차 변경
  ├── tc_design_v3.md      ← 2차 변경
  ├── tc_snapshot.xlsx     ← 원본 TC (최초 생성 시)
  ├── tc_snapshot_v2.xlsx  ← 1차 변경 후 TC
  ├── tc_snapshot_v3.xlsx  ← 2차 변경 후 TC
  ├── diff_v2.md           ← 1차 변경점 기록
  ├── diff_v3.md           ← 2차 변경점 기록
  └── sheet_info.txt       ← 변경 없음
```

---

## 갱신 완료 보고 형식

```
## TC 갱신 완료 보고

### 기획 변경 요약
| 항목 | 내용 |
|------|------|
| 기능명 | [기능명] |
| Confluence | [링크] |
| 변경 유형 | 추가 N건 / 수정 N건 / 삭제 N건 |

### TC 변경 내역
| 변경 유형 | TC ID | 대분류 | 중분류 | 변경 내용 |
|-----------|-------|--------|--------|-----------|
| 수정 | 00X | ... | ... | 기존: OO → 변경: XX |
| 삭제 | 00X | ... | ... | 기능 삭제로 TC 제거 |
| 신규 | 00X | ... | ... | 추가된 기능 TC |

### TC 수 변화
| 항목 | 수량 |
|------|------|
| 변경 전 TC 수 | N개 |
| 수정된 TC | N개 |
| 삭제된 TC | N개 |
| 신규 추가 TC | N개 |
| **변경 후 TC 수** | **N개** |

### specs 버전 추가
- analysis_v[N].md: 저장 완료
- tc_design_v[N].md: 저장 완료
- diff_v[N].md: 저장 완료
- tc_snapshot_v[N].xlsx: 저장 완료
- 구글 드라이브: 재업로드 완료

### 결과 열 리셋
- 미진행으로 변경된 TC: N개 (기존 PASS/FAIL/BLOCK → 미진행)
```
