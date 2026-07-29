# tc-v3 드라이버 — 운영 절차 + 빌드 매니페스트

> 스펙 원본(승인 대기): `{WORK_ROOT}\tc-v3-redesign-plan.html` v1.3
> 이 문서 = Phase 2 산출물(메인 세션 드라이버 절차) + 구축 현황(무엇이 빌드·QA됐고 무엇이 라이브 대기인지).
> 작성 2026-07-11, 갱신 2026-07-12. 상태: **전 스테이지(S0~S7) 라이브 end-to-end 완주 검증** — 자동_사냥_기능을 v3로 재생성해 `자동_사냥_기능_v2` 탭 라이브 산출(v2 원탭 보존). 결정론 유틸 12종·70 테스트 GREEN.

---

## 1. 실행 모델 (계획 §3)

메인 세션이 **드라이버**다. 배치 루프·파일 preflight·node 유틸 실행·카운터/마커/프로젝션·Confluence/Slack MCP를 메인이 소유.
LLM 단계(S1 설계 / S3 F열 문장화 / S4 리뷰·판정)는 agent/Workflow 호출. **Workflow 스크립트는 fs/node 접근 불가**(계약) — 경로·해시·청크는 메인이 계산해 `args`로 주입.

```
메인 드라이버 ─ 파일 preflight(역순) → 시작 스테이지 결정 → 스테이지 실행 → state 프로젝션 → 다음
   confluence_raw → analysis/tc_design(+해시) → v3_fmap_part_*(해시일치분) → tc_snapshot
     → fix_plan → tc_final(+tc_final.ok) → upload_verify   [ok 없는 tc_final = S5 재실행]
```

---

## 2. 빌드 매니페스트 — `lib/` (전부 결정론, 유닛 QA 완료)

| 유틸 | 스테이지 | 역할 | 유닛 | 실물 검증 |
|---|---|---|---|---|
| `apply_fix_plan.js` | S5 | fix_plan→스냅샷 결정론 적용(row_id 멱등·add/delete·ledger) | 13 | 스파이크: 실물 109→110행, 재적용 멱등 |
| `slicer.js` | S4·② | 기획서 원문→헤딩 섹션 + rule_id 규칙(원문 그대로). **리스트 항목 + 표 데이터 셀**(2026-07-29) | 19 | 실물 자동_사냥 → 섹션 7·규칙 71 |
| `content_gate.js` | S5 | FINAL-4 로컬 지표 차단(추상·OutputFormat·G·J) — 정확 복제 | 10 | 실물 v2 스냅샷 109행 PASS(동등성) |
| `traceability.js` | S4·② | rule↔TC 역추적 원장 + 미커버 차단 게이트 | 5 | 스파이크: 실물 규칙 70에 게이트 기동 |
| `state_projection.js` | S7 | state.json 관측 프로젝션(v2 어휘·done=r2·monitor 무개조) | 5 | — |
| `force_clean.js` | §6 | 「처음부터」 초기화(원문/설정 보존) | 2 | — |
| `golden_diff.js` | ③ | 골든셋 구조 회귀 비교(구조 exact·F열 유사도) | 6 | 스파이크: 자기=pass·+1행=regression |
| `design_gate.js` | S2 | direct_convert **격리** 게이트(중간산출물 삭제 회피) | (스파이크) | **격리 불변식 실증**: 실물 specs 전후 바이트 동일 |

**테스트**: `node test/run_all.js` → 10 스위트 / **88 GREEN** (07-16 이관감사: eval_digest 동기화 가드 포함). 실물 자산=`team/specs/자동_사냥_기능`.

---

## 3. 드라이버 절차 (S0~S7) — 유틸 배선 + 구축 상태

| S | 실행 | 배선(빌드분 굵게) | 상태 |
|---|---|---|---|
| S0 | main | Confluence fetch(제목 CQL 선조회+본문 lazy)·자가검증·Slack kickoff(`send_slack_tc_request.js` 재사용) | 절차 정의 / MCP는 라이브 |
| S1 | agent | 설계(opus, SSoT+P-18/19/20)·해시 스킵 게이트 | **LLM 대기**(스키마 계약만) |
| S2 | main+agent | **`design_gate.js`**(격리 convert)∥검수 agent·DXR대조(crossref on)·수정 루프(카운터 `tcteam_s2_attempts.txt`) | 게이트 빌드 / 검수 LLM 대기 / **C-12 미배선** |
| S3 | main+WF | convert(골격)→F열 문장화(Workflow 팬아웃·25행 청크·해시키 `v3_fmap_part_*`)→**merge**(`tc_f_map.json` 조립) | 결정론 빌드 / 문장화 LLM 대기 |
| S4 | WF+agent | **`slicer.js`**(원문 슬라이스)→3렌즈 팬아웃→기계 병합→판정자(fix_plan·`tc-수정.md` 준수)·**`traceability.js`** 게이트 | 슬라이서·원장 빌드 / 렌즈·판정 LLM 대기 |
| S5 | main | **`apply_fix_plan.js`**→**`content_gate.js`**(차단)→`tc_final.json`+`tc_final.ok` | **빌드·QA 완료** |
| S6 | main | 탭명 선기록·소유마커→**clear-and-rewrite 래퍼**→서식→재덤프 0-diff(A~G+J)+#ERROR! 시트평가→3자 대조 | **래퍼 미빌드(라이브 시트)** |
| S7 | main+node | 대시보드·K~O·라벨·드라이브(기존 유틸)·**`state_projection.js`**·보고(재덤프 수치)·배치 try/continue | 프로젝션 빌드 / 후처리=기존 유틸 |

---

## 4. 완성 현황 (라이브 end-to-end 검증 완료)

**자동_사냥_기능 v3 재생성 실측 (2026-07-12)** — 전 스테이지 라이브 완주:
| S | 실측 결과 |
|---|---|
| S1 | analysis/tc_design 해시 스킵(기존 v2 자산 무재분석 소비) ✓ |
| S2 | design_gate 격리 convert exit 0 (기본27/QA82/총109), 실 specs 무변형 ✓ |
| S3 | Workflow F문장화 5청크 병렬 109/109 → merge exit 0(시프트/F위반 0) → 로컬 10열 스냅샷 → content_gate 0위반 ✓ |
| S4 | Workflow 3렌즈(구조4·품질19·원문대조10=33 findings) + 판정자 → 25 patches. **원문 추론 검출**(500ms 임의수치·부활 미정단정), **커버리지 누락**(유저 피격 R-6.1 add_row) ✓ |
| S5 | apply_fix_plan 25건 0충돌 → 111행 → regroup(V-17 봉합) → content_gate 0위반 → tc_final.ok ✓ |
| A/B | golden_diff: v3 = v2 대비 +2 QA(커버리지)·검증단계 개선·양쪽 위반0 (v3는 3렌즈 리뷰 완주, v2는 STEP5 사망) ✓ |
| S6 | sheet_write: base 점유(exit3)→ **`자동_사냥_기능_v2` 라이브 생성**, v2 원탭 불가침 ✓ |
| S7 | update_dashboard(블록6)·add_project_info(K~O) ✓, read-back 정상 ✓ |

**신규 코드 재확정**: C-12는 별도 유틸 불필요(S2 검수 agent + 기존 `coverage_gaps.js`가 정본) · S6 clear-and-rewrite = `sheet_write.js`로 구현.

**2026-07-12 확장 (주변감지 A/B 환류 3종)**:
- **content_gate v2 규칙**: ①위임표현(스펙/규칙/정책/기준대로) — 무플래그=차단·J=기획 확인 필요=경고 ②'정확히+동사'=경고. 첫 진양성=주변감지 v2 baseline 무플래그 위임 1건 즉시 검출. `warnings`/`warnByType` 필드 추가(경고=비차단).
- **레버② 커버리지 원장 라이브 가동**: S4 후 의미 매핑 agent → `coverage.json`+`exclusions.json`(사유 화이트리스트 4종) → `traceability.js` 게이트. 주변감지 실측: 게이트가 v2·v3 공통 갭 R-3.3(UI 레이아웃) 검출 → fix_plan r2로 TC 추가(129행) → **27규칙=커버24+제외3+미커버0 PASS**. A/B는 토큰 근사 폐기, 원장 집합 비교로.
- **기획 확인 요청서 산출물**: 플래그 행+원문 조인 → `pm_questions.json` → HTML 요청서(질문 11·blocking 9). 답변 회수 → fix_plan 1패스 확정 교체(→ ①의 위임 경고 해소 루프).
- **S6 clear_and_rewrite 라이브 실증**: 소유 마커 경유 재기록(exit 3→삭제→재기록) — 129행 재업로드 + K~O/대시보드 복원 절차 포함 확인.
- **v2 승계 전수 감사(07-12, run_pipeline.sh 482줄+완료처리+SSoT+메모리 룰 대조)**:
  - **[A] 확정 누락(운영 룰·즉시)**: ①Slack 착수공지(send_slack_tc_request.js) — **07-14 근본 수정 완료**: run_pipeline.sh·run_pipeline_s1only.sh 라인125가 stale 공유 `.kickoff_items.json`(옛 배치 4건)을 재사용(`|| 가드`) → 옛 해시로 dedup 계산 + 벤치마크 잔존 'time-test suppress' 마커(`9511166d0bc2b2b2`)와 충돌 → **오억제**였음(미발송 원인). per-feature 항목파일(`$SPEC/.kickoff_item.json`) + 기능별 dedup 격리(`--dedup-dir $SPEC`)로 전환 + stale suppress 마커 제거. 중복발송·오억제 양방향 해소(장비/보스 실발송·재실행 스킵 검증, 백업 `.bak_slackfix_20260714`). ②완료 보고에 FINAL-6 이미지 매칭 안내 1줄 ③보고에 단계별 시간 포함 룰(시간 계측과 함께) ④`team/state.json` 상태 원장 미기록 — 모니터·알림 8종이 소비, 실제로 `주변_감지_기능_v2=failed`(07-09 v2 시도 사체) 스테일 발견→done 교정 완료. 드라이버 단일화 시 ①~④ 전부 내장.
  - **[B] 콜드런 승계 대기(드라이버 단일화 범위 — 재사용 런에선 v2 자산 상속으로 무해)**: confluence fetch+500B 입력게이트 / STEP1 설계 생성+tc-학습.md 활성 패턴 주입(P-18~20 설계, P-01~17·21 재발감시 — v3 S3·S4 프롬프트에 현재 미주입) / STEP2 설계검수+coverage_gate(C-12)+needs_fix 라우팅 / tc-대조(crossref_brain) / 락·정지코드(10/13/14/15/16)·silent 가드·--resume-from / --local 모드 / **EVAL-1~20↔3렌즈 정렬 — 07-16 이관감사(M-023·019·024)로 편입 완료**: `docs/eval_digest.md` 신설(실물 14종 = EVAL-02~04·10~20 + 추후구현 정책, 렌즈별 섹션 — 나머지 6종 중 01·05·06·08·09는 결정론 코드 소유(traceability·재번호·regroup·골격=direct_convert(scripts/util, lib 밖)·content_gate), 07(중복)은 structure 렌즈+judge delete 소유. 동기화 가드=test/eval_digest.test.js) → S4가 $WORK로 cp(tc-학습.md도 존재 시 cp), 3렌즈 프롬프트가 담당 섹션 적용. S3 fmap 프롬프트에도 문장규칙 보강(사전상태 예외6종·주어화 금지·"또는" 금지). ⚠tc-학습 패턴 원문 주입 외 나머지 [B] 항목은 여전히 콜드런 대기.
  - **[C] 승계 확인 완료**: FINAL-1~5(4는 read-back QA 대체)·탭 접미사·create_gsheet 서식·FINAL-4 정규식(content_gate)+확장.
  - **[이관감사 07-16 · M-021] exclusions '추후구현' 제거**: traceability.js EXCLUSION_REASONS = 3종(타기획서·비TC성서술·중복규칙)으로 축소 — 추후구현은 **TC화 강제**(J='추후 구현'·H/I=N/A, v2 tc-생성.md:271 승계), 미커버 시 S5 add_row 봉합. SKILL S4③ 문구 동기화. ⚠기존 완료 런(장비 등)의 exclusions.json을 재검증하면 badExclusion으로 게이트 실패함(완료 런은 재실행 대상 아님 — 신규 런부터 적용). 근거: 감사 원장 `{WORK_ROOT}\_tc_migration_audit\inventory.md`.
- **⚠원장 id 리맵 규칙(07-13 월드맵 실전 적발)**: add_row가 기존 그룹 중간을 쪼개면 regroup이 행을 재배치하므로 **산술(+N) 리맵 금지** — 월드맵 r2에서 R-8.2를 122로 산술 계산했으나 실제 123(regroup 재배치). 교정 정본=`rebuild_coverage.js` 방식: pre 스냅샷을 결정론 재구성(fix_plan 재적용)→ **E+F 내용 조인**으로 old→new id 맵 구축→원장 재기록→traceability 재실행. 게이트는 id 실존만 보므로(dangling) 오염을 못 잡는다 — 리맵 후 신규행 F prefix 탐색으로 반드시 실측 확인.
- **⚠완료처리(FINAL) 승계 구멍 발견·보완**: v3 S6가 FINAL-1(대시보드)·FINAL-2(K~O 패널)만 승계하고 **FINAL-5(L/M 기획확인·테스트데이터 라벨링)를 누락**했던 것을 사용자 지적으로 발견 → v2 산출 `_labels.json` 재사용으로 양 v3 탭 기재 완료(자동사냥 11건/주변감지 9건). **S6 정의 = 라이브 기록 + 완료처리 FINAL-1·2·5 필수**(재사용 런은 `_labels.json` 그대로, 신규 기획서 런은 5a 도출부터). FINAL-4 재덤프 검증은 v3 read-back QA가 대체. FINAL-3 드라이브 sync는 아직 미승계 — 07-12 수동 실행 완료(fixtures 전체 41 + HTML·_labels 5 = 46파일, `upload_md_to_drive.js --sync <기능명> <fixtures경로>` / `--folder`). ⚠specs 폴더 통재sync 금지: 스크립트가 덮어쓰기 없이 타임스탬프 사본을 만들므로 이미 동기화된 폴더 재실행 = 전 파일 중복. 신규 파일만 올릴 것. L/M 라벨(시트)과 기획확인요청서(HTML)는 **별개 산출물로 병존** — 전자=v2 형식 요약 라벨, 후자=기획팀 발송용 질문서(fix_plan 루프 입력).

**잔여(운영 편의, 코어 무관)**: ①드라이버 단일 실행체(현재는 스테이지별 수동 구동 — 절차는 이 문서로 확정) ②골든셋 재생성 자동화(비교기 완성, 등록만 남음) ③배치 루프·상태 프로젝션 배선.
**다음 권장**: Phase 3 A/B를 완료된 v2 탭(주변감지·월드맵)로 확대 + 드라이버 실행체 1개로 통합.

---

## 5. 재현 (QA 재실행)

```bash
NODE="{NODE_PATH}"
"$NODE" {PROJECT_ROOT}/tc-team/test/run_all.js     # 전체 88 테스트(10 스위트)
"$NODE" {PROJECT_ROOT}/tc-team/test/phase0_spike.js # 실물 통합 스파이크 단독
```

각 유틸은 CLI로도 실행 가능(파일 헤더 주석의 `CLI:` 참조). 전부 stdout=JSON·exit code 계약.
