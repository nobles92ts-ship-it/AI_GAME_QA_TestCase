---
name: tc-team
description: TC 파이프라인 tc-team 실행 — 기획서(Confluence) + 스프레드시트 링크를 받아 S0~S7을 메인 세션이 드라이버로 오케스트레이션해 라이브 시트 탭에 TC를 생성. "LLM은 문장·판단만, 결정론 코드가 구조·게이트·커버리지 원장 소유". 규칙 md는 rules\ 서랍이 정본. 트리거 "tc-team으로 진행/만들어줘", "/tc-team", 또는 스프레드시트+Confluence 링크와 함께 tc-team 지정. 기존 탭 보존(신규 탭 또는 소유 재기록).
user-invocable: true
allowed-tools: Read, Write, Edit, Bash, Workflow, Agent
---

# tc-team — 결정론 TC 파이프라인 드라이버

## 이 스킬이 하는 일 (+ 정직한 범위)

기획서 원문 → 라이브 시트 TC 세트를 **결정론 백본 + LLM 팬아웃**으로 생성한다. 2레인 원칙: **LLM은 문장·판단만**(설계·F열 문장화·리뷰·판정), **결정론 코드가 구조·사실**(골격·번호·서식·게이트·커버리지 원장·시트 기록). 시트는 전 게이트 통과 후 **딱 1회** 접촉한다.

- **드라이버 = 메인 세션.** node 유틸 실행·파일 preflight·카운터/마커·Workflow/agent 호출·MCP를 메인이 소유한다. Workflow 스크립트는 fs/node 접근 불가(계약) — 경로·해시·청크는 메인이 계산해 `args`로 주입한다.
- **정직한 상태**: S1(설계)·S3(문장화)·S4(리뷰·판정)은 LLM 단계, S2·S5·S6·S7은 결정론 코드. **무인 완주가 된다** — `run_pipeline_full.sh` 가 S1~S7 을 한 호출로 돌린다(2026-07-28 배선, Loki `!tc-team` 과 같은 경로). LLM 단계는 Workflow 도구 대신 `run-agent.sh(claude -p)` 로 팬아웃하고, S3 문장화 규칙·S4 렌즈는 `workflows/*.js` 에서 **런타임 추출**하므로 사본 드리프트가 0이다. 아래 S0~S7 서술은 그 체인의 명세이자 구간 재개·디버깅용 수동 폴백이다. (구 문구 "완전 무인 드라이버는 로드맵"은 2026-07-31 폐기 — 그 문장 때문에 실제로 한 런을 통째 손으로 몰았다)
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

## 표준 실행 — 단일 호출 무인 완주 ⭐

S0(원문 fetch + `sheet_info.txt` 기록)만 드라이버가 하고, 나머지는 이 한 줄이다.

```bash
bash "$TCTEAM/scripts/run_pipeline_full.sh" --feature "$FEATURE_NAME" --sheet-id "$SHEET" --conf-url "<URL>"
```

- **중간 승인 없음.** 멈추는 곳은 `stop_integrity`(exit 14) 뿐 — S2 design_gate blocker · S3 변환/F열/content_gate 재위반 · S5 content·dup·미커버 봉합 실패 · S6 read-back 불일치. 그 앞에 자동 재시도가 먼저 돈다(S3 청크 재시도 · F열 교정 2라운드 · S5 미커버 자동 봉합).
- **실행락은 이 스크립트가 소유**하고 `trap EXIT` 로 완료·중단 모두에서 해제한다. 수동 폴백으로 몰 때만 드라이버가 S0-0에서 걸고 S7에서 푼다 — 잊으면 편집 가드가 유령 락을 "실행 중"으로 오독한다(2026-07-31 실사고).
- **완주 보고에 반드시 포함**: ①crossref 4분기 비율 ②조용한 미탐 배너 ③확신도 분포 ④산출물 크기 ⑤R3·R4 동시 기록 + **S4가 삭제·수정한 목록** ⑥**참조 문서 선수집(M-052) 결과** — `linked/` 파일 수 / 본문 참조 pageId 수, **둘이 어긋나면 그 사실을 보고에 쓴다**(참조 0건이면 "참조 없음"이라고 명시. 침묵 금지). 무인 런은 품질이 나빠도 전부 초록불로 끝나므로, 이 보고가 유일한 관측 창이다.

> 아래 S0~S7 수동 순서는 **디버깅·구간 재개용 폴백**이다. 처음부터 손으로 몰지 말 것 — 2026-07-31 런이 그렇게 돌아 벽시계 2h23m 중 기계 시간은 1h12m 뿐이었다.

## 실행 순서 (S0 → S7) — 체인 명세 & 수동 폴백

각 스테이지는 **게이트 통과 시에만** 다음으로 진행. 실패 시 §게이트·실패 처리 참조.

### S0 — 준비 (메인)
0. **실행락(A정책 준용, 이관감사 M-049)**: `team/.pipeline.lock`에 epoch 기록. 기존 락 발견 시 — 사용자 트리거면 항상 해제 후 재획득(차단 없음), 신선 락(<180분)이면 "고아/동시 실행 가능성" 경고 1줄만(Loki `!tc-team` 비동기 경로 대비). S7 완료·중단 시 해제.
   - ⚠ **이 락은 편집 가드 훅**(Claude 설정 폴더의 hooks 아래 tcteam-running-edit-guard — 프로젝트 밖이라 린터 대상 아님)**이 "실행 중" 판정에 쓰는 유일한 신호다.** 안 풀면 끝난 런 뒤에도 `tc-team/**/*.sh` 편집이 막힌다. **락은 런 전체가 소유한다** — `run_pipeline_full.sh` 는 `trap EXIT` 로 알아서 풀고, `run_pipeline_s1only.sh` 는 상위가 이미 잡았으면 건드리지 않고 단독 실행일 때만 잡았다 푼다. 수동 폴백으로 몰 때만 사람이 책임진다. (2026-07-31: 문서에 없던 두 번째 락 `specs/<기능>/.pipeline.lock`(구 v2 잔재)이 해제 코드 없이 9곳에 잔존해 있었고 가드가 그쪽을 보고 있었다 — 락 일원화 + 가드 정정 완료)
1. Confluence 본문 fetch → `$SPEC/confluence_raw.md` (verbatim 저장). `sheet_info.txt`에 SHEET_ID/TAB_NAME/CONFLUENCE_URL/FEATURE_NAME 기록.
   - **저장 직후 자가검증 3항목**(이관감사 M-050): 크기 ≥1KB · 본문 이미지 참조 개수 일치 · 절단 흔적 없음 — 실패 시 재fetch 1회, 재실패 시 파이프라인 시작 금지+사용자 보고.
   - **본문 참조 문서 1홉 선수집**(M-052, 2026-08-06): 본문이 가리키는 **같은 사이트 위키 페이지**를 각각 `$SPEC/linked/<pageId>_<제목>.md` 로 저장. 추출은 아래 명령 그대로:
     ```bash
     SELF=$(grep -oE 'pages/[0-9]+' "$SPEC/sheet_info.txt" | head -1 | cut -d/ -f2)
     tail -n +3 "$SPEC/confluence_raw.md" \
       | grep -oE 'https://<사이트>/wiki/(spaces/[^/ ")]+/pages/[0-9]+|x/[A-Za-z0-9_-]+)' \
       | sed -E 's#.*/pages/([0-9]+)#\1#; s#.*/x/([A-Za-z0-9_-]+)#\1#' \
       | sort -u | grep -vx "$SELF" | head -5
     ```
     ⚠ **markdown 링크(`[텍스트](url)`)만 찾으면 안 된다.** 실측(118 spec) — 참조 보유 31개 중 **27개가 `[](url)` 형태가 아니다**(smartlink·평문 URL). `[](url)`만 잡는 패턴은 **87%를 놓친다.** 위 명령은 URL 형태를 가리지 않고 pageId로 정규화한다.
     가드 5개 — ①같은 사이트만(외부 도메인·첨부/download URL 제외) ②**자기 페이지 제외**(`$SELF`) — 절 앵커 자기링크가 흔하다(세공 실측) ③**1홉만**(수집한 문서 안의 링크는 따라가지 않음) ④**상한 5건**(초과분은 미수집으로 기재) ⑤fetch 실패는 미수집 기재 후 계속(중단 금지).
     ⚠ **`confluence_raw.md`에 병합 금지** — 이 파일은 기획서 변경 감지의 diff 기준선이라, 참조 문서가 바뀔 때마다 본문이 바뀐 것으로 오탐한다. 사용 규칙은 `rules/tc-분석.md` §3.8.
   - **미수집 명시 의무**(M-051): 자식 페이지·첨부·댓글은 기본 미수집. **링크는 수집/미수집을 전수 기재** — `confluence_raw.md` 상단에 `[미수집: …]` + `[링크수집: <제목> → linked/<파일>]` 메타 기록, 착수 보고에 포함. 이 헤더가 선수집 이행 여부의 유일한 기계 판별식이다(`grep -c "^\[링크수집:"`).
2. **입력 게이트(2차 안전망)**: `confluence_raw.md` < 500B면 중단(fetch 재확인). 1의 자가검증(≥1KB)이 선행 상위 가드라 정상 경로에선 항상 통과 — 자가검증을 우회한 수동 배치/재개 경로 대비 하한 방어선으로 유지(이관감사 R2-②).
3. ~~Slack 착수 공지~~ — **여기서 보내지 마라**(중복 방지, 07-23). 착수 공지는 S1의 `run_pipeline_s1only.sh`가 시작 시 `send_slack_tc_request.js`로 **결정론적으로 1회** 발화한다(라인 127). 과거엔 S0(여기)에서도 보내 "TC 생성 요청 접수" 카드가 Slack에 2번 노출됨. 결정론 코드가 소유하는 side-effect이므로 LLM 단계에서 중복 발화 금지.

### S1 — 설계 (LLM · opus)
기획서 → `analysis.md` + `tc_design.md`. v2 설계기 승계(SSoT + tc-학습 P-18/19/20/22/23). 재실행 시 design_hash 일치하면 스킵.
```bash
bash "$TCTEAM/scripts/run_pipeline_s1only.sh" --feature <기능명> --sheet-id "$SHEET" --conf-url "<URL>"
# 산출: $SPEC/analysis.md, $SPEC/tc_design.md
#       (+ item_dict.json item_dict on일 때 · dxr_crossref.json crossref on일 때)
```
> `run_pipeline_s1only.sh` = 설계 체인(아이템사전→설계→검수→수정→대조주입) 전용 스크립트 — **tc-team 소유**(`$TCTEAM/scripts`, 07-27 이주). 내부 에이전트: tc-team-designer · tc-team-설계검수 · tc-team-대조 (규칙은 전부 rules 서랍 참조 — v2 비의존).
> **STEP 0-사전 (결정론 · 2026-08-13)**: STEP 1 앞에서 `lib/item_dict.js` 가 DXR 테이블 → `$SPEC/item_dict.json`(아이템 실명 사전)을 뽑는다. 재현스탭 문장은 tc_design.md 에서 태어나 하류로 흐르므로 설계 앞이 유일한 주입 지점이다. 소비처 = 설계·수정 핸드오프 + S4 quality 렌즈($WORK=$SPEC이라 cp 불필요). 토글 `team/tc_config.json` `item_dict`, 원본 없는 머신은 exit 4로 조용히 스킵(비차단). 규칙 SSoT=`rules/tc-설계.md` §아이템 실명 병기.

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
   - **청크 병렬(2026-08-19)**: 청크는 서로 독립이라 동시 실행한다. 풀체인(`run_pipeline_full.sh`)은 **동시 `TCTEAM_S3_PAR`개(기본 4)** 웨이브 배치 — S4 커버리지 원장(`TCTEAM_COV_PAR`)과 같은 형태. 실측 300TC 환산 순차 40분46초 → 동시 4에서 13분08초 `[estimated]`(근거 `docs/s3_병렬화_실측_20260816.md`). **K=6 이상은 실측 표본 없음** — 올리려면 먼저 잴 것. `TCTEAM_S3_PAR=1`이면 구 직렬 동작. 하네스 `tc-team/tests/s3_parallel_qa/`.
> ⚠ **Workflow 도구가 세션에 없으면 여기서 진행 불가** — S3·S4는 Workflow 전용이다(동봉 대체 경로 없음). 계속 진행하는 척하지 말고 즉시 중단·보고: "Workflow(멀티에이전트 오케스트레이션) 도구가 필요합니다 — docs/PREREQUISITES.md §5". S0~S2 산출물은 보존되므로 도구 확보 후 S3부터 재개하면 된다.
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
"$NODE" "$LIB/item_cite_gate.js" "$WORK/tcteam_snapshot.json" "$SPEC/item_dict.json" --out "$WORK/item_cite_report.json"  # 아이템 병기 확정위반 4종+축1 후보. exit 3=검출 / 4=사전없음 스킵
cp "$TCTEAM/docs/eval_digest.md" "$WORK/eval_digest.md"    # EVAL 렌즈 기준 배치 (이관감사 M-023)
L="$RULES/tc-학습.md"; [ -f "$L" ] && cp "$L" "$WORK/tc-학습.md"   # 재발 패턴 렌즈 입력 (M-024, 없으면 스킵 — rules 서랍 정본, 07-27 이사)
```
① **Workflow 팬아웃** — `Workflow({ scriptPath: "<TCTEAM>/workflows/tcteam-s4-review.js", args: { workdir: "<WORK>" } })`
   (3렌즈: 구조·품질·원문대조 병렬 → 판정자 상호반박 → fix_plan)
② 완료 후 **journal에서 fix_plan 추출** → `$WORK/fix_plan.json`.
③ **커버리지 원장**(레버②): general-purpose agent로 rules→tc_ids 의미 매핑 → `$WORK/coverage.json` + `$WORK/exclusions.json`. **'추후구현'은 제외 사유 불가(이관감사 M-021)** — 반드시 TC로 전개하고 J='추후 구현'·H/I=N/A(v2 tc-생성 규칙 승계), 미커버면 S5 봉합 루프가 add_row로 생성.
   - **청크 분할 필수(2026-08-10)**: 규칙 전량을 한 번에 뱉으면 **출력 32k 토큰 상한**에 걸린다 — 실사고 3건(아이템_강화_연출·기능B·월드맵_시스템_개선_v2). 상한 초과는 매핑을 다 끝낸 뒤 **출력만 못 하고 죽어** 시간이 100% 날아가고 재시도까지 겹쳐 실측 **88.3분**(LLM 3회분)이 됐다. 풀체인은 `cov-ranges`로 규칙을 끊어(`TCTEAM_COV_CHUNK`, 기본 50) 청크별 `cov_chunk_<n>.json`을 받고 `assemble-coverage`로 결정론 병합한다. 청크는 서로 독립이라 **동시 `TCTEAM_COV_PAR`개(기본 3)** 병렬.
   - 청크 계약: 각 청크는 **담당 rule_id 목록만** 처리(목록 밖 id·커버/제외 동시등재는 `validate-cov-chunk`가 차단), 미커버 규칙은 **두 배열 어디에도 넣지 않는다**(M-021 — 봉합 루프가 전개).

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
