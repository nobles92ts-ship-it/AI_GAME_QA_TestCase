---
name: tc-team-ai
description: AI가 QA를 실행할 TC 묶음(md) 만들기 — 기획서(Confluence 링크 또는 파일)만 받아 tc-team 엔진 S1~S5(시트 없이)로 TC를 만들고, 각 TC를 전제·조작·기대·관측으로 나눠(원문 보존 게이트) INDEX.md·cases/*.md·spec.md·results.md 묶음으로 낸다. 스프레드시트 불필요. 트리거 "/tc-team-ai", "AI용 TC 만들어줘", "AI가 QA할 TC 묶음", "tc-team-ai로 진행". 사람용 시트 TC는 tc-team.
user-invocable: true
allowed-tools: Read, Write, Edit, Bash
---

# tc-team-ai — 기획서 → AI 실행용 TC 묶음

## 하는 일

- **엔진은 tc-team 그대로다.** S1 설계 ~ S5 확정본까지 같은 체인(`run_pipeline_full.sh --no-sheet`)을 돈다. 시트 기록(S6)·완료처리(S7)·Slack 착수 공지는 하지 않고, 드라이브 업로드는 설계자에게 건너뛰라고 지시한다(아래 「지킬 것」 2).
- 그 뒤 두 단계를 더한다.
  1. **다시 쓰기**(LLM) — TC 문장 하나를 전제·조작·기대·관측 네 칸으로 나눈다. 원문 보존 게이트(숫자·영문 이름·기호 문구·부정·조건 낱말)를 통과한 것만 쓰고, 두 번 걸리면 그 TC는 원문만 낸다.
  2. **내보내기**(결정론) — 확신도를 시트 없이 다시 재고 md 묶음을 쓴다.
- **원문(재현 스탭)이 정본이다.** 네 칸은 실행을 돕는 도움말이고, 묶음의 실행 규칙도 그렇게 적혀 있다.

## 트리거

- 기획서(Confluence 링크 또는 파일)만 있으면 시작한다. 시트 링크는 필요 없다 — 시트에 TC를 쓰려면 tc-team.
- "처음부터"가 아니면 기존 `_ai_` 폴더를 지우지 않는다. 다시 만들 때는 `_v2`, `_v3`… 새 폴더.

## 경로

```bash
ROOT="{PROJECT_ROOT}"                     # 프로젝트 루트 (배포본 = 설치 폴더)
FEAT="_ai_<기능명>"                                # ⚠ 반드시 _ai_ 로 시작 — 아래 「지킬 것」 1
SPEC="$ROOT/team/specs/$FEAT"
RULES="{CLAUDE_SKILLS_DIR}/tc-team-ai/rules"   # ai-실행규칙.md · ai-재작성.md
```

## S0 — 준비 (드라이버)

1. **기능명** = `_ai_` + 기획서 제목에서 글자·숫자·`-` 만 남기고 나머지(공백·괄호·따옴표·`/`·`·`·`.` 등)는 `_` 로 바꾼 것 — `_` 가 이어지면 하나로, 끝의 `_` 는 뗀다. 러너가 이 꼴이 아닌 이름을 거부한다(체인이 기능명을 셸 명령 문자열에 그대로 넣는다). 같은 폴더가 있으면 `_v2`·`_v3`… — 기존 폴더는 건드리지 않는다(`ai_bundle/results.md` 에 실행 결과가 있을 수 있다).
2. **기획서 받기** → `$SPEC/confluence_raw.md`
   - Confluence: `python "$ROOT/tc-team/lib/confluence_fetch.py" <pageId> "$SPEC"`(macOS·Linux 에서 `python` 이 없으면 `python3`) — LLM 없이 REST 로 받는다. 본문 + `confluence_storage.html` + `confluence_source_meta.json` + `linked/`(본문이 가리키는 같은 사이트 페이지 1홉, 최대 5개). 계정 = env `CONFLUENCE_URL`·`CONFLUENCE_USERNAME`·`CONFLUENCE_API_TOKEN`, 없으면 `scripts/util/confluence_image_downloader.py` 의 로컬 설정.
   - 파일(pdf·docx·md): 본문을 **원문 그대로** `confluence_raw.md` 에 저장한다. 요약·정리 금지.
   - 기획서가 2건 이상이면 `confluence_raw.md` **한 파일에 병합**한다 — `linked/` 에 넣으면 커버리지 원장이 그 문서를 통째로 빼먹는다(원장은 `confluence_raw.md` 만 자른다). 맨 위에 `[본 파일 = 기획서 N건 병합본. 문서① <제목>(<pageId>) / 문서② …. 충돌하면 최신 문서가 우선한다.]` 를 쓰고 문서마다 구분선을 넣는다. 충돌은 병합 단계에서 풀지 않는다 — 원문 둘 다 둔다.
3. **`$SPEC/sheet_info.txt`** — 두 줄만:
   ```
   FEATURE_NAME=_ai_<기능명>
   CONFLUENCE_URL=<기획서 URL>
   ```
   ⛔ `SHEET_ID`·`TAB_NAME` 은 쓰지 않는다. 파일 기획서면 `CONFLUENCE_URL` 줄도 뺀다.
   (S1 의 접점 축 추출 `impact_scope.js` 가 이 파일에서 페이지 ID 를 읽는다 — 없으면 본문 첫 링크를 자기 페이지로 오인할 수 있다.)
4. **자가검증** — `confluence_raw.md` ≥ 1KB · 절단 흔적 없음. 실패면 다시 받기 1회, 또 실패면 멈추고 보고.

## 실행 — 한 줄

```bash
node "$ROOT/tc-team-ai/scripts/run_ai.js" --feature "$FEAT" --conf-url "<기획서 URL>"
```

- **Bash 도구(git-bash)로 띄운다** — 러너가 안에서 `bash` 를 부른다(PowerShell 에서는 WSL bash 가 잡힐 수 있다).
- 오래 걸린다(S1 설계 = opus · effort max, 사람용 런과 같은 체인). **백그라운드로 띄우고** `$SPEC/chain.log` 를 본다. 러너 줄은 `[AI]` 로 시작한다.
- ⛔ 런 도중 `tc-team/scripts/*.sh` 를 고치지 말 것(그 런이 죽는다). `run_ai.js` 도 런 중엔 고치지 않는다.
- 끝에 `AI_DONE {요약 JSON}` 한 줄이 나온다.

| 종료코드 | 뜻 | 다음 |
|---|---|---|
| 0 | 완료 | 보고 |
| 1 | 실패·사용법 | 로그 마지막 `[AI]`·`[CHAIN-FULL]` 줄 |
| 10 | 인증 만료 | 재인증 후 같은 구간부터 재개 |
| 12 | 다시 쓰기 결과를 하나도 못 읽었다 — 결과 파일이 안 나왔거나 JSON 이 아니다(묶음·done 없음). 게이트가 거른 폴백과 다르다 | 결과 파일(`ai_work/c*_out.json`)이 없으면 claude CLI·모델 이름(`TCTEAM_AI_MODEL`)·네트워크, 있으면 그 형식 확인 → `--start-from rewrite` |
| 14 | 무결성 정지 | 사람 확인 — 체인 `[STOP:무결성]` 사유 |
| 15 | 쿼터·한도 | 대기 후 재개 |
| 그 밖 | 체인 종료코드 그대로(예: 13 = S1 설계 시도 한도) | `chain.log` 마지막 `[STOP:…]`·`[CHAIN…]` 줄 |

**구간 재개** `--start-from`: `s2`~`s5`(체인 구간부터) · `rewrite`(확정본은 두고 다시 쓰기부터) · `export`(내보내기만 — 확신도는 다시 잰다).

## 산출 — `$SPEC/ai_bundle/`

| 파일 | 내용 |
|---|---|
| `INDEX.md` | §1 실행 규칙(`rules/ai-실행규칙.md` 본문 그대로) · §2 실행 순서표 · §3 기획 확인 질문·재현 수단 · §4 제외 규칙 · §5 파일 |
| `cases/NN_<소분류>.md` | TC 블록 — 원문 + 네 칸 + 판정 표시(판정 보류 `BLOCKED(기획)` · 추후 구현 `N/A`) + 근거 규칙 + 확신도. 기본기능은 `01_기본기능_스모크.md` 로 맨 앞. 근거 규칙은 S4 원장을 **재현 스탭 문장으로** 확정본에 잇는다 — 원장 번호는 S5 재번호 전 것이라 번호로 잇지 않는다. 같은 문장이 기본기능 행과 QA 행에 함께 있을 수 있어 원장이 가리킨 행과 같은 범위(기본기능 / QA)의 행을 먼저 고르고, 그래도 하나로 안 갈리는 연결은 싣지 않고 `AI_DONE` 의 `rule_links_unmapped` 로 센다(원장이 없으면 `null`) |
| `spec.md` | 기획서 원문(절 단위) |
| `results.md` | 실행 결과 자리 — 다시 내보내도 지우지 않는다 |

중간 산출(같은 `$SPEC`): `ai_rewrite.json`(네 칸 + 그때의 원문 · 폴백 사유) · `ai_confidence.json` · `ai_work/`(청크 입출력).

## 완주 보고에 넣을 것

1. `AI_DONE` 요약 그대로 — TC · 그룹 · 판정 보류 · 구조화 · 원문대로 · 질문 수 · 확신도 유무 · 못 이은 근거 규칙 연결 수(`rule_links_unmapped` — `null` 이면 원장이 없어 근거 규칙 줄이 하나도 없다).
2. **원문대로(폴백) 비율과 사유 분포** — `ai_rewrite.json` 의 `fallback` 사유를 센다. 게이트 문턱(`rewrite_gate.js` `COVERAGE_MIN=0.6`)은 아직 실측 전이다 — 비율이 높으면 문턱부터 의심한다.
3. 체인 관측 — 참조 문서 선수집(`linked/` 파일 수 vs `confluence_source_meta.json` 의 본문 참조 수 — 어긋나면 그 사실을 쓴다) · 이미지 마커 감사(`chain.log` `[STEP 2] 이미지 마커 감사:` 줄) · DXR 대조를 켰으면 crossref 4분기 비율 · 확신도 분포.
4. **바깥 호출 0 확인** — `chain.log` 에 `[S6]`·`[S7]`·`[SLACK] 착수 공지 OK` 가 없고 `[SLACK] 시트 없는 런(--local) — 착수 공지 생략` 이 있다. 설계자 `drive_links` 는 빈 배열.

## 노브 (env)

`TCTEAM_AI_MODEL`(다시 쓰기 모델, 기본 `sonnet`) · `TCTEAM_AI_PAR`(동시 청크, 기본 4 · 상한 8) · `TCTEAM_ENGINE=codex` · `TCTEAM_ISOLATE`(기본 1). 체인 노브(`TCTEAM_SONNET_MODEL`·`TCTEAM_OPUS_MODEL` 등)는 tc-team 과 같다.

## 지킬 것

1. **기능명은 `_ai_` 로 시작한다.** 사람용 런과 specs 폴더·`state.json` 항목을 나눠 쓴다. specs 의 `_` 폴더는 사람용 TC 를 지켜보는 도구(사내 운영 도구 — 공개 배포본 미포함)가 건너뛰는 자리라, 이름이 사람용과 같은 꼴이면 AI 런 폴더가 「그 기획서의 TC」로 잡힐 수 있다. 러너가 접두 없는 이름을 거부한다.
2. **시트·드라이브·Slack 을 부르지 않는다** — 체인이 `--no-sheet` 로 S6·S7 을 안 돌고, S1 은 `--local` 로 Slack 착수 공지를 건너뛴다. 드라이브 업로드는 코드가 막는 게 아니라 설계자에게 건너뛰라고 **지시**하는 것이라 완주 보고 4(`drive_links` 빈 배열)로 확인한다. 시트에 올릴 일이면 tc-team 으로 따로 돌린다.
3. **확정본·원문을 손으로 고치지 않는다.** 다시 쓴 네 칸은 그때의 원문과 함께 저장되고, 내보낼 때 원문이 다르면 버린다(그 TC 는 원문대로).
4. 규칙 정본 = `rules/ai-실행규칙.md`(INDEX §1 로 그대로 들어간다) · `rules/ai-재작성.md`(다시 쓰기 LLM 지시). 고치면 테스트를 돌린다.

## 테스트

```bash
node "$ROOT/tc-team-ai/test/run_all.js"
```

게이트(원문 보존) · 다시 쓰기 진행기(재시도·폴백·중단) · 확신도 · 내보내기(TC 수·ID·원문 바이트 보존) · 체인 `--no-sheet` 계약(대조군 포함) · 러너 배선(종료코드·재개). LLM·시트 호출 없음.
