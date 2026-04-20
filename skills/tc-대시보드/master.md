# 마스터 대시보드 (DX 전체 TC 현황)

## 기본 정보
- **스프레드시트**: `https://docs.google.com/spreadsheets/d/1Q-CsPTRB2UO9hPxG50aigBBEEXi4uQuVAMeTFHCP_hY`
- **스프레드시트 ID**: `1Q-CsPTRB2UO9hPxG50aigBBEEXi4uQuVAMeTFHCP_hY`
- **대시보드 시트명**: `대시보드`
- **스크립트**: `{WORK_ROOT}\scripts\util\update_dashboard.js`

## 특징
- TC 시트가 아닌 별도 스프레드시트 (마스터 집계용)
- 모든 기획별 TC 시트를 통합해서 보여줌
- TC팀01·02가 TC 작성 완료 직후 반드시 실행

## 하이퍼링크
- 각 TC 시트 헤더 셀 클릭 시 해당 시트로 이동 (전체 URL 형식)
- "통합" 셀은 하이퍼링크 없음

## 레이아웃
```
A열(구분) | B열(공백) | C~D열(전체 통합) | E~F열(기획1) | G~H열(기획2) ...
```
- 블록당 MAX 5개 TC 시트, 초과 시 다음 블록 아래에 생성
- 진행률 패널 (SPARKLINE 바): 통합 블록 우측에 배치

## 실행
```bash
cd {WORK_ROOT}/scripts/util
node update_dashboard.js
```
