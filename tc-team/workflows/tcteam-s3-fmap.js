export const meta = {
  name: 'tcteam-s3-fmap',
  description: 'tc-v3 S3 — F열(재현스탭) 문장화 팬아웃 (주변감지, 25행 청크)',
  phases: [{ title: 'Fmap', detail: 'leaf→완성 F문장 (청크 병렬)' }],
}

const A = typeof args === 'string' ? JSON.parse(args) : (args || {})
const workdir = A.workdir
const ranges = A.ranges

const RULES = `너는 TC 재현스탭(F열) 문장화 전문가다. 설계 골격의 각 행 leaf(확인 내용)를 완성된 재현스탭 문장으로 만든다. 판단·설계는 하지 않는다.

## F열(f) 작성 규칙 (엄수 — 위반 시 기계 게이트가 차단)
- 개행 없는 **단일 문장**. 사전상태·행동·기대결과를 조사로 자연스럽게 연결.
- 정상(e=정상): "(행동)하면 (구체적 기대결과)가 되는지 확인" — 사전상태가 분류(대/중/소)에서 자명하면 생략 가능.
- 부정·예외(e=부정/예외): "(사전상태)에서 (행동)하면 (구체적 기대결과)가 되는지 확인" — 사전상태 명시 필수.
- leaf가 이미 "~는지"로 끝나면 자연스러운 행동/사전상태를 보강하고 "확인"으로 마무리.
- **금지**: 추상표현(올바르게/정상적으로/적절히/제대로/문제없이/정상 동작) · 플랫폼 표기로 시작("PC에서"/"모바일에서") · 번호매김(1. 2.)·[대괄호 태그] 분리 · 개행 · 설계 태그 인용.
- **문장 첫 글자에 특수문자 금지(작은따옴표 · = · + · @)**: 스프레드시트가 수식으로 해석해 기계 게이트(leading_special)가 차단한다. 값은 버리지 말고 **문장 중간으로 옮긴다** — "+6강 무기를 착용하면…" → "강화 수치가 +6강인 무기를 착용하면…". 값을 지우거나 "+"를 떼는 것은 금지(기획서 표기와 어긋난다).
- 대분류(b)가 "기본기능"인 행: 영문 리소스명/식별자가 leaf에 있으면 괄호로 병기, 기획서 안내 문구는 큰따옴표로 인용.
- 구체적 기대결과 필수(막연한 "동작" 금지).
- **사전상태 필수 6종(옵션1-A 미적용 예외 — 정상이라도 생략 금지)**: 기본기능 인용 필요 / GlobalDefine·임계값 포함 / 상태전이 / 시간·수량 임계값 / fixture 후보 2개 이상 / 복합 사전상태. 생략은 자명 3항(소분류=화면표현 · GlobalDefine/임계값 없음 · fixture 후보 1개) 전부 충족할 때만.
- **식별자 주어화 금지**: 데이터테이블명·Enum·내부 변수를 괄호 밖 주어/술어로 쓰지 않는다 — 사람언어 주어 + 필요 시 괄호 병기(토스트/안내 문구 큰따옴표 인용은 예외).
- **"또는" 분기 금지**: 결과/사전조건/과정 어느 쪽이든 한 문장에 "또는" 분기 금지(1행 1검증).
- **아이템 실명 병기 보존**: leaf 에 \`(예: 샘플재료석)\`·\`(예: 제작 재료 임시 명칭(Index 100000001))\` 처럼 **아이템 실명 병기**가 있으면 문장에 **그대로 옮긴다**. 지우거나 일반명사로 되돌리지 말 것 — 테스터가 무엇을 집어야 하는지가 이 괄호에만 있다(결정론 사전 item_dict.json 산출). 병기가 없는 leaf 에 네가 실명을 **새로 만들어 넣는 것도 금지**(설계 영역).

## 출력
각 행마다 {idx, d, f}. **idx와 d는 입력 골격 그대로 echo**(변경 금지 — 시프트 검증에 쓰인다). f만 새로 작성.`

const SCHEMA = {
  type: 'object', required: ['rows'],
  properties: { rows: { type: 'array', items: {
    type: 'object', required: ['idx', 'd', 'f'],
    properties: { idx: { type: 'number' }, d: { type: 'string' }, f: { type: 'string' } },
  } } },
}

phase('Fmap')
const parts = await parallel(ranges.map(([s, e], ci) => () =>
  agent(
    RULES + `\n\n## 작업\n\`${workdir}/tc_skeleton.json\` 파일을 Read 도구로 읽어라. rows 배열에서 **idx가 ${s} 이상 ${e} 미만**인 행만 처리한다(정확히 ${e - s}개). 각 행의 leaf를 위 규칙대로 완성 문장 f로 만들고, idx·d(소분류)는 그대로 echo. ${e - s}개 행을 전부 rows로 반환.`,
    { label: `fmap:${s}-${e}`, phase: 'Fmap', model: 'sonnet', schema: SCHEMA }
  ).then(r => r ? (r.rows || []) : null)
))

const fmap = parts.filter(Boolean).flat().sort((a, b) => a.idx - b.idx)
return { count: fmap.length, expected: ranges[ranges.length - 1][1], fmap }