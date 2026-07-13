export const meta = {
  name: 'tcv3-s4-review',
  description: 'tc-v3 S4 — 적대 3렌즈 리뷰 + 판정자 fix_plan',
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
  { key: 'structure', focus: `구조·규칙 렌즈. \`${W}/v3_snapshot.json\`(rows: [A,B,C,D,E,F,G,H,I,J])과 \`${W}/tc_design.md\`을 Read. 점검: J열 화이트리스트(빈값/추후 구현/구현 우선순위 낮음/기획 확인 필요/PROJ-N(버그ID)만) · 검증단계(정상/부정/예외) 적정 · 기본기능 섹션 최상단 · 무의미 중복 TC(정상을 기대결과 변화 없이 부정/예외 복제) · 대/중/소 분류 정합.` },
  { key: 'quality', focus: `품질 렌즈. \`${W}/v3_snapshot.json\`을 Read. F열 점검: 사람이 그대로 실행 가능한 사람언어 · 구체적 기대결과(막연한 "동작" 금지) · 추상표현(올바르게/정상적으로/적절히/제대로/문제없이/정합/불일치 없이) 없는가 · 1 TC=1 검증포인트 · 부정/예외에 사전상태 명시.` },
  { key: 'crossref', focus: `기획서 원문 대조 렌즈. \`${W}/v3_snapshot.json\`과 \`${W}/slices.json\`(sections=원문 헤딩 조각, rules=원문 규칙 앵커)을 Read. slices **원문** 기준으로: TC가 원문 수치/문구 정확 반영 · 원문에 있으나 미전개된 **커버리지 누락**(add 제안) · 원문에 없는 내용을 TC가 추론하지 않았는가(기획서 추론 금지). 파생본 아닌 slices 원문만 근거.` },
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
  `\`${W}/v3_snapshot.json\`을 Read해 실제 tc_id(A열)와 현재 셀값 확인. 규칙:\n` +
  `- edit_cell: {op, tc_id, col(F/J), before(현재값 그대로), after, reason}. after는 추상표현 금지·사람언어·단일문장.\n` +
  `- add_row: {op, after_tc_id(앵커), row:{b,c,d,e,f,g,j}, reason}. 커버리지 누락 신규행. g는 정확히 PC|모바일|PC/모바일. **⚠ 앵커는 같은 소분류(d)의 마지막 행으로 골라 그룹 분산(V-17) 방지**.\n` +
  `- delete_row: {op, tc_id, reason}. 무의미 중복만.\n` +
  `- 확신 없으면 배제. patches 비어도 정상.\n\n## findings\n${JSON.stringify(allFindings, null, 1)}`,
  { label: 'judge', phase: 'Judge', model: 'sonnet', schema: FIXPLAN_SCHEMA, effort: 'high' }
)

return { lensCounts: lensResults.map(r => ({ lens: r.lens, n: r.findings.length })), allFindings, fixplan }