# 통합 TC 대시보드 (구형)

## 기본 정보
- **스프레드시트**: `https://docs.google.com/spreadsheets/d/1N8NHdBg1OyrQR46jCMJ5lQOKNN2aYiagjXcZhCqhb-4`
- **스프레드시트 ID**: `1N8NHdBg1OyrQR46jCMJ5lQOKNN2aYiagjXcZhCqhb-4`
- **대시보드 시트**: 첫 번째 시트 (시트명 자동 감지)
- **스크립트**: `{WORK_ROOT}\scripts\util\update_dashboard_alpha.js`

## 특징
- TC 데이터와 같은 스프레드시트 내 첫 번째 시트가 대시보드
- 나머지 시트 전체를 TC 시트로 자동 감지
- 현재 TC 시트 17개 (캐릭터_생성_화면 ~ 상점_NPC_시스템)

## 합계 수식
```js
// N/A 제외 (PASS + FAIL + BLOCK + 미진행만)
SUMPRODUCT(COUNTIF(시트!열:열, {"PASS","FAIL","BLOCK","미진행"}))
```

## 실행
```bash
cd {WORK_ROOT}/scripts/util
node update_dashboard_alpha.js
```

## TC 시트 추가 시
1. TC 시트 생성 후 위 스크립트 실행
2. 블록당 5개 초과 시 다음 블록 자동 생성
