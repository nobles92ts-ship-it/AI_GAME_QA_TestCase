export const meta = {
  name: 'tcteam-s4-review',
  description: 'tc-v3 S4 — 적대 3렌즈 리뷰 + 판정자 fix_plan (주변감지)',
  phases: [{ title: 'Lens', detail: '3렌즈 병렬 진단' }, { title: 'Judge', detail: '상호반박 → fix_plan' }],
}

const A = typeof args === 'string' ? JSON.parse(args) : (args || {})
const W = A.workdir

const FINDINGS_SCHEMA = {
  type: 'object', required: ['findings'],
  properties: { findings: { type: 'array', items: {
    type: 'object', required: ['tc_id', 'severity', 'issue', 'suggested_fix'],
    properties: {
      tc_id: { type: 'string' }, severity: { type: 'string', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] },
      issue: { type: 'string' }, suggested_fix: { type: 'string' },
      kind: { type: 'string', enum: ['edit', 'add', 'delete'] },
    },
  } } },
}

const LENSES = [
  { key: 'structure', focus: `구조·규칙 렌즈. \`${W}/tcteam_snapshot.json\`(rows: [A,B,C,D,E,F,G,H,I,J])과 \`${W}/tc_design.md\`을 Read. 점검: J열 화이트리스트(빈값/추후 구현/구현 우선순위 낮음/기획 확인 필요/DXBUG-N만) · 검증단계(정상/부정/예외) 적정 · 기본기능 섹션 최상단 · 무의미 중복 TC(정상을 기대결과 변화 없이 부정/예외 복제) · 대/중/소 분류 정합. \`${W}/eval_digest.md\`가 있으면 Read해 [공통]+[structure] 섹션 기준(EVAL-19·16·14·04·17·02 배분, 추후구현 정책)을 추가 적용.
**⚠ \`${W}/dup_report.json\`이 있으면 반드시 Read** — dup_gate(결정론)가 뽑은 중복 후보다. \`exact\`(F열 완전 동일)는 **확정 중복**이니 delete 또는 차별화 edit를 반드시 제안하라(테스터가 두 행을 구별할 수 없다). \`similar\`(자카드 후보)는 정당한 분리(BVA 상·하한, 소형/대형 등 조건이 실제로 다른 경우)일 수 있으니 원문·분류를 보고 판정하라 — 병합할 때는 어느 쪽을 남길지 명시. 기계가 못 잡는 의미 중복(어순 교체·동의어)도 이 리포트를 단서로 추가 탐색하라.` },
  { key: 'quality', focus: `품질 렌즈. \`${W}/tcteam_snapshot.json\`을 Read. F열 점검: 사람이 그대로 실행 가능한 사람언어 · 구체적 기대결과(막연한 "동작" 금지) · 추상표현(올바르게/정상적으로/적절히/제대로/문제없이/정합/불일치 없이) 없는가 · 1 TC=1 검증포인트 · 부정/예외에 사전상태 명시. \`${W}/eval_digest.md\`가 있으면 Read해 [공통]+[quality] 섹션 기준(EVAL-03 예외6종·15 "또는"·18 내부표기)을 추가 적용.` },
  { key: 'crossref', focus: `기획서 원문 대조 렌즈. \`${W}/tcteam_snapshot.json\`과 \`${W}/slices.json\`(sections=원문 헤딩 조각, rules=원문 규칙 앵커)을 Read. slices **원문** 기준으로: TC가 원문 수치/문구 정확 반영 · 원문에 있으나 미전개된 **커버리지 누락**(add 제안) · 원문에 없는 내용을 TC가 추론하지 않았는가(기획서 추론 금지). 파생본 아닌 slices 원문만 근거. \`${W}/eval_digest.md\`가 있으면 Read해 [공통]+[crossref] 섹션 기준(EVAL-12 상태전이·13 결정테이블·20 데이터시트 대상행·10 섹션 전수+추후구현 TC화·11 취소선 교차)을 추가 적용.
**⚠ \`${W}/origin_report.json\`이 있으면 반드시 Read** — origin_gate(결정론)가 뽑은 **원문 미근거 후보**다. \`interaction_verb\`(HIGH)는 그 동작 어간이 기획서 원문에 0건이라는 뜻 = 상식 기반 창작 후보(7차 회고 유형 D 형상). \`coordinate\`는 좌표 창작/행·열 뒤바뀜(유형 A), \`direction\`(LOW)은 이미지에만 있는 배치 정보 단정 의심이다.
이 리포트는 **후보이지 판정이 아니다** — 원문 문맥을 직접 확인하고 판정하라: ①원문에 근거가 없고 자명하지도 않으면 delete 또는 J='기획 확인 필요' 제안 ②'뒤로가기 → 닫힘'처럼 원문 서술에서 논리적으로 도출되면 유지(사유를 남겨라). 근거 없는 항목을 TC로 유지하는 것도, 정당한 TC를 지우는 것도 둘 다 오류다.` },
]

phase('Lens')
const lensResults = await parallel(LENSES.map(l => () =>
  agent(`너는 TC 리뷰어의 "${l.key}" 렌즈다. 아래 관점으로만 진단(타 렌즈 영역 침범 금지). 확실한 것만, 없으면 빈 배열.\n\n${l.focus}\n\n각 결함에 tc_id·severity·issue·suggested_fix·kind.`,
    { label: `lens:${l.key}`, phase: 'Lens', model: 'sonnet', schema: FINDINGS_SCHEMA }
  ).then(r => ({ lens: l.key, findings: r ? r.findings : [] }))
))

phase('Judge')
const allFindings = lensResults.flatMap(r => r.findings.map(f => ({ ...f, lens: r.lens })))

const FIXPLAN_SCHEMA = {
  type: 'object', required: ['patches', 'rationale'],
  properties: {
    rationale: { type: 'string' },
    patches: { type: 'array', items: {
      type: 'object', required: ['op', 'reason'],
      properties: {
        op: { type: 'string', enum: ['edit_cell', 'add_row', 'delete_row'] },
        tc_id: { type: 'string' }, col: { type: 'string', enum: ['F', 'J', 'E', 'G'] },
        before: { type: 'string' }, after: { type: 'string' }, after_tc_id: { type: 'string' },
        row: { type: 'object', properties: { b: { type: 'string' }, c: { type: 'string' }, d: { type: 'string' }, e: { type: 'string' }, f: { type: 'string' }, g: { type: 'string' }, j: { type: 'string' } } },
        reason: { type: 'string' },
      },
    } },
  },
}

const fixplan = await agent(
  `너는 리뷰 판정자다. 3렌즈 findings를 상호 검증(상호반박)해 **실제 수정만** fix_plan(patches)으로 확정한다. 오탐·중복·저가치는 드롭.\n\n` +
  `\`${W}/tcteam_snapshot.json\`을 Read해 실제 tc_id(A열)와 현재 셀값 확인.\n` +
  `**결정론 게이트 산출물도 Read하라(있으면)**: \`${W}/dup_report.json\`의 \`exact\`(F열 완전 동일)는 렌즈가 놓쳤더라도 **네가 직접 delete/차별화 패치를 내야 한다** — 기계가 확정한 사실이라 드롭 금지. \`${W}/origin_report.json\`의 HIGH 항목은 원문 근거 부재 후보이니 원문을 확인해 유지/삭제/기획확인 중 하나로 반드시 처리하라.\n` +
  `⚠ 중복을 인지했으면 **문구를 더 비슷하게 만드는 edit 금지** — 병합(delete)하거나 조건 차이를 F열에 드러내라(2026-07-28 실측: 판정자가 중복을 알고도 사전상태 문구를 맞춰 자카드 0.94로 악화시킨 사례).\n` +
  `규칙:\n` +
  `- edit_cell: {op, tc_id, col(F/J), before(현재값 그대로), after, reason}. after는 추상표현 금지·사람언어·단일문장.\n` +
  `- add_row: {op, after_tc_id(앵커), row:{b,c,d,e,f,g,j}, reason}. 커버리지 누락 신규행. g는 정확히 PC|모바일|PC/모바일. **⚠ 앵커는 같은 소분류(d)의 마지막 행으로 골라 그룹 분산(V-17) 방지**.\n` +
  `- delete_row: {op, tc_id, reason}. 무의미 중복만.\n` +
  `- 확신 없으면 배제. patches 비어도 정상.\n\n## findings\n${JSON.stringify(allFindings, null, 1)}`,
  { label: 'judge', phase: 'Judge', model: 'sonnet', schema: FIXPLAN_SCHEMA, effort: 'high' }
)

return { lensCounts: lensResults.map(r => ({ lens: r.lens, n: r.findings.length })), allFindings, fixplan }