/**
 * tc_nav.gs — TC 이동 사이드바 [예시판]
 *
 * 배경: 셀에 든 링크는 구글 시트 기본 동작상 2클릭이 필요하고,
 *   단순 트리거(onSelectionChange)로 시트를 바꾸면 서버 상태만 바뀌고 화면이 따라오지 않는다(실측).
 *   사이드바 클릭은 "사용자가 시작한 실행"이라 UI 세션에 붙는다 — 그 차이를 노린다.
 *
 * 목록의 출처는 대시보드의 HYPERLINK 수식이다. 별도 매핑표를 두지 않으므로
 * 대시보드를 다시 생성해 TC 탭이 늘면 사이드바도 자동으로 따라간다.
 */

var TC_NAV_DASH = '대시보드';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('TC 이동')
    .addItem('사이드바 열기', 'openTcNav')
    .addToUi();
}

function openTcNav() {
  var html = HtmlService.createHtmlOutputFromFile('TcNavSidebar').setTitle('TC 이동');
  SpreadsheetApp.getUi().showSidebar(html);
}

/** 대시보드 섹션헤더의 HYPERLINK 수식에서 [{name, gid}] 를 대시보드 순서대로 뽑는다. */
function tcNavList() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var dash = ss.getSheetByName(TC_NAV_DASH);
  if (!dash) return [];

  var formulas = dash.getRange(1, 1, Math.min(dash.getLastRow(), 400), 12).getFormulas();
  var out = [];
  var seen = {};
  for (var r = 0; r < formulas.length; r++) {
    for (var c = 0; c < formulas[r].length; c++) {
      var f = formulas[r][c];
      if (!f) continue;
      var m = f.match(/^=HYPERLINK\("[^"]*[#&]gid=(\d+)"\s*,\s*"(.*)"\)$/i);
      if (!m) continue;
      var gid = m[1];
      if (seen[gid]) continue;
      seen[gid] = true;
      out.push({ gid: gid, name: m[2].replace(/""/g, '"') });
    }
  }
  return out;
}

/** 사이드바에서 호출 — 해당 시트로 이동한다. */
function tcNavGoto(gid) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (String(sheets[i].getSheetId()) === String(gid)) {
      ss.setActiveSheet(sheets[i]);
      return sheets[i].getName();
    }
  }
  return null;
}

/** 대시보드로 돌아가기. */
function tcNavHome() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var dash = ss.getSheetByName(TC_NAV_DASH);
  if (dash) ss.setActiveSheet(dash);
  return TC_NAV_DASH;
}
