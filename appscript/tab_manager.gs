// ─── 상수 설정 ─────────────────────────────────────────────────────────────
const FIXED_TABS_ORDER = ['대시보드', 'BVT(Trunk)'];
// 이름에 이 문자열이 들어간 탭은 정렬 대상에서 빼고 현재 자리를 그대로 유지한다.
// (색상 규칙은 기존과 동일하게 적용 — 순서만 고정)
const PINNED_NAME_KEYWORD = 'BVT';
const SPREADSHEET_ID   = '__SPREADSHEET_ID__'; // deploy_appscript.js가 배포 시 자동 치환
const PC_COL           = 8;   // H열 (1-based)
const DATA_START_ROW   = 2;
const DASHBOARD_TAB    = '대시보드';
const BUTTON_CELL      = 'M3';
const STATUS_CELL      = 'M4';

const COLORS = {
  YELLOW: '#FBBC04',
  RED:    '#EA4335',
  BLUE:   '#4285F4',  // 전부 통과 (적녹색맹 대응)
};

// ─── 설치형 onEdit 트리거 (6분 한도) ───────────────────────────────────────
// 단순 onEdit은 30초 제한 → 탭 40개+ 처리 시 중간에 끊김
// 설치형 트리거(setupOnEditTrigger)를 통해 등록해야 6분 한도 적용됨
function onM3Edit(e) {
  if (e.range.getSheet().getName() !== DASHBOARD_TAB) return;
  if (e.range.getA1Notation() !== BUTTON_CELL) return;
  if (e.value !== 'TRUE') return;

  const ss    = e.source;
  const sheet = ss.getSheetByName(DASHBOARD_TAB);

  sheet.getRange(STATUS_CELL).setValue('⏳ 실행 중...');
  SpreadsheetApp.flush();

  try {
    const stats = colorAndSortTabs(ss);
    const now = Utilities.formatDate(new Date(), 'Asia/Seoul', 'MM/dd HH:mm');
    const dash = stats.dashboardRebuilt ? ' / 대시보드🧹' : ' / 대시보드❌';
    sheet.getRange(STATUS_CELL).setValue(
      '✅ ' + now + ' (' + stats.total + '탭, 색상' + stats.colorChanged + '/이동' + stats.moved + dash + ')'
    );
  } catch (err) {
    sheet.getRange(STATUS_CELL).setValue('❌ 오류: ' + err.message);
  } finally {
    sheet.getRange(BUTTON_CELL).setValue(false);
    SpreadsheetApp.flush();
  }
}

// ─── 일일 스케줄 트리거 (매일 09:00 KST) ─────────────────────────────────
// SpreadsheetApp.openById 경로 사용. M4에 자동 실행 결과도 기록.
function dailyColorAndSort() {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(DASHBOARD_TAB);

  try {
    const stats = colorAndSortTabs(ss);
    const now = Utilities.formatDate(new Date(), 'Asia/Seoul', 'MM/dd HH:mm');
    if (sheet) {
      const dash = stats.dashboardRebuilt ? ' / 대시보드🧹' : ' / 대시보드❌';
      sheet.getRange(STATUS_CELL).setValue(
        '🕘 자동 ' + now + ' (' + stats.total + '탭, 색상' + stats.colorChanged + '/이동' + stats.moved + dash + ')'
      );
      SpreadsheetApp.flush();
    }
  } catch (err) {
    if (sheet) {
      sheet.getRange(STATUS_CELL).setValue('❌ 자동 오류: ' + err.message);
      SpreadsheetApp.flush();
    }
    throw err;
  }
}

// ─── 메인 함수 ─────────────────────────────────────────────────────────────
// 색상/순서 변경이 실제 필요한 경우에만 API 호출 → 성능 최적화
function colorAndSortTabs(ss) {
  if (!ss) ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const allSheets = ss.getSheets();

  const noColorSheets = [];
  const yellowSheets  = [];
  const redSheets     = [];
  const blueSheets    = [];

  let colorChanged = 0;

  // ─ 색상 판정 + 변경 필요 시에만 적용
  const pinnedNames = {};   // 정렬 제외 탭 (현재 자리 유지)
  for (const sheet of allSheets) {
    const name = sheet.getName();
    // 숨김 탭은 색상/정렬/이동 대상에서 제외 → 숨김 유지.
    // (setActiveSheet/moveActiveSheet가 숨김 시트를 활성화하면 숨김이 풀려 대시보드 필터를 통과해버림)
    if (sheet.isSheetHidden()) continue;

    const isPinned = name.indexOf(PINNED_NAME_KEYWORD) !== -1 || FIXED_TABS_ORDER.includes(name);
    if (isPinned) pinnedNames[name] = true;

    if (FIXED_TABS_ORDER.includes(name)) continue;

    const colorKey = getTabColor(sheet);
    const targetColor = colorKey === 'DEFAULT' ? null : COLORS[colorKey];

    // 현재 탭 색상 안전하게 추출 (RGB가 아닌 테마 색상일 수도 있음 → try/catch)
    let currentHex = null;
    try {
      const obj = sheet.getTabColorObject();
      if (obj && obj.getColorType() === SpreadsheetApp.ColorType.RGB) {
        currentHex = obj.asRgbColor().asHexString().toLowerCase();
      }
    } catch (e) {
      currentHex = null; // 비RGB → 강제 갱신 유도
    }
    const targetHex = targetColor ? targetColor.toLowerCase() : null;

    if (currentHex !== targetHex) {
      sheet.setTabColor(targetColor);
      colorChanged++;
    }

    if (isPinned) continue;   // 색상만 칠하고 정렬 버킷에는 넣지 않음

    switch (colorKey) {
      case 'RED':    redSheets.push(sheet);    break;
      case 'BLUE':   blueSheets.push(sheet);   break;
      case 'YELLOW': yellowSheets.push(sheet); break;
      default:       noColorSheets.push(sheet);
    }
  }

  // ─ 목표 순서 (1-based index)
  //   대시보드 = 항상 1번. 고정 탭(BVT 포함)은 지금 자리를 그대로 지키고,
  //   나머지 탭만 기본 → 노랑 → 빨강 → 파랑 순으로 남은 자리에 채운다.
  const dashSheet = ss.getSheetByName(DASHBOARD_TAB);
  const slotSheets = allSheets.filter(function (s) {
    return !s.isSheetHidden() && s.getName() !== DASHBOARD_TAB;
  });
  const sortedSheets = [].concat(noColorSheets, yellowSheets, redSheets, blueSheets);

  const slots = new Array(slotSheets.length);
  for (let i = 0; i < slotSheets.length; i++) {
    if (pinnedNames[slotSheets[i].getName()]) slots[i] = slotSheets[i];
  }
  let nextSorted = 0;
  for (let i = 0; i < slots.length; i++) {
    if (!slots[i]) slots[i] = sortedSheets[nextSorted++];
  }

  const desiredOrder = [];
  if (dashSheet) desiredOrder.push(dashSheet);
  desiredOrder.push(...slots);

  // ─ 위치가 다른 경우에만 이동 (이미 정렬된 탭은 건너뜀)
  let moved = 0;
  for (let i = 0; i < desiredOrder.length; i++) {
    const sheet = desiredOrder[i];
    const targetIdx = i + 1; // 1-based
    if (sheet.getIndex() !== targetIdx) {
      ss.setActiveSheet(sheet);
      ss.moveActiveSheet(targetIdx);
      moved++;
    }
  }

  // ─ 대시보드 재구성 (현재 노출 탭만 / 정렬된 순서 반영)
  //   dashboard_builder.gs의 rebuildDashboard 호출. 실패해도 색상/정렬은 유지.
  SpreadsheetApp.flush();
  let dashboardRebuilt = false;
  try {
    rebuildDashboard(ss);
    dashboardRebuilt = true;
  } catch (e) {
    console.error('대시보드 재구성 실패: ' + e.message);
  }

  return { total: desiredOrder.length, colorChanged: colorChanged, moved: moved, dashboardRebuilt: dashboardRebuilt };
}

// ─── 탭 색상 판정 ───────────────────────────────────────────────────────────
// ⚠ SSoT 동기화: scripts/util/color_rules.js의 getColorKey와 동일 로직 유지할 것.
//   (Slack 위젯, QA 위젯도 동일 임계값 사용)
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
  if (pending > 0 && (failed + completed) > 0)   return 'YELLOW';
  if (pending === 0 && failed > 0)               return 'RED';
  return 'BLUE';
}

// ─── 설치형 onEdit 트리거 등록 (1회 실행) ─────────────────────────────────
// 단순 onEdit(e) 트리거(30초 제한)를 대체. 설치형은 6분 한도.
function setupOnEditTrigger() {
  // 기존 onM3Edit 트리거 제거
  for (const t of ScriptApp.getProjectTriggers()) {
    if (t.getHandlerFunction() === 'onM3Edit') {
      ScriptApp.deleteTrigger(t);
    }
  }
  // 신규 설치형 onEdit 트리거 등록
  ScriptApp.newTrigger('onM3Edit')
    .forSpreadsheet(SpreadsheetApp.openById(SPREADSHEET_ID))
    .onEdit()
    .create();
  Logger.log('✔ 설치형 onM3Edit 트리거 등록 완료 (6분 한도)');
}

// ─── 일일 시간 트리거 설정 (1회 실행) ─────────────────────────────────────
function setupDailyTrigger() {
  // 기존 일일 트리거 제거 (옛 이름 colorAndSortTabs + 새 이름 dailyColorAndSort 모두)
  for (const t of ScriptApp.getProjectTriggers()) {
    const h = t.getHandlerFunction();
    if (h === 'colorAndSortTabs' || h === 'dailyColorAndSort') {
      ScriptApp.deleteTrigger(t);
    }
  }
  ScriptApp.newTrigger('dailyColorAndSort')
    .timeBased()
    .atHour(9)
    .everyDays(1)
    .inTimezone('Asia/Seoul')
    .create();
  Logger.log('✔ 매일 09:00 KST 트리거 등록 완료 (dailyColorAndSort)');
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
  btn.setNote('체크 → 탭 색상/정렬 갱신 (설치형, 6분 한도)');

  const status = dashboard.getRange(STATUS_CELL);
  status.setValue('');
  status.setFontColor('#888888');
  status.setFontSize(9);

  Logger.log('✔ M3 체크박스 삽입 완료');
}

// ─── 전체 셋업 (1회 실행) ─────────────────────────────────────────────────
// setupM3Button + setupOnEditTrigger + setupDailyTrigger를 한 번에
function setupAll() {
  setupM3Button();
  setupOnEditTrigger();
  setupDailyTrigger();
  Logger.log('✅ 전체 셋업 완료');
}

// ─── 일일 트리거 제외 셋업 (자동 실행 불필요한 시트용, 예: 8차) ──────────────
// setupM3Button + setupOnEditTrigger만 — 매일 09:00 자동 실행은 설치하지 않음
function setupAllNoDaily() {
  setupM3Button();
  setupOnEditTrigger();
  Logger.log('✅ 셋업 완료 (일일 09:00 트리거 제외 — 수동 M3 클릭만)');
}

// ─── 일일 트리거만 제거 (자동실행 OFF — 과거 데이터 시트용, 예: 6차) ──────────
// onM3Edit·onM6Edit(수동 버튼)은 건드리지 않음. 시간 기반 일일 트리거만 삭제.
function removeDailyTrigger() {
  let removed = 0;
  for (const t of ScriptApp.getProjectTriggers()) {
    const h = t.getHandlerFunction();
    if (h === 'colorAndSortTabs' || h === 'dailyColorAndSort') {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  }
  Logger.log('✔ 일일 트리거 제거 완료 (' + removed + '개 삭제)');
  return '일일 트리거 ' + removed + '개 삭제';
}
