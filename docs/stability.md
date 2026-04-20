# TC 팀 v2 — 안정성 정책 상세 (S1~S7)

> tc-팀-v2.md의 안정성 정책 상세 구현을 담는 SSoT.
> 팀장 md에는 요약 매핑만 두고, 상세 구현/배경은 여기를 참조.

---

## S1. Sheets API 쿼터/레이트 리밋 대응

### 배경
Google Sheets API 제한: **분당 300회, 100초당 500회**. STEP 4/6/7에서 대량 쓰기 시 쉽게 도달.

### 감지 패턴 (stderr)
```
429 | RESOURCE_EXHAUSTED | Quota exceeded | rateLimitExceeded | userRateLimitExceeded | 503
```

### 재시도 스케줄
- 1차 재시도: **30초** 대기
- 2차 재시도: **60초** 대기
- 3차 재시도: **120초** 대기
- 이후 중단 → 사용자 보고

### 구현
`$UTIL/pipeline_retry.sh` 가 자동 처리. 각 STEP Bash 호출을 이 스크립트로 래핑.

### 적용 대상
Sheets API 호출이 있는 STEP: 4, 6, 7, 완료처리 FINAL-1/2.

---

## S2. 백업 탭으로 데이터 오염 방지

### 배경
STEP 4 탭 삭제 → TC 재생성 도중 크래시 시 **시트가 비는 사고** 발생 가능.

### 구현 스크립트
`$UTIL/duplicate_tab.js` — 탭 복제/삭제.

### 실행 흐름

**STEP 4 시작 직전 (기존 탭 존재 시만 백업):**
```bash
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="${TAB_NAME}_backup_${TIMESTAMP}"
if "$NODE" "$UTIL/duplicate_tab.js" "$SHEET_ID" "$TAB_NAME" "$BACKUP_NAME" 2>"$SPECS/[기능명]/s2_backup.log"; then
  echo "$BACKUP_NAME" > "$SPECS/[기능명]/backup_tab.txt"
  echo "백업 탭 생성: $BACKUP_NAME"
else
  rc=$?
  case $rc in
    2)  echo "[S2] 기존 탭 없음 — 신규 생성 모드, 백업 스킵" ;;
    10) echo "[S2][CRITICAL] OAuth 만료 — 중단" >&2; exit 10 ;;
    *)  echo "[S2][경고] 백업 실패 (exit $rc) — 데이터 오염 보호 없이 계속 진행" >&2 ;;
  esac
fi
```

**STEP 4 성공 후**: 백업 탭 삭제
```bash
BACKUP=$(cat "$SPECS/[기능명]/backup_tab.txt" 2>/dev/null)
[ -n "$BACKUP" ] && "$NODE" "$UTIL/duplicate_tab.js" "$SHEET_ID" "$BACKUP" --delete
```

**STEP 4/6/7 실패 후**:
- 사용자에게 "백업 탭에서 복원?" 확인
- 동의 시 원본 탭 삭제(`--delete`) 후 백업 탭 이름을 원본으로 변경
- **자동 복원 금지** (부분 수정이 더 가치 있을 수 있음)

### 스크립트 exit code
- 0: 성공
- 1: 일반 실패
- 2: 소스 탭 없음 (경고 후 계속 가능)
- 3: 대상 탭 중복
- 10: OAuth/인증 실패 (재시도 금지)
- 11: 쿼터/레이트 초과

---

## S3. tc-fixer 행 쓰기 직후 자체 검증 (컬럼 꼬임 재발 방지)

### 배경
2026-04-17 사고: 아바타_탈것_합성_확정_시스템 TC 176~196(21개)에서 F열↔G열 뒤바뀜. 2차 리뷰까지 놓쳐 배포됨.

### 구현
tc-fixer-v2가 배치 쓰기 직후, 수정 행 범위를 `--range G[start]:G[end]`로 재읽기해 G열 값 검증.

```bash
NODE="{NODE_PATH}"
UTIL="{WORK_ROOT}/scripts/util"

START_ROW=<수정 최소행>
END_ROW=<수정 최대행>

BAD=$("$NODE" "$UTIL/read_gsheet_data.js" "$SHEET_ID" "$TAB_NAME" --range "G${START_ROW}:G${END_ROW}" 2>/dev/null \
  | node -e "
    const r=JSON.parse(require('fs').readFileSync(0));
    const ok=new Set(['PC','모바일','PC/모바일']);
    const bad=r.rows.map((row,i)=>({row:${START_ROW}+i, val:row[0]||''})).filter(x=>!ok.has(x.val));
    console.log(JSON.stringify(bad));
  ")

if [ "$BAD" != "[]" ]; then
  echo "[CRITICAL] 컬럼 꼬임 감지: $BAD" >&2
  exit 2
fi
```

### Rollback 정책
- **신규 삽입 행**: `deleteRows` API로 삭제 + fail 반환
- **기존 수정 행**: 삭제 금지 (원본 데이터 손실). fail 반환 + 수동 복구 안내
- `step_result.json`: `{"status":"fail","error":"column_corruption","bad_rows":[...]}`

### 비용
range 1회 호출 ~200~400토큰. 전체 재읽기의 5% 이하.

---

## S4. 토큰 만료 범용 감지 (재시도 금지)

### 감지 패턴 (stderr)
```
OAuth | invalid_grant | token expired | 401 Unauthorized | UNAUTHENTICATED | invalid_token
```

### 대응
- **재시도 금지** (재시도해도 동일 에러)
- 사용자에게 "OAuth 토큰 만료 감지 — 재인증 후 재개" 안내
- 파이프라인 중단 시 `state.json`에 현재 STEP 보존 → 재인증 후 재개 가능

### 적용 대상
모든 STEP (Claude API 토큰 + Google API 토큰).

### 구현
`pipeline_retry.sh`가 토큰 관련 패턴 감지 시 즉시 exit 10 반환. 팀장은 exit 10 수신 시 사용자 안내 후 중단.

---

## S5. 비용 폭주 방지 장치

### 배치 크기 상한
한 번에 최대 **10개** Confluence URL. 초과 시 초기화에서 중단 → 사용자에게 분할 실행 안내.

### STEP별 고정 추정치 (2026-04 기준, Claude 4.X 가격)

| STEP | 모델 | effort | 평균 입력 토큰 | 평균 출력 토큰 | 추정 비용 |
|---|---|---|---|---|---|
| STEP 1 | Opus 4.7 | medium | 15k | 20k | **$2.80** |
| STEP 2 | Opus 4.7 | low | 8k | 3k | **$0.70** |
| STEP 3 | Sonnet 4.6 | — | 10k | 8k | **$0.18** |
| STEP 4 | Haiku 4.5 | — | 10k | 15k | **$0.08** |
| STEP 5 | Sonnet 4.6 | — | 20k | 5k | **$0.15** |
| STEP 6 | Haiku 4.5 | — | 15k | 5k | **$0.05** |
| STEP 7 | Sonnet 4.6 | — | 25k | 8k | **$0.21** |
| 팀장 | Opus 4.7 | low | ~30k | ~10k | **$0.60** |

**한 기능당 총 추정**: ~**$4.77** (팀장 포함, STEP 3 스킵 시 ~$4.59)

### 누적 비용 추적
각 STEP 완료 후 `$SPECS/[기능명]/cost.log`에 append:
```
2026-04-20 10:15 | STEP 1 | opus --effort medium | $2.80
2026-04-20 10:52 | STEP 2 | opus --effort low    | $0.70
...
```

### 임계값
- **배치 누적 $30 초과** → 사용자 확인 (약 7개 기능 전후)
- **단일 기능 $10 초과** → 루프 의심, 즉시 중단

### 실측 대체
Claude CLI가 `usage` 정보 반환하면 실측치로 대체, 아니면 위 고정 추정치 사용.
가격 기준: Opus 4.7 input $15/Mtok, output $75/Mtok.

---

## S6. 에러 유형별 재시도 전략

### 분류 테이블

| 에러 유형 | 감지 패턴 | 재시도 | Backoff | 처리 |
|---|---|---|---|---|
| 쿼터 초과 | 429, Quota, rateLimit, 503 | 3회 | 30/60/120초 | S1 적용 |
| 토큰 만료 | OAuth, invalid_grant, 401 | **0회** | 즉시 중단 | S4 적용 |
| 네트워크 일시오류 | ETIMEDOUT, ECONNRESET, 500, 502 | 2회 | 10/30초 | — |
| Confluence MCP 실패 | MCP error, getConfluencePage failed | 1회 | 15초 | — |
| 타임아웃 (Bash) | CLI 무응답 | 1회 | 즉시 | — |
| 기타 exit ≠ 0 | 위 외 전부 | 1회 | 즉시 | — |

### 구현
`pipeline_retry.sh`가 stderr 패턴 매칭 → 유형별 자동 분기.

### 재시도 로그
재시도별 stderr 파일 분리:
- 첫 시도: `step[N]_stderr.log`
- 1회 재시도: `step[N]_stderr_retry.log`
- 2회 재시도: `step[N]_stderr_retry2.log`
- 3회 재시도: `step[N]_stderr_retry3.log`

→ 재시도마다 원인이 달라도 사후 분석 가능.

---

## S7. Heartbeat 관측성 (사후 분석 + 재개 지원용)

### 설계 원칙
Bash 툴은 포그라운드 실행. 팀장은 CLI 완료 전엔 progress.log를 읽을 수 없음.
→ **실시간 모니터링용이 아니다.** 아래 2가지 용도로만 사용.

### 용도 1 — CLI 완료 후 사후 분석
- 각 STEP 종료 직후 팀장이 `progress.log` tail 읽어 실행 흐름 요약 → 사용자 최종 보고에 포함
- 실패 시 마지막 체크포인트를 `stderr.log`와 교차 분석해 원인 특정

### 용도 2 — 재개 시 마지막 마일스톤 확인
- 파이프라인 중단 후 재개 시 `progress.log` 마지막 라인으로 진행 위치 확인
- `step[N]_result.json` 미생성 상태(중간 크래시)에서도 대략적 재개 지점 판단 가능

### 형식
```
[2026-04-20 10:15:32] STEP 1 | tc-designer-v2 | analysis.md Part B 작성 중 (3/8)
```

### 구현 규칙
- 팀원 에이전트는 주요 마일스톤(5~10개) 도달 시 한 줄씩 append
- 파이프라인 **재실행 시** `progress.log`를 `progress_TIMESTAMP.log`로 rotate 후 신규 생성
- 파일 락 불필요 (팀원은 순차 실행)

### 팀원별 체크포인트 (권장)
- STEP 1 (designer): 이미지 분석, Part A/B/C 각 시작, 자체 검증, 업로드
- STEP 2 (설계검수): analysis/design 읽기, C-01~C-10, Pass Gate, 저장
- STEP 4 (writer): 탭 삭제, TC JSON 조립, 업로드, 서식, 스냅샷
- STEP 5 (reviewer): 스냅샷 읽기, EVAL 각, 처방 작성, 저장
- STEP 6 (fixer): 리뷰 읽기, CRITICAL~LOW 각, 배치 쓰기, 자체 검증(S3), 스냅샷
- STEP 7 (리뷰2수정2): 1단계 TC 읽기, EVAL, 회귀 검사, 1단계 저장, 2단계 수정, 서식

---

## 부록 — 우선순위 매핑 (팀장 의사결정용)

| 상황 | 1순위 액션 | 2순위 |
|---|---|---|
| 쿼터 429 감지 | S1 backoff 시작 | 3회 실패 → exit 11 보고 |
| 토큰 만료 감지 | S4 즉시 중단 | 사용자 재인증 안내 |
| STEP 4 크래시 | S2 백업에서 복원 | 사용자 확인 후 복원 결정 |
| 컬럼 꼬임 감지 | S3 rollback + fail | 수동 복구 안내 |
| 타임아웃 | 1회 재시도 | 실패 시 중단 |
| MCP 실패 | 15초 후 1회 재시도 | 실패 시 사용자에게 Confluence 접근 확인 요청 |
