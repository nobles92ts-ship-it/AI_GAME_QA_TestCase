// ─── 상수 설정 ─────────────────────────────────────────────────────────────
const FIXED_TABS_ORDER = ['대시보드', 'BVT(Trunk)'];
const SPREADSHEET_ID   = ''; // TODO: 배포 후 setupM3Button() / setupDailyTrigger() 실행 전 입력
const PC_COL           = 8;   // H열 (1-based)
const DATA_START_ROW   = 2;
const DASHBOARD_TAB    = '대시보드';
const BUTTON_CELL      = 'M3';
const STATUS_CELL      = 'M4';

const COLORS = {
  YELLOW: '#FBBC04',
  RED:    '#EA4335',
  BLUE:   '#4285F4',  // 전부 통과 (파란색, 적녹색맹 대응)
};

// ─── 단순 onEdit 트리거 ────────────────────────────────────────────────────
// e.source 사용 → 별도 인증 불필요, 자동 등록됨
function onEdit(e) {
  if (e.range.getSheet().getName() !== DASHBOARD_TAB) return;
  if (e.range.getA1Notation() !== BUTTON_CELL) return;
  if (e.value !== 'TRUE') return;

  const ss    = e.source;
  const sheet = ss.getSheetByName(DASHBOARD_TAB);

  sheet.getRange(STATUS_CELL).setValue('⏳ 실행 중...');
  SpreadsheetApp.flush();

  try {
    colorAndSortTabs(ss);
    const now = Utilities.formatDate(new Date(), 'Asia/Seoul', 'MM/dd HH:mm');
    sheet.getRange(STATUS_CELL).setValue('✅ 마지막 실행: ' + now);
  } catch (err) {
    sheet.getRange(STATUS_CELL).setValue('❌ 오류: ' + err.message);
  } finally {
    sheet.getRange(BUTTON_CELL).setValue(false);
    SpreadsheetApp.flush();
  }
}

// ─── 메인 함수 ─────────────────────────────────────────────────────────────
// onEdit에서는 ss를 직접 전달, 시간 트리거에서는 openById 사용
function colorAndSortTabs(ss) {
  if (!ss) ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const allSheets = ss.getSheets();

  const noColorSheets = [];
  const yellowSheets  = [];
  const redSheets     = [];
  const blueSheets    = [];

  for (const sheet of allSheets) {
    const name = sheet.getName();
    if (FIXED_TABS_ORDER.includes(name)) continue;

    const colorKey = getTabColor(sheet);
    switch (colorKey) {
      case 'RED':
        sheet.setTabColor(COLORS.RED);
        redSheets.push(sheet);
        break;
      case 'BLUE':
        sheet.setTabColor(COLORS.BLUE);
        blueSheets.push(sheet);
        break;
      case 'YELLOW':
        sheet.setTabColor(COLORS.YELLOW);
        yellowSheets.push(sheet);
        break;
      default:
        sheet.setTabColor(null);
        noColorSheets.push(sheet);
    }
  }

  // ① 대시보드(1) → BVT(2) 먼저 고정
  const dashSheet = ss.getSheetByName('대시보드');
  const bvtSheet  = ss.getSheetByName('BVT(Trunk)');
  if (dashSheet) { ss.setActiveSheet(dashSheet); ss.moveActiveSheet(1); }
  if (bvtSheet)  { ss.setActiveSheet(bvtSheet);  ss.moveActiveSheet(2); }

  // ② TC 탭들을 3번 자리부터 순서대로 배치
  const tcOrdered = [
    ...noColorSheets,
    ...yellowSheets,
    ...redSheets,
    ...blueSheets,
  ];

  for (let i = 0; i < tcOrdered.length; i++) {
    ss.setActiveSheet(tcOrdered[i]);
    ss.moveActiveSheet(3 + i);
  }
}

// ─── 탭 색상 판정 ───────────────────────────────────────────────────────────
function getTabColor(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < DATA_START_ROW) return 'DEFAULT';

  const numRows = lastRow - DATA_START_ROW + 1;
  const values  = sheet.getRange(DATA_START_ROW, PC_COL, numRows, 1).getValues();

  let pending = 0, failed = 0, completed = 0;

  for (const [val] of values) {
    const v = String(val).trim();
    if (v === '' || v === 'PC 결과' || v === 'N/A') continue;
    if (v === '미완료' || v === '미진행') pending++;
    else if (v === 'FAIL') failed++;
    else if (v === 'PASS' || v === 'BLOCK') completed++;
  }

  const total = pending + failed + completed;
  if (total === 0)                               return 'DEFAULT';
  if (pending > 0 && (failed + completed) === 0) return 'DEFAULT';
  if (pending > 0 && (failed + completed) > 0)  return 'YELLOW';
  if (pending === 0 && failed > 0)               return 'RED';
  return 'BLUE';
}

// ─── 시간 트리거 설정 (1회 실행) ───────────────────────────────────────────
function setupDailyTrigger() {
  for (const t of ScriptApp.getProjectTriggers()) {
    if (t.getHandlerFunction() === 'colorAndSortTabs') {
      ScriptApp.deleteTrigger(t);
    }
  }
  ScriptApp.newTrigger('colorAndSortTabs')
    .timeBased()
    .atHour(9)
    .everyDays(1)
    .inTimezone('Asia/Seoul')
    .create();
  Logger.log('✔ 매일 09:00 KST 트리거 등록 완료');
}

// ─── M3 체크박스 삽입 (1회 실행) ───────────────────────────────────────────
function setupM3Button() {
  const ss        = SpreadsheetApp.openById(SPREADSHEET_ID);
  const dashboard = ss.getSheetByName(DASHBOARD_TAB);
  if (!dashboard) throw new Error('"대시보드" 탭을 찾을 수 없습니다.');

  const btn = dashboard.getRange(BUTTON_CELL);
  btn.clearContent();
  btn.insertCheckboxes();
  btn.setValue(false);
  btn.setNote('체크 → 탭 색상/정렬 갱신');

  const status = dashboard.getRange(STATUS_CELL);
  status.setValue('');
  status.setFontColor('#888888');
  status.setFontSize(9);

  Logger.log('✔ M3 체크박스 삽입 완료');
}
