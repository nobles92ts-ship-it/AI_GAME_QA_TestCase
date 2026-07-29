// ─── BVT(Trunk) 결과 Slack 전송 ─────────────────────────────────────────────
// 대시보드 M6 체크박스 → BVT(Trunk) 테스트 환경 정보를 설정된 QA 채널로 전송
// 용도: 100% PASS 상태에서 "테스트 진행 가능" 공지 (미통과 항목 있으면 ⚠️ 멘트로 대체)
// ⚠ tab_manager.gs와 전역 스코프 공유: SPREADSHEET_ID, DASHBOARD_TAB,
//   PC_COL, DATA_START_ROW는 tab_manager.gs 선언을 재사용 (재선언 금지)

const BVT_TAB         = 'BVT(Trunk)';
const BVT_INFO_RANGE  = 'K8:L18';
const BVT_LABEL_CELL  = 'M5';   // 대시보드 탭
const BVT_BUTTON_CELL = 'M6';
const BVT_STATUS_CELL = 'M7';

const SLACK_CHANNEL = ''; // 배포본: 채널 ID 미포함 — 사용 환경의 Slack 채널 ID를 입력하세요
const SLACK_TOKEN   = '__SLACK_TOKEN__'; // deploy_appscript.js가 배포 시 자동 치환

// ─── 설치형 onEdit 트리거 핸들러 ───────────────────────────────────────────
function onM6Edit(e) {
  if (e.range.getSheet().getName() !== DASHBOARD_TAB) return;
  if (e.range.getA1Notation() !== BVT_BUTTON_CELL) return;
  if (e.value !== 'TRUE') return;

  const ss    = e.source;
  const sheet = ss.getSheetByName(DASHBOARD_TAB);

  sheet.getRange(BVT_STATUS_CELL).setValue('⏳ 전송 중...');
  SpreadsheetApp.flush();

  try {
    sendBvtToSlack(ss);
    const now = Utilities.formatDate(new Date(), 'Asia/Seoul', 'MM/dd HH:mm');
    sheet.getRange(BVT_STATUS_CELL).setValue('✅ ' + now + ' 전송 완료');
  } catch (err) {
    sheet.getRange(BVT_STATUS_CELL).setValue('❌ 오류: ' + err.message);
  } finally {
    sheet.getRange(BVT_BUTTON_CELL).setValue(false);
    SpreadsheetApp.flush();
  }
}

// ─── 전송 메인 ─────────────────────────────────────────────────────────────
function sendBvtToSlack(ss) {
  if (!ss) ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const bvt = ss.getSheetByName(BVT_TAB);
  if (!bvt) throw new Error('"' + BVT_TAB + '" 탭을 찾을 수 없습니다.');

  // K8:L18을 라벨→표시값 맵으로 (행 순서가 바뀌어도 라벨로 찾음)
  const rows = bvt.getRange(BVT_INFO_RANGE).getDisplayValues();
  const info = {};
  for (const [label, value] of rows) {
    const key = String(label).trim();
    if (key) info[key] = String(value).trim();
  }

  const counts  = countBvtResults(bvt);
  const allPass = counts.pass > 0 && counts.fail === 0
               && counts.block === 0 && counts.pending === 0;
  const sheetUrl = 'https://docs.google.com/spreadsheets/d/' + SPREADSHEET_ID
                 + '/edit?gid=' + bvt.getSheetId();

  postToSlack(buildBvtBlocks(info, allPass, sheetUrl),
              'BVT(Trunk) 데일리 테스트 결과 — ' + (info['날짜/시간'] || ''));
}

// ─── H열(PC 결과) 집계 — 전 항목 통과 판정용 ──────────────────────────────
// tab_manager.gs getTabColor와 동일한 값 정규화 기준 (N/A는 통과 판정에서 무시)
function countBvtResults(sheet) {
  const counts = { pass: 0, fail: 0, block: 0, na: 0, pending: 0 };
  const lastRow = sheet.getLastRow();
  if (lastRow < DATA_START_ROW) return counts;

  const values = sheet.getRange(DATA_START_ROW, PC_COL, lastRow - DATA_START_ROW + 1, 1).getValues();
  for (const [val] of values) {
    const v = String(val).trim();
    if (v === '' || v === 'PC 결과') continue;
    if (v === 'PASS') counts.pass++;
    else if (v === 'FAIL') counts.fail++;
    else if (v === 'BLOCK') counts.block++;
    else if (v === 'N/A') counts.na++;
    else if (v === '미완료' || v === '미진행') counts.pending++;
  }
  return counts;
}

// ─── Block Kit 메시지 구성 ─────────────────────────────────────────────────
// 볼드는 멘트(notice) 한 줄만 — 나머지는 일반 텍스트 (강조 분산 방지)
function buildBvtBlocks(info, allPass, sheetUrl) {
  const get = function (k) { return info[k] || '-'; };

  const rev = info['클라이언트'] || '최신'; // 하루 3회 전송 → 어느 빌드인지 멘트에 명시
  const notice = allPass
    ? '*' + rev + ' 빌드 안정성 테스트가 완료되었습니다.*'
      + '\n아래 환경에서 플레이 가능하며, 이슈 발견 시 공유 부탁드립니다.'
      + '\n감사합니다.'
    : '⚠️ *미통과/미진행 항목이 있습니다 — 시트 결과 확인 후 진행해주세요.*';

  return [
    { type: 'section', text: { type: 'mrkdwn',
      text: 'BVT(Trunk) 데일리 테스트 결과 — ' + get('날짜/시간') } },
    { type: 'section', text: { type: 'mrkdwn', text: notice } },
    { type: 'section', text: { type: 'mrkdwn',
      text: '테스트 환경: ' + get('테스트 환경')
          + '\n클라이언트: ' + get('클라이언트') + '  |  서버: ' + get('서버') } },
    { type: 'section', text: { type: 'mrkdwn',
      text: '<' + sheetUrl + '|BVT(Trunk) 시트 바로가기>' } },
  ];
}

// ─── Slack chat.postMessage ────────────────────────────────────────────────
function postToSlack(blocks, fallbackText) {
  const res = UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', {
    method: 'post',
    contentType: 'application/json; charset=utf-8',
    headers: { Authorization: 'Bearer ' + SLACK_TOKEN },
    payload: JSON.stringify({ channel: SLACK_CHANNEL, blocks: blocks, text: fallbackText }),
    muteHttpExceptions: true,
  });
  const body = JSON.parse(res.getContentText());
  if (!body.ok) {
    throw new Error('Slack 전송 실패: ' + (body.error || 'HTTP ' + res.getResponseCode()));
  }
}

// ─── M6 체크박스 삽입 (1회 실행) ───────────────────────────────────────────
function setupM6Button() {
  const ss        = SpreadsheetApp.openById(SPREADSHEET_ID);
  const dashboard = ss.getSheetByName(DASHBOARD_TAB);
  if (!dashboard) throw new Error('"' + DASHBOARD_TAB + '" 탭을 찾을 수 없습니다.');

  dashboard.getRange(BVT_LABEL_CELL).setValue('BVT Slack 전송');

  const btn = dashboard.getRange(BVT_BUTTON_CELL);
  btn.clearContent();
  btn.insertCheckboxes();
  btn.setValue(false);
  btn.setNote('체크 → BVT(Trunk) 결과를 설정된 QA 채널로 전송');

  const status = dashboard.getRange(BVT_STATUS_CELL);
  status.setValue('');
  status.setFontColor('#888888');
  status.setFontSize(9);

  Logger.log('✔ M6 체크박스 삽입 완료');
}

// ─── 설치형 onEdit 트리거 등록 (1회 실행) ─────────────────────────────────
// 기존 onM3Edit 트리거는 건드리지 않음 — onM6Edit만 독립 등록
function setupBvtSlackTrigger() {
  for (const t of ScriptApp.getProjectTriggers()) {
    if (t.getHandlerFunction() === 'onM6Edit') {
      ScriptApp.deleteTrigger(t);
    }
  }
  ScriptApp.newTrigger('onM6Edit')
    .forSpreadsheet(SpreadsheetApp.openById(SPREADSHEET_ID))
    .onEdit()
    .create();
  Logger.log('✔ 설치형 onM6Edit 트리거 등록 완료');
}

// ─── 전체 셋업 (1회 실행) ─────────────────────────────────────────────────
function setupBvtSlackAll() {
  setupM6Button();
  setupBvtSlackTrigger();
  Logger.log('✅ BVT Slack 전송 셋업 완료');
}
