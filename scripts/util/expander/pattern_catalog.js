// pattern_catalog.js — 전개기 공용 고정 사상표 (SSoT: tc-분석.md §3.2 오류 추정 카탈로그)
// 결정론 원칙: 난수·시계 사용 금지. 이 파일의 표만 사용.

// ── G6 오류 패턴 카탈로그 — tc-분석.md §3.2 7개 기능 유형 1:1 ──
// stage: 부정|예외 (오류 패턴은 정상 없음)
// purpose: 케이스 목적 골격 템플릿. {subcat}은 소분류명으로 치환.
const ERROR_CATALOG = {
  qty_change: { // 수량/재화 변경
    label: '수량/재화 변경',
    patterns: {
      concurrent_dup: { stage: '예외', purpose: '{subcat} 동시 요청 시 중복 소모/적용되지 않는지 확인' },
      neg_zero:       { stage: '부정', purpose: '{subcat}에 음수 또는 0 값이 적용되지 않는지 확인' },
      no_rollback:    { stage: '예외', purpose: '{subcat} 처리 실패 시 변경분이 롤백되는지 확인' },
      over_max:       { stage: '부정', purpose: '{subcat} 최대치 초과 적용이 차단되는지 확인' },
    },
  },
  state_transition: { // 상태 전이
    label: '상태 전이',
    patterns: {
      force_quit_mid:    { stage: '예외', purpose: '{subcat} 중간 상태에서 강제 종료 후 재진입 시 상태가 정합한지 확인' },
      net_loss_mismatch: { stage: '예외', purpose: '{subcat} 진행 중 네트워크 끊김 후 상태 불일치가 없는지 확인' },
      dup_event:         { stage: '부정', purpose: '{subcat}에서 동일 이벤트 재발생 시 비정상 전이가 차단되는지 확인' },
    },
  },
  time_based: { // 시간 기반 기능
    label: '시간 기반 기능',
    patterns: {
      clock_tamper:     { stage: '부정', purpose: '{subcat}이(가) 클라이언트 시간 조작에 영향받지 않는지 확인' },
      boundary_renewal: { stage: '예외', purpose: '{subcat} 갱신 경계 시점에 처리가 정확한지 확인' },
      background_elapse:{ stage: '예외', purpose: '{subcat} 백그라운드 중 시간 경과가 올바르게 반영되는지 확인' },
    },
  },
  conditional_lock: { // 조건부 잠금/해제
    label: '조건부 잠금/해제',
    patterns: {
      stale_cache:        { stage: '부정', purpose: '{subcat} 조건 변경 직후 캐시 미반영으로 잘못된 허용/차단이 없는지 확인' },
      partial_conditions: { stage: '부정', purpose: '{subcat} 복수 조건 중 일부만 충족 시 차단되는지 확인' },
      relock_after:       { stage: '예외', purpose: '{subcat} 조건 충족 후 조건 상실 시 재잠금되는지 확인' },
    },
  },
  list_search: { // 목록/검색/페이지네이션
    label: '목록/검색/페이지네이션',
    patterns: {
      empty_list:   { stage: '예외', purpose: '{subcat} 0건(빈 목록) 상태가 올바르게 표시되는지 확인' },
      max_items:    { stage: '부정', purpose: '{subcat} 최대 항목 수 도달 시 처리가 올바른지 확인' },
      last_page:    { stage: '예외', purpose: '{subcat} 마지막 페이지 경계에서 표시가 올바른지 확인' },
      sort_persist: { stage: '예외', purpose: '{subcat} 정렬 기준 변경 후 기준이 유지되는지 확인' },
    },
  },
  text_input: { // 텍스트 입력
    label: '텍스트 입력',
    patterns: {
      over_maxlen:     { stage: '부정', purpose: '{subcat} 최대 길이 초과 입력이 차단되는지 확인' },
      special_chars:   { stage: '부정', purpose: '{subcat}에 특수문자/이모지 입력 시 처리가 올바른지 확인' },
      whitespace_only: { stage: '부정', purpose: '{subcat}에 공백만 입력 시 차단되는지 확인' },
      paste:           { stage: '예외', purpose: '{subcat}에 복사-붙여넣기 입력 시 처리가 올바른지 확인' },
    },
  },
  integration: { // 연동/인터페이스
    label: '연동/인터페이스',
    patterns: {
      propagation_miss: { stage: '예외', purpose: '{subcat} 완료 후 연동 화면에 결과가 반영되는지 확인' },
      dangling_ref:     { stage: '예외', purpose: '{subcat} 연동 대상 삭제 후 참조 오류가 없는지 확인' },
      order_inversion:  { stage: '부정', purpose: '{subcat} 순서 의존성이 역전된 경우 차단/보정되는지 확인' },
    },
  },
};

// ── G2 σ_BVA 4포인트 고정 사상 — 포인트당 1케이스 1방향 (P-20 생성 경로상 불가능) ──
// purpose의 {metric}/{value}/{label}은 BVA 항목으로 치환.
const SIGMA_BVA = {
  min_minus_1: { stage: '부정', direction: '하한 미만', purpose: '{subcat} {metric}이(가) {value}({label})일 때 차단/미발생을 확인' },
  min:         { stage: '정상', direction: '하한 경계', purpose: '{subcat} {metric}이(가) {value}({label})일 때 정상 동작을 확인' },
  max:         { stage: '정상', direction: '상한 경계', purpose: '{subcat} {metric}이(가) {value}({label})일 때 정상 동작을 확인' },
  max_plus_1:  { stage: '부정', direction: '상한 초과', purpose: '{subcat} {metric}이(가) {value}({label})일 때 차단/미발생을 확인' },
};
const BVA_POINT_ORDER = ['min_minus_1', 'min', 'max', 'max_plus_1'];

// ── G3 all-edges — 전이당 정확히 1케이스 (수학적 하한), stage 고정 정상 ──
const FSM_EDGE = {
  stage: '정상',
  // 대괄호 금지 — 트리 leaf 문법에서 [..]는 태그 예약 (렌더 관통 증명에서 적발, 2026-06-12)
  purpose: "{subcat}이(가) '{from}' 상태에서 {trigger} 시 '{to}' 상태로 전이되는지 확인",
};

// ── G1 σ_EP — 파티션당 1케이스 (valid=정상 / invalid=부정) ──
// 계약: B-4 포인트·B-6 결정·B-5 전이와 중복되는 파티션은 분석이 생략 (→참조 갈음)
const SIGMA_EP = {
  valid:   { stage: '정상', purpose: '{subcat} — {label} 시 {expect} 확인' },
  invalid: { stage: '부정', purpose: '{subcat} — {label} 시 {expect} 확인' },
};

// ── G4 MC/DC — 단층 AND/OR c조건 → c+1 케이스 (≤2c, 2^c 전조합 불필요) ──
const MCDC = {
  AND: {
    all:    { stage: '정상', purpose: '{subcat} — {conds} 모두 충족 시 {true_outcome} 확인' },
    single: { stage: '부정', purpose: '{subcat} — {cond}만 미충족 시 {false_outcome} 확인' },
  },
  OR: {
    none:   { stage: '부정', purpose: '{subcat} — {conds} 모두 미충족 시 {false_outcome} 확인' },
    single: { stage: '정상', purpose: '{subcat} — {cond}만 충족 시 {true_outcome} 확인' },
  },
};

// ── G5 pairwise — 조합행 stage 고정 정상, 목적은 인자=수준 나열 ──
const PAIRWISE_ROW = {
  stage: '정상',
  purpose: '{subcat} — {assigns} 조합에서 정상 동작 확인',
};

// ── G7 렌즈 8축 — 축당 stage 고정 사상 (tc-분석.md §3.5와 1:1) ──
const LENS_AXES = {
  L1: { label: '개수 경계', stage: '부정' },
  L2: { label: '빈/널', stage: '예외' },
  L3: { label: '반복/멱등', stage: '부정' },
  L4: { label: '생명주기', stage: '예외' },
  L5: { label: '동시성', stage: '예외' },
  L6: { label: '상태 중단', stage: '예외' },
  L7: { label: '역방향/제약', stage: '부정' },
  L8: { label: '세션/시간', stage: '예외' },
};

// 생성기 정렬 순서 (Sort 단계 동률 깨기 고정)
const GEN_ORDER = { G1: 1, G2: 2, G3: 3, G4: 4, G5: 5, G6: 6, G7: 7 };

module.exports = {
  ERROR_CATALOG, SIGMA_BVA, BVA_POINT_ORDER, FSM_EDGE,
  SIGMA_EP, MCDC, PAIRWISE_ROW, LENS_AXES, GEN_ORDER,
};
