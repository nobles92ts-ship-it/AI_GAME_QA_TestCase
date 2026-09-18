// ─── QA 대시보드 공유 Slack 전송 ───────────────────────────────────────────
// 대시보드 M6 체크박스 → 대시보드 통합 집계(BVT 제외)를 dexar-qa 채널로 전송
// 용도: 시트를 열지 않고도 현재 QA 진행 현황을 채널에 공유
// ⚠ tab_manager.gs와 전역 스코프 공유: SPREADSHEET_ID, DASHBOARD_TAB는
//   tab_manager.gs 선언을 재사용 (재선언 금지)

// 집계에서 뺄 탭명 키워드. tab_manager.gs의 PINNED_NAME_KEYWORD와 값은 같지만
// 일부러 참조하지 않는다 — 그 상수가 없는 옛 세대 tab_manager(6차 등) 위에도
// 이 파일만 얹어 쓸 수 있어야 한다.
const SHARE_EXCLUDE_KEYWORD = 'BVT';

const SHARE_LABEL_CELL  = 'M5';   // 대시보드 탭
const SHARE_BUTTON_CELL = 'M6';
const SHARE_STATUS_CELL = 'M7';

const SLACK_CHANNEL = 'C0AH0FERQRY'; // dexar-qa (qa-widget과 동일)
const SLACK_TOKEN   = '__SLACK_TOKEN__'; // deploy_appscript.js가 배포 시 자동 치환

// ─── 설치형 onEdit 트리거 핸들러 ───────────────────────────────────────────
function onM6Edit(e) {
  if (e.range.getSheet().getName() !== DASHBOARD_TAB) return;
  if (e.range.getA1Notation() !== SHARE_BUTTON_CELL) return;
  if (e.value !== 'TRUE') return;

  const ss    = e.source;
  const sheet = ss.getSheetByName(DASHBOARD_TAB);

  sheet.getRange(SHARE_STATUS_CELL).setValue('⏳ 전송 중...');
  SpreadsheetApp.flush();

  try {
    sendDashboardToSlack(ss);
    const now = Utilities.formatDate(new Date(), 'Asia/Seoul', 'MM/dd HH:mm');
    sheet.getRange(SHARE_STATUS_CELL).setValue('✅ ' + now + ' 전송 완료');
  } catch (err) {
    sheet.getRange(SHARE_STATUS_CELL).setValue('❌ 오류: ' + err.message);
  } finally {
    sheet.getRange(SHARE_BUTTON_CELL).setValue(false);
    SpreadsheetApp.flush();
  }
}

// ─── 전송 메인 ─────────────────────────────────────────────────────────────
function sendDashboardToSlack(ss) {
  if (!ss) ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const dashboard = ss.getSheetByName(DASHBOARD_TAB);
  if (!dashboard) throw new Error('"' + DASHBOARD_TAB + '" 탭을 찾을 수 없습니다.');

  const stat  = readDashboardTotals(dashboard);
  const feats = readFeatureRows(ss);
  const url   = 'https://docs.google.com/spreadsheets/d/' + SPREADSHEET_ID
              + '/edit?gid=' + dashboard.getSheetId();
  // 제목 '7차 마일스톤 통합 TC' → '7차'. 못 읽으면 웹 리포트 링크만 생략한다.
  const milestone = (String(ss.getName()).match(/(\d+차)/) || [])[1] || '';

  postToSlack(buildDashboardBlocks(stat, feats, milestone, url),
              'DX QA 대시보드 — PASS ' + stat.pc.PASS + ' / FAIL ' + stat.pc.FAIL);
}

// ─── 탭별 현황 읽기 ────────────────────────────────────────────────────────
// ⚠ 대시보드 블록(COUNTIF)이 아니라 각 탭의 H열을 직접 센다 — fetch_qa_status.js와 같은 방식.
//   대시보드는 '미진행' 문자열만 세서 빈칸을 빠뜨리고(7차 1탭 2%p 차이), 대시보드 갱신 전에
//   추가된 탭은 블록에 아예 없다(6차 1탭 누락). 금요일 리포트와 줄이 어긋나면 안 되므로 직접 센다.
//   ⚠ 차수별 excludeTabs(config)는 Apps Script가 못 읽는다 — 범용 4종 + BVT만 제외한다.
const SHARE_SKIP_TABS = ['대시보드', '템플릿', 'Template', 'Sheet1'];

function readFeatureRows(ss) {
  const names = ss.getSheets()
    .filter(function (s) { return !s.isSheetHidden(); })
    .map(function (s) { return s.getName(); })
    .filter(function (n) {
      return SHARE_SKIP_TABS.indexOf(n) === -1
          && n.toUpperCase().indexOf(SHARE_EXCLUDE_KEYWORD) === -1;
    });
  if (!names.length) return [];

  // 고급 Sheets 서비스로 1회 batchGet (appsscript.json의 enabledAdvancedServices)
  const ranges = names.map(function (n) { return "'" + n.replace(/'/g, "''") + "'!A:J"; });
  const res = Sheets.Spreadsheets.Values.batchGet(SPREADSHEET_ID, { ranges: ranges });
  const valueRanges = res.valueRanges || [];

  const out = [];
  for (let t = 0; t < names.length; t++) {
    const rows = valueRanges[t] && valueRanges[t].values ? valueRanges[t].values : [];
    if (rows.length < 2) continue;
    const c = { PASS: 0, FAIL: 0, BLOCK: 0, pending: 0, NA: 0 };
    let count = 0;
    for (let i = 1; i < rows.length; i++) {
      if (!rows[i] || !rows[i][0]) continue;   // TC ID 없으면 skip
      count++;
      const v = String(rows[i][7] || '').trim();   // H열 = PC 결과
      if (v === 'PASS') c.PASS++;
      else if (v === 'FAIL') c.FAIL++;
      else if (v === 'BLOCK') c.BLOCK++;
      else if (v === 'N/A') c.NA++;
      else c.pending++;                            // 빈칸도 미진행
    }
    out.push({ name: names[t], total: count, pc: c });
  }
  return out;
}

// 색상 규칙 SSoT = scripts/util/color_rules.js · tab_manager.gs getTabColor.
// 셋 중 하나를 고치면 나머지도 같이 고칠 것.
function shareColorEmoji(pending, failed, completed) {
  const total = pending + failed + completed;
  if (total === 0) return '⚪';
  if (pending > 0 && (failed + completed) === 0) return '⚪';
  if (pending > 0 && (failed + completed) > 0) return '🟡';
  if (pending === 0 && failed > 0) return '🔴';
  return '🔵';
}

// ─── 대시보드 통합 집계 읽기 (BVT 차감) ───────────────────────────────────
// 레이아웃(update_dashboard.js / dashboard_builder.gs):
//   A열='구분'인 행이 블록 헤더, 헤더행 C,E,G,… = 탭명(첫 블록은 '통합'),
//   +1행 PC·모바일, +2~+6행 PASS·FAIL·BLOCK·미진행·N/A
// '통합'은 BVT 포함 전체 합(COUNTIF)이므로 BVT 탭 블록을 같은 기준으로 차감한다.
// fetch_qa_status.js(위젯·웹 리포트)와 동일한 산식 — 두 경로의 수치가 어긋나지 않게 유지할 것.
const SHARE_METRIC_KEYS = ['PASS', 'FAIL', 'BLOCK', 'pending', 'NA'];

function readDashboardTotals(dashboard) {
  const rows = dashboard.getDataRange().getDisplayValues();
  const zero = function () { return { PASS: 0, FAIL: 0, BLOCK: 0, pending: 0, NA: 0 }; };
  // 칸 → 정수. '#REF!'·빈칸 같은 비숫자를 0으로 삼키지 않는다 (fail-closed).
  //   2026-09-11: 7차 통합 수식이 삭제된 탭을 참조해 12칸 전부 #REF! — 그때 M6을 눌렀다면
  //   0으로 읽고 BVT를 빼 PASS -409 · 합계 -456이 Slack으로 나갔다 (fetch_qa_status.js는 같은 날 먼저 막음).
  const toCount = function (row, col, what) {
    const raw = String(rows[row] ? rows[row][col] : '');
    const s = raw.replace(/,/g, '').trim();
    if (/^\d+$/.test(s)) return Number(s);
    throw new Error('대시보드 ' + String.fromCharCode(65 + col) + (row + 1) + '(' + what
      + ") 값이 숫자가 아닙니다: '" + raw + "' — 통합 수식이 없는 탭을 참조하면 #REF! 가 된다."
      + ' M3(대시보드 갱신)으로 재생성 후 다시 전송');
  };

  let total = null;
  const cut = zero();
  const cutTabs = [];

  for (let r = 0; r < rows.length; r++) {
    if (String(rows[r][0] || '').trim() !== '구분') continue;
    for (let c = 2; c < rows[r].length; c += 2) {
      const tab = String(rows[r][c] || '').trim();
      if (!tab) continue;
      const isTotal = tab === '통합';
      // 쓰는 칸(통합·BVT)만 읽는다 — 헤더행 M열의 M3 체크박스('FALSE')나
      // 다른 탭 블록의 #REF!가 전송을 막지 않게.
      if (!isTotal && tab.toUpperCase().indexOf(SHARE_EXCLUDE_KEYWORD) === -1) continue;
      const counts = zero();
      SHARE_METRIC_KEYS.forEach(function (k, i) {
        counts[k] = toCount(r + 2 + i, c, "'" + tab + "' PC " + k);
      });
      if (isTotal) {
        total = counts;
      } else {
        cutTabs.push(tab);
        SHARE_METRIC_KEYS.forEach(function (k) { cut[k] += counts[k]; });
      }
    }
  }

  // 파싱 실패 시 조용히 틀린 수치를 보내지 않는다 (fail-closed).
  if (!total) throw new Error("대시보드에서 '통합' 블록을 찾지 못했습니다 (레이아웃 변경 확인 필요)");

  const pc = zero();
  SHARE_METRIC_KEYS.forEach(function (k) { pc[k] = total[k] - cut[k]; });
  // 차감 결과가 음수 = 통합이 탭별 블록과 어긋났다. 음수를 Slack으로 보내지 않는다.
  const negative = SHARE_METRIC_KEYS
    .filter(function (k) { return pc[k] < 0; })
    .map(function (k) { return 'PC ' + k + '=' + pc[k]; });
  if (negative.length) {
    throw new Error("'통합'에서 제외 탭(" + cutTabs.join(', ') + ')을 뺀 값이 음수입니다: '
      + negative.join(', ') + ' — M3(대시보드 갱신)으로 재생성 필요');
  }

  const totalTC = SHARE_METRIC_KEYS.reduce(function (n, k) { return n + pc[k]; }, 0);
  const done    = pc.PASS + pc.FAIL + pc.BLOCK + pc.NA; // send_slack_qa.js와 동일한 'N/A 포함' 기준
  const rate    = totalTC > 0 ? Math.round(done / totalTC * 1000) / 10 : 0;

  return { pc: pc, totalTC: totalTC, done: done, rate: rate, cutTabs: cutTabs };
}

// ─── Block Kit 메시지 구성 ─────────────────────────────────────────────────
// 구성은 금요일 리포트(send_slack_qa.js buildMessage)와 같게 맞춘다 —
// KPI · 진행률 · 기능별 현황 · FAIL 현황 · 링크. 한쪽 형식을 바꾸면 다른 쪽도 맞출 것.
// (없는 것 하나: '등록된 버그' — Jira 조회는 Apps Script에서 못 한다.)
const SHARE_SECTION_LIMIT = 2900;   // Slack section text 한도 3000자 여유분

function buildDashboardBlocks(stat, feats, milestone, url) {
  const fmt = function (n) { return Number(n).toLocaleString('en-US'); };
  const today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  const dayName = ['일', '월', '화', '수', '목', '금', '토'][new Date().getDay()];
  const divLine = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  const section = function (t) { return { type: 'section', text: { type: 'mrkdwn', text: t } }; };
  const ms = milestone ? milestone + ' 마일스톤 | ' : '';

  // 기능별 현황 (금요일 리포트와 같은 산식·색상)
  const featLines = feats.map(function (s) {
    const target = s.total - s.pc.NA;
    const done = s.pc.PASS + s.pc.FAIL + s.pc.BLOCK;
    const rate = target > 0 ? Math.round(done / target * 100) : 0;
    const emoji = shareColorEmoji(s.pc.pending, s.pc.FAIL, s.pc.PASS + s.pc.BLOCK);
    return emoji + ' ' + s.name + ': ' + rate + '%' + (s.pc.FAIL > 0 ? ' (FAIL ' + s.pc.FAIL + ')' : '');
  });

  // 탭이 늘면 section 한도(3000자)를 넘어 전송이 통째로 거부된다 — 넘치면 쪼갠다.
  const featBlocks = [];
  let buf = '*기능별 현황*';
  for (let i = 0; i < featLines.length; i++) {
    if (buf.length + featLines[i].length + 1 > SHARE_SECTION_LIMIT) {
      featBlocks.push(section(buf));
      buf = '';
    }
    buf += (buf ? '\n' : '') + featLines[i];
  }
  featBlocks.push(section(buf || '*기능별 현황*\n-'));

  const totalFail = feats.reduce(function (n, s) { return n + s.pc.FAIL; }, 0);
  const failLines = feats
    .filter(function (s) { return s.pc.FAIL > 0; })
    .map(function (s) { return '• ' + s.name + ': ' + s.pc.FAIL + '건'; })
    .join('\n');

  const excluded = stat.cutTabs.length
    ? '\n_집계 제외: ' + stat.cutTabs.join(', ') + '_'
    : '';

  const links = (milestone
      ? '📋 <https://qa-report-deploy-phi.vercel.app/' + encodeURIComponent(milestone) + '/|'
        + milestone + ' 웹 리포트 보기>　　'
      : '')
    + '📊 <' + url + '|TC 시트 열기>';

  const blocks = [
    section('*📊 DX QA 대시보드 공유 — ' + ms + today + ' (' + dayName + ')*'),
    section('✅ PASS  *' + fmt(stat.pc.PASS) + '*　　❌ FAIL  *' + fmt(stat.pc.FAIL)
          + '*　　🚧 BLOCK  *' + fmt(stat.pc.BLOCK) + '*　　⏳ 미진행  *' + fmt(stat.pc.pending)
          + '*　　🚫 N/A  *' + fmt(stat.pc.NA) + '*'),
    section('*PC 진행률:* ' + stat.rate + '% (' + fmt(stat.done) + '/' + fmt(stat.totalTC)
          + '건, N/A 포함)' + excluded),
    section(divLine),
  ].concat(featBlocks).concat([
    section(divLine),
    section('*🐛 FAIL 현황 (' + totalFail + '건)*' + (failLines ? '\n' + failLines : '')),
    section(divLine),
    section(links),
    { type: 'context', elements: [{ type: 'mrkdwn',
      text: '_대시보드 공유 버튼 • ' + Utilities.formatDate(new Date(), 'Asia/Seoul', 'HH:mm') + '_' }] },
  ]);

  return blocks;
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

  dashboard.getRange(SHARE_LABEL_CELL).setValue('대시보드 공유');

  const btn = dashboard.getRange(SHARE_BUTTON_CELL);
  btn.clearContent();
  btn.insertCheckboxes();
  btn.setValue(false);
  btn.setNote('체크 → 대시보드 통합 현황(BVT 제외)을 dexar-qa 채널로 전송');

  const status = dashboard.getRange(SHARE_STATUS_CELL);
  status.setValue('');
  status.setFontColor('#888888');
  status.setFontSize(9);

  Logger.log('✔ M6 체크박스 삽입 완료');
}

// ─── 설치형 onEdit 트리거 등록 (1회 실행) ─────────────────────────────────
// 기존 onM3Edit 트리거는 건드리지 않음 — onM6Edit만 독립 등록
function setupDashboardShareTrigger() {
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
function setupDashboardShareAll() {
  setupM6Button();
  setupDashboardShareTrigger();
  Logger.log('✅ 대시보드 공유 전송 셋업 완료');
}
