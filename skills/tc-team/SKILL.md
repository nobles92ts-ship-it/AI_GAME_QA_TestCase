---
name: tc-team
description: TC 파이프라인 tc-team 실행 — 기획서(Confluence) + 스프레드시트 링크를 받아 S0~S7을 메인 세션이 드라이버로 오케스트레이션해 라이브 시트 탭에 TC를 생성. "LLM은 문장·판단만, 결정론 코드가 구조·게이트·커버리지 원장 소유". 규칙 md는 rules\ 서랍이 정본. 트리거 "tc-team으로 진행/만들어줘", "/tc-team", 또는 스프레드시트+Confluence 링크와 함께 tc-team 지정. 기존 탭 보존(신규 탭 또는 소유 재기록).
user-invocable: true
allowed-tools: Read, Write, Edit, Bash, Workflow, Agent, mcp__google-sheets__get_sheet_data
---

# tc-team — 결정론 TC 파이프라인 드라이버

## 이 스킬이 하는 일 (+ 정직한 범위)

기획서 원문 → 라이브 시트 TC 세트를 **결정론 백본 + LLM 팬아웃**으로 생성한다. 2레인 원칙: **LLM은 문장·판단만**(설계·F열 문장화·리뷰·판정), **결정론 코드가 구조·사실**(골격·번호·서식·게이트·커버리지 원장·시트 기록). 시트는 전 게이트 통과 후 **딱 1회** 접촉한다.

- **드라이버 = 메인 세션.** node 유틸 실행·파일 preflight·카운터/마커·Workflow/agent 호출·MCP를 메인이 소유한다. Workflow 스크립트는 fs/node 접근 불가(계약) — 경로·해시·청크는 메인이 계산해 `args`로 주입한다.
- **정직한 상태**: S1(설계)·S3(문장화)·S4(리뷰·판정)은 LLM 단계(agent/Workflow). S2·S5·S6·S7은 결정론 코드. 단일 무인 커맨드가 아니라 **메인 세션이 단계를 순차 실행**하는 반자동 런북이다(완전 무인 드라이버는 로드맵).
- **검증 실적**: 자동사냥·주변감지·월드맵 3기능 라이브 완주. 코어 유틸 12종 + 유닛 테스트 GREEN(`node tc-team/test/run_all.js`).
- 상세 설계/트러블슈팅: `{PROJECT_ROOT}\tc-team\docs\tc-team-driver.md`(운영 정본)·`tc-team-guide.html`(아키텍처).

## 트리거

- 스프레드시트 링크 **+** Confluence 링크(또는 기획서 파일)를 함께 주며 tc-team 지정 → 시작.
- Confluence만 있고 스프레드시트가 없으면 **거부**(시트 링크 요청 후 대기) — v2와 동일 규칙.
- "처음부터" 지정 시 `specs/<기능>/`의 기존 산출물 초기화(원문·설정 보존).
- 동명 탭/specs가 이미 있으면 **신규 접미사(_v2, _v3…)** 로 생성, 기존 보존.

## 경로 (하드코딩 금지 — 변수로)

```bash
NODE="{NODE_PATH}"
TCTEAM="{PROJECT_ROOT}/tc-team"          # lib/ workflows/ scripts/ test/ docs/ (구 tc_v3 — 07-27 개명)
LIB="$TCTEAM/lib"
WF="$TCTEAM/workflows"                          # tcteam-s3-fmap.js · tcteam-s4-review.js
UTIL="{PROJECT_ROOT}/scripts/util"    # 공용 설비(이주·복사 금지 — 코드 포크 방지): direct_convert.js · update_dashboard.js · add_project_info.js · apply_labeling.js · upload_md_to_drive.js · run-agent.sh (+인증토큰)
RULES="{CLAUDE_SKILLS_DIR}/tc-team/rules"   # 지시서 서랍(md 정본) — tc-분석·tc-설계·tc-설계검수·tc-대조·tc-생성·tc-학습·라벨링_기준·완료처리 (07-27 v2에서 복사, v2 폴더는 동결)
SPEC="{PROJECT_ROOT}/team/specs/<기능명>"   # confluence_raw.md · analysis.md · tc_design.md · _labels.json
WORK="$SPEC"                                    # 작업장 = SPEC 단일 경로 (07-29 통합, 구 $TCTEAM/runs/<기능명> 폐지). 중간 산출물도 specs/<기능명>/에 남는다
SHEET="<스프레드시트 ID>"                      # 하드코딩 금지, 링크에서 추출
TAB="<기능명>"                                 # 베이스 탭명(점유 시 자동 _vN)
FEATURE_NAME="<기능명>"                        # specs/드라이브 폴더명 — sheet_info.txt와 일치, TAB과 달리 _vN 미부착
```

## 실행 순서 (S0 → S7)

각 스테이지는 **게이트 통과 시에만** 다음으로 진행. 실패 시 §게이트·실패 처리 참조.

### S0 — 준비 (메인)
0. **실행락(A정책 준용, 이관감사 M-049)**: `team/.pipeline.lock`에 epoch 기록. 기존 락 발견 시 — 사용자 트리거면 항상 해제 후 재획득(차단 없음), 신선 락(<180분)이면 "고아/동시 실행 가능성" 경고 1줄만(Loki `!tc-team` 비동기 경로 대비). S7 완료·중단 시 해제.
1. Confluence 본문 fetch → `$SPEC/confluence_raw.md` (verbatim 저장). `sheet_info.txt`에 SHEET_ID/TAB_NAME/CONFLUENCE_URL/FEATURE_NAME 기록.
   - **저장 직후 자가검증 3항목**(이관감사 M-050): 크기 ≥1KB · 본문 이미지 참조 개수 일치 · 절단 흔적 없음 — 실패 시 재fetch 1회, 재실패 시 파이프라인 시작 금지+사용자 보고.
   - **미수집 명시 의무**(M-051): 자식/링크 페이지·첨부·댓글은 기본 미수집 — 파일 상단에 `[미수집: …]` 메타 기록, 착수 보고에 포함.
2. **입력 게이트(2차 안전망)**: `confluence_raw.md` < 500B면 중단(fetch 재확인). 1의 자가검증(≥1KB)이 선행 상위 가드라 정상 경로에선 항상 통과 — 자가검증을 우회한 수동 배치/재개 경로 대비 하한 방어선으로 유지(이관감사 R2-②).
3. ~~Slack 착수 공지~~ — **여기서 보내지 마라**(중복 방지, 07-23). 착수 공지는 S1의 `run_pipeline_s1only.sh`가 시작 시 `send_slack_tc_request.js`로 **결정론적으로 1회** 발화한다(라인 127). 과거엔 S0(여기)에서도 보내 "TC 생성 요청 접수" 카드가 Slack에 2번 노출됨. 결정론 코드가 소유하는 side-effect이므로 LLM 단계에서 중복 발화 금지.

### S1 — 설계 (LLM · opus)
기획서 → `analysis.md` + `tc_design.md`. v2 설계기 승계(SSoT + tc-학습 P-18/19/20/22/23). 재실행 시 design_hash 일치하면 스킵.
```bash
bash "$TCTEAM/scripts/run_pipeline_s1only.sh" --feature <기능명> --sheet-id "$SHEET" --conf-url "<URL>"
# 산출: $SPEC/analysis.md, $SPEC/tc_design.md (+ dxr_crossref.json crossref on일 때)
```
> `run_pipeline_s1only.sh` = 설계 체인(설계→검수→수정→대조주입) 전용 스크립트 — **tc-team 소유**(`$TCTEAM/scripts`, 07-27 이주). 내부 에이전트: tc-team-designer · tc-team-설계검수 · tc-team-대조 (규칙은 전부 rules 서랍 참조 — v2 비의존).

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
`Workflow({ scriptPath: "<TCTEAM>/workflows/tcteam-s3-fmap.js", args: { workdir: "<WORK>", ranges: <s3_ranges.ranges> } })`
④ 완료 통지 후 **journal에서 fmap 조립**(각 청크 result.rows 합치기 → `$WORK/tc_f_map.json`), 그 다음:
```bash
"$NODE" "$UTIL/direct_convert.js" merge "$WORK"          # idx·d echo·해시·개수 게이트 → $WORK/tc_data.json
"$NODE" "$LIB/snapshot_local.js" "$WORK/tc_data.json" "$WORK/tcteam_snapshot.json" "$TAB"   # 7열→10열 로컬 스냅샷
"$NODE" "$LIB/content_gate.js" "$WORK/tcteam_snapshot.json"  # 콘텐츠 위반 0 확인(경고는 통과)
```

### S4 — 적대 리뷰 + 판정 (LLM) + 커버리지 원장
```bash
# 렌즈 입력 tc_design.md는 $WORK=$SPEC이라 이미 제자리 (07-29 경로 통합 — 구 cp 제거)
# 결정론 후보 추출 2종 (2026-07-28 신설 — 비차단, 렌즈·판정자 입력)
"$NODE" "$LIB/dup_gate.js" "$WORK/tcteam_snapshot.json" --out "$WORK/dup_report.json"          # exact=확정 중복 / similar=후보. exit 1=exact 있음
"$NODE" "$LIB/origin_gate.js" "$WORK/tcteam_snapshot.json" "$SPEC/confluence_raw.md" --out "$WORK/origin_report.json"  # 원문 미근거 후보. exit 3=후보 있음
cp "$TCTEAM/docs/eval_digest.md" "$WORK/eval_digest.md"    # EVAL 렌즈 기준 배치 (이관감사 M-023)
L="$RULES/tc-학습.md"; [ -f "$L" ] && cp "$L" "$WORK/tc-학습.md"   # 재발 패턴 렌즈 입력 (M-024, 없으면 스킵 — rules 서랍 정본, 07-27 이사)
```
① **Workflow 팬아웃** — `Workflow({ scriptPath: "<TCTEAM>/workflows/tcteam-s4-review.js", args: { workdir: "<WORK>" } })`
   (3렌즈: 구조·품질·원문대조 병렬 → 판정자 상호반박 → fix_plan)
② 완료 후 **journal에서 fix_plan 추출** → `$WORK/fix_plan.json`.
③ **커버리지 원장**(레버②): general-purpose agent로 rules→tc_ids 의미 매핑 → `$WORK/coverage.json` + `$WORK/exclusions.json`. **'추후구현'은 제외 사유 불가(이관감사 M-021)** — 반드시 TC로 전개하고 J='추후 구현'·H/I=N/A(v2 tc-생성 규칙 승계), 미커버면 S5 봉합 루프가 add_row로 생성.

> **형식 계약**(2026-07-29 명문화 — 이전엔 명세가 없어 에이전트가 래퍼/서술형으로 써서 traceability가 TypeError로 정지했다):
> - `coverage.json` = **순수 배열** `[{rule_id, tc_ids:[숫자,...]}]` (또는 `{rule_id: [tc_id,...]}` 맵).
> - `exclusions.json` = **순수 배열** `[{rule_id, reason}]`. `reason`은 **정확값 3종만** — `타기획서` / `비TC성서술` / `중복규칙`. 서술형 문구는 `badExclusion`으로 게이트 FAIL이니 근거 문장은 별도 `note` 필드에 담아라.
> - `{coverage:[...]}` / `{exclusions:[...]}` 래퍼는 traceability가 벗겨주지만(관용), 산출은 순수 배열로 통일할 것.
> - ⚠ **봉합 add_row 후에는 A열이 재번호되므로 원장의 tc_ids가 stale이 된다.** 산술 리맵 금지(SKILL.md S5 주석) — 조인 키는 `대분류+소분류+검증단계+F열` 전체를 써라(기본기능 섹션이 QA 섹션 문장을 재기술하므로 소분류+F만으로는 중복 매칭된다). 신규 행을 F열 부분일치로 찾는 것도 금지(다른 행에 같은 표현이 있으면 오탐). 불확실하면 확정본 기준으로 원장을 재생성하는 편이 안전하다.

### S5 — 적용 + 게이트 (결정론)
```bash
"$NODE" "$LIB/apply_fix_plan.js" "$WORK/tcteam_snapshot.json" "$WORK/fix_plan.json" "$WORK/tcteam_tc_final.json" --ledger "$WORK/applied_patches.json"   # before-일치·앵커 실존·충돌=거부
"$NODE" "$LIB/regroup.js" "$WORK/tcteam_tc_final.json" "$WORK/tcteam_tc_final.json"   # 그룹 연속성 봉합(V-17)
"$NODE" "$LIB/content_gate.js" "$WORK/tcteam_tc_final.json"                        # 차단 게이트(위반 0 필수)
"$NODE" "$LIB/dup_gate.js" "$WORK/tcteam_tc_final.json" --out "$WORK/dup_report_final.json"   # 차단: F열 완전 동일 잔존 시 exit 1
"$NODE" "$LIB/traceability.js" "$WORK/slices.json" "$WORK/coverage.json" "$WORK/exclusions.json" "$WORK/traceability.json"   # 미커버=FAIL → 봉합 루프(add_row fix_plan) 후 재기록
# 통과 시: touch $WORK/tc_final.ok  (없는 tc_final = S5 재실행 신호)
```
> ⚠ 원장 봉합으로 add_row 후 regroup이 행을 재배치하면 **id 산술 리맵 금지** — pre 스냅샷 재구성 + 내용(E+F) 조인으로 old→new 매핑(드라이버 문서 "id 리맵 규칙" 참조).

### S6 — 라이브 기록 (결정론 · 시트 1회 접촉)
```bash
"$NODE" "$LIB/sheet_write.js" "$WORK/tcteam_tc_final.json" "$SHEET" "$TAB" "$WORK"
# 소유마커 기반: 신규 생성 / 우리 소유 시 clear-and-rewrite(멱등) / 남의 탭 점유 시 _vN 접미사. 타 탭 불가침.
```
read-back QA: 재덤프로 A~G+J 0-diff + #ERROR! 시트 평가 확인.

### S7 — 완료처리 (공용 실행기 · 규칙서가 절차 소유)
**절차 SSoT: `$RULES/완료처리.md`** — 순서·패널 문구·FINAL-6 안내를 규칙서가 소유하고, **아래 실행기가 그것을 런타임에 읽어 실행**한다. Loki 풀체인도 똑같이 이 스크립트를 부르므로 두 경로의 동작이 일치한다(07-28 공용화). 여기 절차 중복 기재 금지.
```bash
bash "$TCTEAM/scripts/finalize.sh" --feature "$FEATURE_NAME" --sheet-id "$SHEET" --tab "<실제탭명>" --conf-url "<URL>"
# exit 0=전 단계 성공 / 20=일부 단계 실패(try/continue 정책 — 계속 진행, 보고에 ✗ 기재) / 1=인자 오류
# 출력 말미의 [FINALIZE] 요약과 FINAL-6 안내 2줄을 완료 보고에 그대로 포함
```
드라이버 고유 뒷정리(규칙서 범위 밖):
```bash
# state.json: state_projection.js로 done 기록 (모니터·알림 소비)
```
실행락 해제: `team/.pipeline.lock` 삭제 (S0-0 대응 — R6-① 정합).
완료 보고는 **단계별 시간 포함**. 이미지 매칭·테스트 데이터 셋팅(선택) 각 1줄 안내(문구는 규칙서 FINAL-6).

## 게이트 · 실패 처리

| 게이트 | 위치 | 실패 시 |
|---|---|---|
| 입력 자가검증(≥1KB·이미지 수·절단 흔적) | S0 | 재fetch 1회 → 재실패 시 시작 금지 + 보고 (M-050, 상위 가드) |
| 입력 500B (2차 안전망) | S0 | 중단, fetch 재확인 — 자가검증 우회 경로 대비 하한 |
| design_gate exit 4 | S2 | 설계 결함 → S1 수정 루프(카운터 `tcteam_s2_attempts.txt`) |
| merge echo/해시/개수 | S3 | 시프트/타행수정 청크만 재실행(다른 청크 결과 유효) |
| apply before-불일치 | S5 | 거부가 정상 — fix_plan 재생성 |
| content_gate 위반 | S5 | 추상표현·무플래그 위임 차단 → 수정 후 재실행 |
| dup_gate exact | S5 | F열 완전 동일 잔존 → 병합(delete) 또는 조건 차이 명시 후 재실행. similar는 비차단(S4 판정) |
| traceability 미커버 | S5 | add_row 봉합 fix_plan → 재적용 → 재기록 |

> 모든 중단(stop_*) 경로에서도 `team/.pipeline.lock` 해제 후 종료 — S0-0 "완료·중단 시 해제"의 중단측 이행 (R7-①).

## 반드시 지킬 것
- **v2 원탭 불가침** — 소유마커 없는 탭은 절대 삭제·덮어쓰지 않음.
- **하드코딩 금지** — 시트 ID·경로는 링크/변수에서. Workflow 스크립트에 절대경로 넣지 말 것.
- **기획서 추론 금지** — 미확정 스펙은 임의 확정 대신 J열 "기획 확인 필요" 플래그(위임표현은 content_gate가 감시). 답변 회수 시 fix_plan 1패스로 확정 교체.
- **재기록 후 복원** — 규칙서(`$RULES/완료처리.md` §주의사항)의 FINAL-2·5 재실행 규칙 참조.
- **갱신 주의(이관감사 M-014)** — tc-team 소유 탭을 tc-updater(v2 갱신기)로 수정하면 `$WORK`의 coverage/slices 원장이 stale — 갱신 후 원장 재생성 전까지 traceability 재실행 금지, 갱신 완료 보고에 stale 경고 1줄 포함.
