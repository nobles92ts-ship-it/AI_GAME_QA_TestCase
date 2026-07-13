---
name: tc-team
description: TC 파이프라인 tc-team(3세대 결정론 엔진) 실행 — 기획서(Confluence) + 스프레드시트 링크를 받아 S0~S7을 메인 세션이 드라이버로 오케스트레이션해 라이브 시트 탭에 TC를 생성. "LLM은 문장·판단만, 결정론 코드가 구조·게이트·커버리지 원장 소유". v2 대비 벽시계 2.2배 단축·발명수치 0·원장 100% 설명(콜드런 A/B, n=1). 트리거 "tc-team으로 진행/만들어줘", "/tc-team", 또는 스프레드시트+Confluence 링크와 함께 tc-team 지정. 기존 탭 보존(신규 탭 또는 소유 재기록). 검증된 v2 멀티에이전트 엔진은 /tc-v2로 병존.
user-invocable: true
allowed-tools: Read, Write, Edit, Bash, Workflow, Agent, mcp__google-sheets__get_sheet_data
---

# tc-team — 결정론 TC 파이프라인 드라이버 (3세대 엔진)

## 이 스킬이 하는 일 (+ 정직한 범위)

기획서 원문 → 라이브 시트 TC 세트를 **결정론 백본 + LLM 팬아웃**으로 생성한다. 2레인 원칙: **LLM은 문장·판단만**(설계·F열 문장화·리뷰·판정), **결정론 코드가 구조·사실**(골격·번호·서식·게이트·커버리지 원장·시트 기록). 시트는 전 게이트 통과 후 **딱 1회** 접촉한다.

- **드라이버 = 메인 세션.** node 유틸 실행·파일 preflight·카운터/마커·Workflow/agent 호출·MCP를 메인이 소유한다. Workflow 스크립트는 fs/node 접근 불가(계약) — 경로·해시·청크는 메인이 계산해 `args`로 주입한다.
- **정직한 상태**: S1(설계)·S3(문장화)·S4(리뷰·판정)은 LLM 단계(agent/Workflow). S2·S5·S6·S7은 결정론 코드. 단일 무인 커맨드가 아니라 **메인 세션이 단계를 순차 실행**하는 반자동 런북이다(완전 무인 드라이버는 로드맵).
- **사전 요건**(v2 파이프라인과 동일): 레포 clone + `setup.ps1`/`setup.sh` 설치 · Node.js · `npm run auth`(Google 인증) · `~/.claude/.mcp.json`(google-sheets MCP) · Claude Code `Workflow` 도구. v3는 v2와 **병존**하며, 검증된 v2 멀티에이전트 엔진은 **`/tc-v2`**로 그대로 사용 가능.
- **검증 실적**: 3개 실기능 라이브 완주. 코어 유틸 12종 + 유닛 테스트 GREEN(`node tc_v3/test/run_all.js`). v2 대비 콜드런 A/B(n=1): 벽시계 2.2배 단축·발명수치 0·원장 100% 설명.
- 아키텍처 상세: `tc_v3/docs/tc-v3-guide.html`.

## 트리거

- 스프레드시트 링크 **+** Confluence 링크(또는 기획서 파일)를 함께 주며 tc-team 지정 → 시작.
- Confluence만 있고 스프레드시트가 없으면 **거부**(시트 링크 요청 후 대기) — v2와 동일 규칙.
- "처음부터" 지정 시 `specs/<기능>/`의 기존 산출물 초기화(원문·설정 보존).
- 동명 탭/specs가 이미 있으면 **신규 접미사(_v2, _v3…)** 로 생성, 기존 보존.

## 경로 (하드코딩 금지 — 변수로)

> 아래 `{NODE_PATH}`·`{WORK_ROOT}`는 설치 스크립트(`setup.ps1`/`setup.sh`)가 실제 값으로 치환한다. `{WORK_ROOT}` = 레포 clone 위치.

```bash
NODE="{NODE_PATH}"                            # 설치 시 자동 치환
TCV3="{WORK_ROOT}/tc_v3"                       # lib/ workflows/ test/ docs/
LIB="$TCV3/lib"
WF="$TCV3/workflows"                          # tcv3-s3-fmap.js · tcv3-s4-review.js
UTIL="{WORK_ROOT}/scripts/util"               # direct_convert.js · run_pipeline.sh · update_dashboard.js · add_project_info.js · apply_labeling.js · upload_md_to_drive.js
SPEC="{WORK_ROOT}/team/specs/<기능명>"          # confluence_raw.md · analysis.md · tc_design.md · _labels.json
WORK="$TCV3/runs/<기능명>"                    # 이 실행의 작업장(파일 산출물, 재현/감사 가능). mkdir -p
SHEET="<스프레드시트 ID>"                      # 하드코딩 금지, 링크에서 추출
TAB="<기능명>"                                 # 베이스 탭명(점유 시 자동 _vN)
```

## 실행 순서 (S0 → S7)

각 스테이지는 **게이트 통과 시에만** 다음으로 진행. 실패 시 §게이트·실패 처리 참조.

### S0 — 준비 (메인)
1. Confluence 본문 fetch → `$SPEC/confluence_raw.md` (verbatim 저장). `sheet_info.txt`에 SHEET_ID/TAB_NAME/CONFLUENCE_URL/FEATURE_NAME 기록.
2. **입력 게이트**: `confluence_raw.md` < 500B면 중단(fetch 재확인).
3. Slack 착수 공지(선택): `"$NODE" "$UTIL/send_slack_tc_request.js" --items <items.json> --sheet <시트URL> --dedup-dir "$SPEC/.."` (Slack 미구성 시 실패=비차단 경고).

### S1 — 설계 (LLM · opus)
기획서 → `analysis.md` + `tc_design.md`. v2 설계기 승계(SSoT + 학습 패턴 주입). 재실행 시 design_hash 일치하면 스킵.
```bash
bash "$UTIL/run_pipeline_s1only.sh" --feature <기능명> --sheet-id "$SHEET" --conf-url "<URL>"
# 산출: $SPEC/analysis.md, $SPEC/tc_design.md (+ crossref.json — crossref 활성 시)
```
> `run_pipeline_s1only.sh` = `run_pipeline.sh`의 STEP 1~3.5(설계·검수·수정·대조주입)만 실행하고 조기 종료하는 사본. 없으면 `head -275 run_pipeline.sh + 'exit 0'`으로 생성.

### S2 — 격리 게이트 + 슬라이스 (결정론)
```bash
mkdir -p "$WORK"
"$NODE" "$LIB/design_gate.js" "$SPEC/tc_design.md"        # exit 0=전개가능 / 4=설계결함(→S1 수정 루프) / 1=오류
"$NODE" "$LIB/slicer.js" "$SPEC/confluence_raw.md" "$WORK/slices.json"   # sections[]+rules[] (원장 앵커)
```

### S3 — 문장화 팬아웃 (결정론 골격 + LLM 문장 + 결정론 merge)
```bash
# ① 골격 생성 (결정론)
"$NODE" "$UTIL/direct_convert.js" convert "$SPEC/tc_design.md" "$WORK"   # → $WORK/tc_skeleton.json (N행)
# ② 청크 범위 계산 (25행 단위)
"$NODE" -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const n=s.rows.length;const R=[];for(let i=0;i<n;i+=25)R.push([i,Math.min(i+25,n)]);require("fs").writeFileSync(process.argv[2],JSON.stringify({n,ranges:R}))' "$WORK/tc_skeleton.json" "$WORK/s3_ranges.json"
```
③ **Workflow 팬아웃** — 메인이 Workflow 도구 호출:
`Workflow({ scriptPath: "<TCV3>/workflows/tcv3-s3-fmap.js", args: { workdir: "<WORK>", ranges: <s3_ranges.ranges> } })`
④ 완료 통지 후 **journal에서 fmap 조립**(각 청크 result.rows 합치기 → `$WORK/tc_f_map.json`), 그 다음:
```bash
"$NODE" "$UTIL/direct_convert.js" merge "$WORK"          # idx·d echo·해시·개수 게이트 → $WORK/tc_data.json
"$NODE" "$LIB/snapshot_local.js" "$WORK/tc_data.json" "$WORK/v3_snapshot.json" "$TAB"   # 7열→10열 로컬 스냅샷
"$NODE" "$LIB/content_gate.js" "$WORK/v3_snapshot.json"  # 콘텐츠 위반 0 확인(경고는 통과)
```

### S4 — 적대 리뷰 + 판정 (LLM) + 커버리지 원장
```bash
cp "$SPEC/tc_design.md" "$WORK/tc_design.md"             # 렌즈 입력 배치 (slices.json은 S2에서 이미 $WORK)
```
① **Workflow 팬아웃** — `Workflow({ scriptPath: "<TCV3>/workflows/tcv3-s4-review.js", args: { workdir: "<WORK>" } })`
   (3렌즈: 구조·품질·원문대조 병렬 → 판정자 상호반박 → fix_plan)
② 완료 후 **journal에서 fix_plan 추출** → `$WORK/fix_plan.json`.
③ **커버리지 원장**(레버②): general-purpose agent로 rules→tc_ids 의미 매핑 → `$WORK/coverage.json` + `$WORK/exclusions.json`(제외 사유 4종: 추후구현·타기획서·비TC성·중복).

### S5 — 적용 + 게이트 (결정론)
```bash
"$NODE" "$LIB/apply_fix_plan.js" "$WORK/v3_snapshot.json" "$WORK/fix_plan.json" "$WORK/v3_tc_final.json" --ledger "$WORK/applied_patches.json"   # before-일치·앵커 실존·충돌=거부
"$NODE" "$LIB/regroup.js" "$WORK/v3_tc_final.json" "$WORK/v3_tc_final.json"   # 그룹 연속성 봉합(V-17)
"$NODE" "$LIB/content_gate.js" "$WORK/v3_tc_final.json"                        # 차단 게이트(위반 0 필수)
"$NODE" "$LIB/traceability.js" "$WORK/slices.json" "$WORK/coverage.json" "$WORK/exclusions.json" "$WORK/traceability.json"   # 미커버=FAIL → 봉합 루프(add_row fix_plan) 후 재기록
# 통과 시: touch $WORK/tc_final.ok  (없는 tc_final = S5 재실행 신호)
```
> ⚠ 원장 봉합으로 add_row 후 regroup이 행을 재배치하면 **id 산술 리맵 금지** — pre 스냅샷 재구성 + 내용(E+F) 조인으로 old→new 매핑(아키텍처 가이드 "id 리맵 규칙" 참조).

### S6 — 라이브 기록 (결정론 · 시트 1회 접촉)
```bash
"$NODE" "$LIB/sheet_write.js" "$WORK/v3_tc_final.json" "$SHEET" "$TAB" "$WORK"
# 소유마커 기반: 신규 생성 / 우리 소유 시 clear-and-rewrite(멱등) / 남의 탭 점유 시 _vN 접미사. 타 탭 불가침.
```
read-back QA: 재덤프로 A~G+J 0-diff + #ERROR! 시트 평가 확인.

### S7 — 완료처리 (결정론 · 기존 유틸)
```bash
( cd "$UTIL" && "$NODE" update_dashboard.js "$SHEET" )                 # FINAL-1 대시보드(숨김탭 제외)
"$NODE" "$UTIL/add_project_info.js" "$SHEET" "<실제탭명>" "<URL>"      # FINAL-2 K~O 패널
# FINAL-5 라벨링: 5a 도출(agent) → $SPEC/_labels.json → 5b 기재
"$NODE" "$UTIL/apply_labeling.js" "$SHEET" "<실제탭명>" "$SPEC/_labels.json"
# FINAL-3 드라이브 sync(신규 파일만 — 통재sync는 타임스탬프 중복 생성이라 금지)
# state.json: state_projection.js로 done 기록 (모니터·알림 소비)
```
완료 보고는 **단계별 시간 포함**. 이미지 매칭(선택) 1줄 안내.

## 게이트 · 실패 처리

| 게이트 | 위치 | 실패 시 |
|---|---|---|
| 입력 500B | S0 | 중단, fetch 재확인 |
| design_gate exit 4 | S2 | 설계 결함 → S1 수정 루프(카운터 `v3_s2_attempts.txt`) |
| merge echo/해시/개수 | S3 | 시프트/타행수정 청크만 재실행(다른 청크 결과 유효) |
| apply before-불일치 | S5 | 거부가 정상 — fix_plan 재생성 |
| content_gate 위반 | S5 | 추상표현·무플래그 위임 차단 → 수정 후 재실행 |
| traceability 미커버 | S5 | add_row 봉합 fix_plan → 재적용 → 재기록 |

## 반드시 지킬 것
- **기존 탭 불가침** — 소유마커 없는 탭은 절대 삭제·덮어쓰지 않음.
- **하드코딩 금지** — 시트 ID·경로는 링크/변수에서. Workflow 스크립트에 절대경로 넣지 말 것.
- **기획서 추론 금지** — 미확정 스펙은 임의 확정 대신 J열 "기획 확인 필요" 플래그(위임표현은 content_gate가 감시). 답변 회수 시 fix_plan 1패스로 확정 교체.
- **재기록 후 복원** — clear-and-rewrite는 탭 재생성이므로 S7의 K~O 패널·라벨을 재실행.
