# TC 팀 — 안정성 정책 상세 (S1~S7)

> ⚠️ 이 문서의 S1~S7은 **안정성 정책 번호**다 — `tc_v3/` 엔진의 파이프라인 스테이지(S1~S6)와 무관하다. 본 문서는 **현행 멀티에이전트 파이프라인**(오늘 설치·실행되는 경로)의 내부 안정성 설계를 다룬다.

> tc-팀-v2.md의 안정성 정책 상세 구현을 담는 SSoT.
> 팀장 md에는 요약 매핑만 두고, 상세 구현/배경은 여기를 참조.
>
> **용어 개정 (2026-06-12)**: 구 STEP 5+6 → **STEP 5** / 구 STEP 7 → **STEP 6** (가드 P-step5·P-step6, 파일 step5_*·step6_*). 과거 기록·백업(.bak)·메모리의 옛 번호는 이 매핑으로 읽는다.

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
2026-04-17 사고: 한 기능의 TC 176~196(21개)에서 F열↔G열 뒤바뀜. 2차 리뷰까지 놓쳐 배포됨.

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

## S5. 폭주(런어웨이) 방지 장치

### 배치 크기 상한
한 번에 최대 **10개** Confluence URL. 초과 시 초기화에서 중단 → 사용자에게 분할 실행 안내.

### 재실행 폭주 방어 — attempts 가드 (실배선)
- STEP 4 max 3 / STEP 5 max 3 / STEP 6 max 3 — `step[N]_attempts.txt` 영속 카운터 (tc-팀-v2.md STEP 블록 참조)
- 상한 도달 시 state=failed 마킹 후 중단

### 비용 추적 — 미운영 (참조 금지)
- 과거 cost.log 기반 컷오프(단일/배치 임계)는 **쓰기 코드가 배선된 적이 없어** 2026-05-31 팀장-1ⓑ 결정으로 참조 제거됨 (본 문서 잔여 기술은 2026-06-10 정리).
- 옛 STEP별 비용 추정표(Opus 4.7 시절, STEP 4·6=Haiku 가정)도 현행 모델 정책(STEP 1 opus / STEP 2~7 sonnet)과 불일치라 삭제.
- 비용 가시성이 다시 필요하면 "run-agent.sh가 CLI usage 캡처 → cost.log append"를 **독립 기능으로 신규 구현**(팀장-1ⓐ안)할 것 — 코드 없이 문서만 선행하는 방식 금지(미배선 참조 재발 방지).

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
- STEP 2 (설계검수): analysis/design 읽기, C-01~C-13, Pass Gate, 저장
- STEP 4 (writer): 탭 생성, TC JSON 조립, 업로드, 서식, 스냅샷
- STEP 5 (reviewer): 스냅샷 읽기, EVAL 각, 처방 작성, 저장
- STEP 6 (fixer): 리뷰 읽기, CRITICAL~LOW 각, 배치 쓰기, 자체 검증(S3), 스냅샷
- STEP 6 (리뷰2수정2): 1단계 TC 읽기, EVAL, 회귀 검사, 1단계 저장, 2단계 수정, 서식

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

---

## 부록 2 — step_result.json 필드 계약 (에이전트별 필수 필드)

> 팀장 분기·가드가 참조하는 필드의 **단일 계약표**. 에이전트 .md의 결과 저장 예시와 이 표가 어긋나면 `ssot_drift_check.js`(검사 8번)가 적발한다.
> 배경: 2026-06-09 "설계검수 스키마 런마다 상이" — 에이전트 예시 JSON에 `analysis_gap` 누락이 구조적 원인이었음(F4-D5).

| STEP | 에이전트 | 필수 필드 | 팀장이 쓰는 곳 |
|---|---|---|---|
| 1 | tc-designer-v2 | status, analysis_parts(spec_hash 포함) | 성공 판정 / tc-updater 기준점 |
| 2 | tc-설계검수-v2 | status, total_issues, needs_fix, **analysis_gap** | STEP 3 트리거 + 모델 라우팅(opus 재분석/sonnet 수정) |
| 4 | tc-writer-v2 | status, tab_name, tc_count | 탭명 반영 / 보고 / 재개 분기 4 (Phase 3: 골격=direct_convert·F문장화=LLM·결과 저장=writer 세션이 종점에서 기재 — L3-4. 직변환 차단 시에도 fail을 반드시 기재) |
| 5 | tc-리뷰1수정1-v2 | status, **review_round=1**, total_issues, fixed_count, **added_count**(+deleted_count) — ⚠ `fix_round` 금지(I3) | STEP 6 precheck `--added-source`(I2) + P-step6 mtime 기준(step5_result.json) + 회귀 검사 범위 |
| 7 | tc-리뷰2수정2-v2 | status, **review_round=2**, total_issues, fixed_count | 완료 판정 + P-step6 가드 2차 마커(**review_round=2 단독** — I3) |

- 공통: 실패 시 `{"status":"fail","error":"..."}`.
- **공통 필수 `step` 필드 (L2P3-02, 2026-06-11)**: 모든 에이전트는 step_result.json에 자기 STEP 번호(`"step": 1/2/3/4/5/7` — designer는 핸드오프 `STEP:` 값)를 기재한다. transition.sh가 `--prev-step`과 대조해 불일치 시 복제 거부+rc=1 — silent exit가 이전 STEP 결과를 오염 복제하는 경로 차단.
- (구) STEP 5 qa-reviewer-v2 / STEP 6 tc-fixer-v2 행은 Phase 2-B 통합(2026-06-11)으로 폐지 — 에이전트 파일은 롤백 경로로 보존.
- **필드 추가/변경 시 4곳 동시 갱신**: ①해당 에이전트 .md 결과 저장 예시 ②이 표 ③`ssot_drift_check.js` CHECKS 8번 ④`transition.sh`(복제 success 가드·done 무결성 — Phase2-C).

---

## 부록 3 — V-항목/EVAL 기계화 커버리지 매핑표 (Phase1, 2026-06-11)

> 검증 룰 SSoT = `scripts/util/validate_tc_rows.js` (precheck·create_gsheet가 require로 공유 — 룰 분열 금지, D/A-7 기각 사유).
> 원칙: 기계 스크립트는 **판정불가 시 silent pass 금지** — llmFlags/notes로 명시 출력 (F4-A1 교훈).
> 새 룰 추가 시 2곳 동시 갱신: ①validate_tc_rows.js ②tests/run_tests.js GOOD/BAD 픽스처 (+이 표).

| 검증 항목 | 판정 주체 | 구현 위치 | 실행 시점 |
|---|---|---|---|
| V-01/02/07/08/09 (구조·ID수식·dedup표기·서식·H/I초기값) | ⚙ 구조 보장 | create_gsheet가 직접 생성 + validatePostWrite read-back | STEP 4 |
| V-03/04 (플랫폼·검증단계 enum — idx4↔5 스왑 검출 겸용) | ⚙ | validatePreWrite + validateFull | STEP 4 (업로드 전) |
| V-05 기계부 (추상표현·개행·**번호 다단계·태그 분리** — v8 사고 보강) / V-14 (Output Format) / V-22 (설계 태그) | ⚙ | validatePreWrite + validateFull | STEP 4 |
| V-07d (동일 내용 PC/모바일 분리쌍 — v8 사고 보강. 동일=HIGH 차단 / 유사=정당성 🧠) | ⚙+🧠 | validatePreWrite + validateFull / precheck EVAL-07 | STEP 4·6 |
| V-06/V-17 (그룹 분산 — fill-down 후 (B,C,D) 튜플 키) | ⚙ | validateFull / precheck EVAL-06 | STEP 4·5·6 |
| V-10/V-16 비율 (배분표 대조 — 미달+비고無=FAIL, 미달+비고有=LLM, 초과=합법) | ⚙+🧠 | validateFull(--design) / precheck EVAL-02 | STEP 4·5 |
| V-18 ①~④ (기본기능 B/G/I/키·인용 존재성) | ⚙ | validateFull / precheck EVAL-16 | STEP 4·5 |
| V-19 (J 화이트리스트 — 버그ID 패턴(PROJ-N), 리터럴 XXXX=위반) / V-20 (H/I=expectedHI) | ⚙ | validateFull / precheck EVAL-14·17 + create_gsheet 원천 생성 | STEP 4·6 |
| V-15/V-21 (복합문·"또는") | ⚙추출+🔁리뷰 위임 분류 | validateFull llmFlags(STEP 4=추출·보고만) → precheck 재생성 → 리뷰어 분류 | STEP 5·6 |
| V-11 (PC-only 적정성) | 🧠 writer LLM (유일 잔존 — 리뷰 EVAL에 대응 항목 없음) | writer 자가검증 (G=PC 행만 스캔) | STEP 4 |
| V-12·13 잔여 / V-18 ⑤ (인용 정확성) / V-23 ④ (셋업 일치) | 🔁 리뷰 위임 | precheck round1·2가 동일 룰로 재생성 → 리뷰어 판정 (**writer 직접 판정 폐지** — 한 보스 TC run 실측 14분 순수 중복, 2026-06-12) | STEP 5·6 |
| EVAL-01/03/07/09판단부/10/11/12/13 (커버리지·품질·교차 판단) | 🧠 LLM-only | 리뷰어 (precheck 결과의 llm_only_evals 목록) | STEP 5·6 |
| **직변환 골격** (B~E/G/J ↔ 설계 트리·기본기능 표 — Phase 3, fail-closed strict: 미인식 구문=blocker) | ⚙ | direct_convert.js convert (parseDesignTree/parseBasicTable — 룰 SSoT 동거) | **STEP 1·3 게이트(tc-설계.md Step 11.5) → STEP 2 C-14 → STEP 4 Step A0 (최후 안전망)** |
| **배분표 3자 동치** (트리 leaf=행별 재합산=생성 행수, 선언 합계 검산 — F2 행별 기준) + 복합문 leaf (F4) + 태그 화이트리스트 (F5) | ⚙ | checkAllotmentStrict + parseDesignTree (차단=conversion_blocker → STEP 3 재진입) | 동일 3단 (설계 게이트 → C-14 → Step A0) |
| **F맵 병합 정합** (idx·소분류 echo 시프트 검출 L4-F6 · 설계 해시 L3-3 · F열 위반 exit 5 분기 L2P3-05) | ⚙ | direct_convert.js merge | STEP 4 Step A |

- H/I 기대값은 `expectedHI(J, 플랫폼, 기본기능여부)` **단일 순수함수** — 생성(create_gsheet)·검증(validateFull)·리뷰(precheck)가 공유 (L4-01: 파생 로직 이중화 금지).
- **직변환 J 도출 (F1/L4-F2)**: leaf `[J:]` 태그 우선 → 본문 '미지정' 포함 시 '기획 확인 필요' 자동 부여 — writer LLM의 암묵 보정을 결정론으로 대체 (v9 골든 9=9 검증).
- tc_data.json은 **전 행 채움(full-fill) 계약** — dedup은 create_gsheet의 시트 표시 규칙 (L4-02).
- precheck rc≠0은 **비차단** — 리뷰어 LLM 전수 폴백 (tc-팀-v2.md 에러 처리표).
- **직변환 게이트 shift-left (F4 원안, 2026-06-11 v10 실측 반영)**: 동일 convert를 ①설계자 세션 내(tc-설계.md Step 11.5, exit 0까지 인라인 수정) ②STEP 2 C-14(이중 그물) ③STEP 4 Step A0(최후 안전망) 3단으로 실행. 근거 — 결함이 STEP 4까지 내려가면 왕복 1회당 CLI 부팅 3회 ≈ 15분(v10에서 왕복 2회 = +35분), 설계 세션 내 처리 시 0왕복.
- **F열 1차 문장화 기본기능 선반영 (L4-F8, 2026-06-12 보스 TC run 실측)**: V-18 ④⑤(GlobalDefine 키·큰따옴표 인용)를 검증 단계에만 두면 1차 문장화가 누락(기본 26행 중 24행) → Step A2 차단 → 재문장화 루프 14분. 규칙을 tc-생성.md **Step A ② 문장화 지시에 인라인** — 검증(--full)은 안전망으로 유지. ※ 룰 ID 표기: validate_tc_rows.js는 기본기능=`V-16`(EVAL-16 정렬)·비율=`V-16r`, tc-생성.md 체크리스트는 기본기능=V-18·비율=V-16 — 번호 상이는 기존 매핑(본 표 V-18 행) 참조.
- **F열 분할 생성 (L4-F9, 2026-06-12 보스 TC run(v2) 트랜스크립트 포렌식)**: STEP 4 silent exit(rc=0·stderr 0·부작용 0, 3런 중 2회) 근본 원인 확정 — tc_f_map을 단일 턴에 일괄 생성 → thinking이 출력 상한 32,000 토큰을 정확히 소진(`stop_reason: max_tokens`) → 재시도 턴도 99% thinking 소진 → CLI가 결과 없이 정상 종료. API 에러·컨텍스트 한계 아님. 처방: ①tc-생성.md Step A ② **25행 단위 part 분할 생성** ②팀장 **P1-2b 안전 재진입 분기**(4조건: step≠4·blocker 없음·snapshot 없음·시트 부작용 없음 → attempts 한도 내 재호출. blind 재호출 금지는 유지) ③pipeline_retry가 rc=0을 못 잡는 것은 설계 의도(시끄러운 실패 전용)로 확인.
- **silent exit 두 번째 패턴 (L4-F10, 2026-06-12 보스 TC run(v3) 트랜스크립트 포렌식)**: L4-F9로 max_tokens는 막았으나 **별도 패턴 확인** — tool_result 정상 수신 후 다음 어시스턴트 턴이 생성되지 않고 result 이벤트도 없이 CLI rc=0 종료 (stop_reason 정상=tool_use, 토큰 여유, stderr 0). STEP 4(part1 Write 직후)·STEP 5(서식 적용 단계) 양쪽에서 1회씩 발생 = F열 문장화/시트 쓰기 같은 다(多)턴 긴 작업 구간에서 확률적. **프롬프트로 차단 불가(인프라/-p 모드 레벨)** → 안전망이 유일한 처방: STEP 4=P1-2b 안전 재진입(4조건), STEP 5=P-step5 ⓑ 복구(라이브 무결 검증 후 서식·스냅샷·step_result 수동 보강). v3 런에서 둘 다 실전 작동해 무결 완주(115 TC). ⚠ ⓑ 복구는 라이브 시트가 ID연속·기계지표0·분포합산 일치일 때만 — 불일치 시 STEP4 스냅샷 롤백.
- **체인 blocker 재진입 배선 결함 + 구간 재개 (L4-F11, 2026-06-12 보스 TC run(v5) 실전 적발)**: run_pipeline.sh `run_step3()`가 `--prev-step 2`를 하드코딩 — review 경로(STEP 2 성공 후)만 상정. **blocker 경로(STEP 4 fail 후)에서 transition ①의 step 정체성 대조가 step=4 ≠ prev=2로 CRITICAL 정지** (blocker→STEP 3 루프의 체인 첫 실행에서 드러남). 처방: ①blocker 모드는 `--prev-step` 생략 — 직전 STEP이 fail이므로 success 복제·정체성 대조 대상이 아님 (정체성은 호출부가 step_result fail+conversion_blocker.json으로 이미 확인) ②정지 예외 후 **구간 재개 `--resume-from step3-blocker|step4|step5|step6|final`** 신설 — 시작 시퀀스(Slack 공지·designing 전환) 스킵, epoch 보존(진행시간 정직 누적), 앞 STEP 산출물은 specs 기존 파일 사용. 수동 폴백(팀장 md STEP별 블록)보다 우선. ⚠ 백그라운드 기동 시 `| tail` 파이프 금지 — exit code가 tail 것으로 바뀌어 정지를 완료로 오인 (v5 1차에서 실증).
