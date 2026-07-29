/**
 * TC 탭 색상 규칙 SSoT (Node.js)
 *
 * 동일 규칙 동기화 대상:
 *  - appscript/tab_manager.gs (Apps Script - getTabColor 함수)
 *
 * 임계값 변경 시 위 파일도 동일하게 수정할 것.
 */

/**
 * PC 결과 카운트를 받아 색상 키 반환
 * @param {{pending:number, failed:number, completed:number}} counts
 * @returns {'DEFAULT'|'YELLOW'|'RED'|'BLUE'}
 */
function getColorKey({ pending, failed, completed }) {
  const total = pending + failed + completed;
  if (total === 0) return 'DEFAULT';
  if (pending > 0 && (failed + completed) === 0) return 'DEFAULT';
  if (pending > 0 && (failed + completed) > 0) return 'YELLOW';
  if (pending === 0 && failed > 0) return 'RED';
  return 'BLUE';
}

/** 색상 키 → Slack 이모지 */
const SLACK_EMOJI = {
  DEFAULT: '⚪',
  YELLOW: '🟡',
  RED: '🔴',
  BLUE: '🔵',
};

/** 색상 키 → 의미 라벨 */
const LABEL = {
  DEFAULT: '미진행',
  YELLOW: '진행중',
  RED: '완료(FAIL)',
  BLUE: '완료(PASS)',
};

module.exports = { getColorKey, SLACK_EMOJI, LABEL };
