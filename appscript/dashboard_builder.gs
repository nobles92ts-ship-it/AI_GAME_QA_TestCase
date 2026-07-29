/**
 * dashboard_builder.gs — 대시보드 재구성 (Apps Script 포팅판)
 *
 * scripts/util/update_dashboard.js 의 충실 포팅.
 *  - googleapis(Node) → Advanced Sheets Service(Apps Script)로 호출부만 교체
 *  - 요청 객체/수식/서식/색상은 update_dashboard.js와 동일하게 유지 (SSoT 동기화 대상)
 *  - 숨김(hidden) 탭 자동 제외 → "현재 노출 탭만" 대시보드에 반영
 *  - 숫자는 COUNTIF 라이브 수식 → 데이터 변경 시 자동 갱신
 *  - A:L 열만 수정. M열(M3 버튼)·Q열 이후(AI 메트릭)는 건드리지 않음
 *
 * ⚠ 전역 충돌 방지를 위해 상수·헬퍼를 전부 함수 내부에 둠.
 *   유일한 전역 심볼은 rebuildDashboard 하나.
 *
 * ⚠ Advanced Sheets Service 필요:
 *   편집기 → 서비스(+) → Google Sheets API 추가 (식별자 "Sheets", v4)
 *   deploy_appscript.js의 매니페스트 enabledAdvancedServices에 등록되어 있음.
 */
function rebuildDashboard(ss) {
  if (!ss) ss = SpreadsheetApp.getActiveSpreadsheet();
  const SPREADSHEET_ID = ss.getId();
  const DASHBOARD_NAME = '대시보드';

  // 대시보드에서 제외할 시트 (추가 제외가 필요하면 여기에. 숨김 탭은 아래에서 자동 제외)
  const EXCLUDED_SHEETS = [];

  const MAX_TC_PER_BLOCK = 5;   // 블록당 최대 TC 시트 수
  const BLOCK_HEIGHT = 8;       // 섹션헤더(1) + 플랫폼(1) + 데이터(6)
  const BLOCK_GAP = 2;          // 블록 사이 빈 행 수
  const TITLE_ROWS = 2;         // 타이틀(1) + 빈 행(1)

  const PLAT_COLS = { PC: 'H', '모바일': 'I' };
  const PLATFORMS = ['PC', '모바일'];
  const METRICS = ['PASS', 'FAIL', 'BLOCK', '미진행', 'N/A', '합계'];
  const ROW_LABELS = ['✅ PASS', '❌ FAIL', '🚫 BLOCK', '⏸ 미진행', '➖ N/A', '합계'];

  // ─── 색상 ──────────────────────────────────────────────────────────────
  const C = {
    TITLE_BG:    { red:0.102, green:0.137, blue:0.494 },
    HDR_BG:      { red:0.173, green:0.243, blue:0.694 },
    TOTAL_HDR:   { red:0.200, green:0.380, blue:0.600 },
    PLAT_BG:     { red:0.384, green:0.467, blue:0.824 },
    TOTAL_BG:    { red:0.992, green:0.945, blue:0.800 },
    WHITE:       { red:1, green:1, blue:1 },
    BLACK:       { red:0, green:0, blue:0 },
    PASS_CELL:   { red:0.878, green:0.969, blue:0.886 },
    PASS_LABEL:  { red:0.678, green:0.878, blue:0.698 },
    FAIL_CELL:   { red:1.000, green:0.894, blue:0.894 },
    FAIL_LABEL:  { red:0.980, green:0.737, blue:0.737 },
    BLOCK_CELL:  { red:1.000, green:0.957, blue:0.867 },
    BLOCK_LABEL: { red:1.000, green:0.867, blue:0.647 },
    MJ_CELL:     { red:0.933, green:0.933, blue:0.933 },
    MJ_LABEL:    { red:0.800, green:0.800, blue:0.800 },
    NA_CELL:     { red:0.878, green:0.878, blue:0.878 },
    NA_LABEL:    { red:0.700, green:0.700, blue:0.700 },
    SUM_CELL:    { red:0.867, green:0.937, blue:0.984 },
    SUM_LABEL:   { red:0.635, green:0.831, blue:0.953 },
  };
  const ROW_STYLES = [
    { label: C.PASS_LABEL,  cell: C.PASS_CELL  },
    { label: C.FAIL_LABEL,  cell: C.FAIL_CELL  },
    { label: C.BLOCK_LABEL, cell: C.BLOCK_CELL },
    { label: C.MJ_LABEL,    cell: C.MJ_CELL    },
    { label: C.NA_LABEL,    cell: C.NA_CELL    },
    { label: C.SUM_LABEL,   cell: C.SUM_CELL   },
  ];

  // ─── 수식 빌더 ─────────────────────────────────────────────────────────
  const ref = name => `'${name.replace(/'/g, "''")}'`;
  const countif = (sheet, col, val) => `COUNTIF(${ref(sheet)}!${col}:${col},"${val}")`;
  const sumFormula = (sheet, col) =>
    `SUMPRODUCT(COUNTIF(${ref(sheet)}!${col}:${col},{"PASS","FAIL","BLOCK","미진행","N/A"}))`;
  const totalFormula = (tcSheets, col, metric) =>
    metric === '합계'
      ? '=' + tcSheets.map(s => sumFormula(s, col)).join('+')
      : '=' + tcSheets.map(s => countif(s, col, metric)).join('+');
  const sheetFormula = (sheetName, col, metric) =>
    metric === '합계' ? `=${sumFormula(sheetName, col)}` : `=${countif(sheetName, col, metric)}`;

  // ─── 헬퍼 ──────────────────────────────────────────────────────────────
  const mix = (a, b) => ({ red:(a.red+b.red)/2, green:(a.green+b.green)/2, blue:(a.blue+b.blue)/2 });
  function colLetter(c) {
    let result = '', n = c + 1;
    while (n > 0) { const rem = (n - 1) % 26; result = String.fromCharCode(65 + rem) + result; n = Math.floor((n - 1) / 26); }
    return result;
  }
  const sCol = si => 2 + si * 2;
  const blockStartRow = k => TITLE_ROWS + k * (BLOCK_HEIGHT + BLOCK_GAP);
  const R = (sheetId, r1, c1, r2, c2) =>
    ({ sheetId, startRowIndex:r1, endRowIndex:r2, startColumnIndex:c1, endColumnIndex:c2 });
  const cellFmt = (bg, fg=C.BLACK, bold=false, hAlign='CENTER', vAlign='MIDDLE', wrap='CLIP', size=10) =>
    ({ backgroundColor:bg, textFormat:{foregroundColor:fg, bold, fontSize:size}, horizontalAlignment:hAlign, verticalAlignment:vAlign, wrapStrategy:wrap });
  const repeat = (rng, fmt) =>
    ({ repeatCell: { range:rng, cell:{ userEnteredFormat:fmt }, fields:'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)' } });
  function addBorder(SID, r1, c1, r2, c2, thick=false) {
    const outer = { style: thick ? 'SOLID_MEDIUM':'SOLID', colorStyle:{ rgbColor:{ red:0.3, green:0.3, blue:0.3 } } };
    const inner = { style:'SOLID', colorStyle:{ rgbColor:{ red:0.7, green:0.7, blue:0.7 } } };
    return { updateBorders: { range:R(SID,r1,c1,r2,c2), top:outer, bottom:outer, left:outer, right:outer, innerHorizontal:inner, innerVertical:inner } };
  }

  // ─── 메인 ──────────────────────────────────────────────────────────────
  // 1. 시트 목록 (현재 탭 순서 = M3 정렬 직후 순서를 그대로 따름)
  const meta = Sheets.Spreadsheets.get(SPREADSHEET_ID);
  const dashSheet = meta.sheets.find(s => s.properties.title === DASHBOARD_NAME);
  if (!dashSheet) throw new Error('"대시보드" 탭을 찾을 수 없습니다.');
  const SID = dashSheet.properties.sheetId;

  const tcSheets = meta.sheets
    .filter(s => s.properties.title !== DASHBOARD_NAME)
    .filter(s => EXCLUDED_SHEETS.indexOf(s.properties.title) === -1)
    .filter(s => !s.properties.hidden)     // 숨김 탭 제외 = 현재 노출 탭만
    .map(s => s.properties.title);

  const sheetGidMap = {};
  meta.sheets.forEach(s => { sheetGidMap[s.properties.title] = s.properties.sheetId; });

  console.log(`TC 시트(${tcSheets.length}개): ${tcSheets.join(', ')}`);

  // 블록 분할: 첫 블록=[통합만], 이후=[TC시트 5개씩]
  const chunks = [['통합']];
  for (let i = 0; i < tcSheets.length; i += MAX_TC_PER_BLOCK) {
    chunks.push(tcSheets.slice(i, i + MAX_TC_PER_BLOCK));
  }

  const maxSections = Math.max(...chunks.map(c => c.length));
  const totalCols = 2 + maxSections * 2;
  const totalRows = blockStartRow(chunks.length) + 5;
  const panelCol = 5; // 진행률 패널 시작 열 F

  // 2. 그리드 크기 확보
  const gp = dashSheet.properties.gridProperties;
  if (gp.columnCount < panelCol + 3 || gp.rowCount < totalRows) {
    Sheets.Spreadsheets.batchUpdate({ requests: [{ updateSheetProperties: {
      properties: { sheetId: SID, gridProperties: {
        columnCount: Math.max(gp.columnCount, panelCol + 4),
        rowCount:    Math.max(gp.rowCount, totalRows + 10),
      }},
      fields: 'gridProperties.columnCount,gridProperties.rowCount'
    }}] }, SPREADSHEET_ID);
  }

  // 3. 초기화 (A:L 한정 — M열 이후 AI 메트릭 영역은 보존)
  Sheets.Spreadsheets.Values.clear({}, SPREADSHEET_ID, `${DASHBOARD_NAME}!A:L`);
  Sheets.Spreadsheets.batchUpdate({ requests: [
    { unmergeCells: { range: R(SID, 0, 0, 200, 12) } },
    { repeatCell: { range: R(SID, 0, 0, 200, 12), cell: {}, fields: 'userEnteredFormat' } },
  ]}, SPREADSHEET_ID);

  // 4. 값 + 수식 입력
  const updates = [];
  updates.push({ range:`${DASHBOARD_NAME}!A1`, values:[['DX 전체 TC 현황 대시보드']] });

  for (let k = 0; k < chunks.length; k++) {
    const sections = chunks[k];
    const base = blockStartRow(k);
    const r = base + 1;

    updates.push({ range:`${DASHBOARD_NAME}!A${r}`, values:[['구분']] });

    sections.forEach((sec, si) => {
      const gid = sheetGidMap[sec];
      const val = (sec === '통합')
        ? sec
        : `=HYPERLINK("https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit#gid=${gid}","${sec.replace(/"/g, '""')}")`;
      updates.push({ range:`${DASHBOARD_NAME}!${colLetter(sCol(si))}${r}`, values:[[val]] });
    });

    updates.push({
      range: `${DASHBOARD_NAME}!${colLetter(sCol(0))}${r + 1}`,
      values: [sections.flatMap(() => PLATFORMS)],
    });

    METRICS.forEach((metric, mi) => {
      const rowData = [ROW_LABELS[mi], ''];
      sections.forEach(sec => {
        PLATFORMS.forEach(p => {
          const col = PLAT_COLS[p];
          rowData.push(sec === '통합' ? totalFormula(tcSheets, col, metric) : sheetFormula(sec, col, metric));
        });
      });
      updates.push({ range:`${DASHBOARD_NAME}!A${r + 2 + mi}`, values:[rowData] });
    });
  }

  // ── 진행률 패널 (통합 블록 우측, 수식 기반) ──
  {
    const pCL = colLetter(panelCol);
    const pCB = colLetter(panelCol + 1);
    const pr0 = blockStartRow(0) + 1;
    const pcR = pr0 + 2, pfR = pr0 + 3, pbR = pr0 + 4, pmR = pr0 + 5, pnR = pr0 + 6, psR = pr0 + 7;

    updates.push({ range:`${DASHBOARD_NAME}!${pCL}${pr0}`, values:[['진행 현황']] });
    updates.push({ range:`${DASHBOARD_NAME}!${pCL}${pr0+1}`, values:[['PC']] });
    updates.push({ range:`${DASHBOARD_NAME}!${pCB}${pr0+1}`, values:[[
      `=SPARKLINE({C${pcR},C${pfR},C${pbR},C${pmR},C${pnR}},{"charttype","bar";"color1","#4285F4";"color2","#EA4335";"color3","#212121";"color4","#BDBDBD";"color5","#9E9E9E";"max",C${psR}})`
    ]] });
    updates.push({ range:`${DASHBOARD_NAME}!${pCB}${pr0+2}`, values:[[
      `=IFERROR(TEXT(C${pcR}/(C${psR}-C${pnR}),"0.0%")&" PASS  /  "&TEXT(C${pfR}/(C${psR}-C${pnR}),"0.0%")&" FAIL","미진행")`
    ]] });
    updates.push({ range:`${DASHBOARD_NAME}!${pCL}${pr0+3}`, values:[['모바일']] });
    updates.push({ range:`${DASHBOARD_NAME}!${pCB}${pr0+3}`, values:[[
      `=SPARKLINE({D${pcR},D${pfR},D${pbR},D${pmR},D${pnR}},{"charttype","bar";"color1","#4285F4";"color2","#EA4335";"color3","#212121";"color4","#BDBDBD";"color5","#9E9E9E";"max",D${psR}})`
    ]] });
    updates.push({ range:`${DASHBOARD_NAME}!${pCB}${pr0+4}`, values:[[
      `=IFERROR(TEXT(D${pcR}/(D${psR}-D${pnR}),"0.0%")&" PASS  /  "&TEXT(D${pfR}/(D${psR}-D${pnR}),"0.0%")&" FAIL","미진행")`
    ]] });
  }

  Sheets.Spreadsheets.Values.batchUpdate(
    { valueInputOption:'USER_ENTERED', data:updates }, SPREADSHEET_ID);

  // 5. 서식 적용
  const reqs = [];
  reqs.push({ mergeCells: { range:R(SID, 0, 0, 1, totalCols), mergeType:'MERGE_ALL' } });
  reqs.push(repeat(R(SID, 0, 0, 1, totalCols), cellFmt(C.TITLE_BG, C.WHITE, true, 'CENTER', 'MIDDLE', 'CLIP', 16)));
  reqs.push(addBorder(SID, 0, 0, 1, totalCols, true));

  for (let k = 0; k < chunks.length; k++) {
    const sections = chunks[k];
    const numSec = sections.length;
    const base = blockStartRow(k);
    const blockEndCol = sCol(numSec - 1) + 2;
    const hasTotal = sections[0] === '통합';

    reqs.push({ mergeCells: { range:R(SID, base, 0, base+2, 1), mergeType:'MERGE_ALL' } });
    sections.forEach((_, si) => {
      reqs.push({ mergeCells: { range:R(SID, base, sCol(si), base+1, sCol(si)+2), mergeType:'MERGE_ALL' } });
    });

    reqs.push(repeat(R(SID, base, 0, base+1, 1), cellFmt(C.TOTAL_HDR, C.WHITE, true, 'CENTER', 'MIDDLE', 'CLIP', 11)));
    sections.forEach((_, si) => {
      const isTotal = si === 0 && hasTotal;
      reqs.push(repeat(
        R(SID, base, sCol(si), base+1, sCol(si)+2),
        cellFmt(isTotal ? C.TOTAL_HDR : C.HDR_BG, C.WHITE, true, 'CENTER', 'MIDDLE', 'WRAP', isTotal ? 11 : 10)
      ));
    });

    reqs.push(repeat(R(SID, base+1, sCol(0), base+2, blockEndCol), cellFmt(C.PLAT_BG, C.WHITE, true, 'CENTER', 'MIDDLE', 'CLIP', 10)));

    ROW_STYLES.forEach(({ label, cell }, mi) => {
      const ri = base + 2 + mi;
      reqs.push(repeat(R(SID, ri, 0, ri+1, 1), cellFmt(label, C.BLACK, true, 'LEFT', 'MIDDLE', 'CLIP')));
      reqs.push(repeat(R(SID, ri, 1, ri+1, 2), cellFmt(C.WHITE, C.WHITE)));
      if (hasTotal) {
        reqs.push(repeat(R(SID, ri, sCol(0), ri+1, sCol(0)+2), cellFmt(mix(cell, C.TOTAL_BG), C.BLACK, true, 'CENTER', 'MIDDLE', 'CLIP')));
        if (numSec > 1) {
          reqs.push(repeat(R(SID, ri, sCol(1), ri+1, blockEndCol), cellFmt(cell, C.BLACK, mi===5, 'CENTER', 'MIDDLE', 'CLIP')));
        }
      } else {
        reqs.push(repeat(R(SID, ri, sCol(0), ri+1, blockEndCol), cellFmt(cell, C.BLACK, mi===5, 'CENTER', 'MIDDLE', 'CLIP')));
      }
    });

    reqs.push({
      repeatCell: {
        range: R(SID, base+2, 2, base+2+METRICS.length, blockEndCol),
        cell: { userEnteredFormat: { numberFormat:{ type:'NUMBER', pattern:'#,##0' } } },
        fields: 'userEnteredFormat.numberFormat'
      }
    });

    reqs.push(addBorder(SID, base, 0, base+2, 1, true));
    sections.forEach((_, si) => {
      reqs.push(addBorder(SID, base, sCol(si), base+1, sCol(si)+2, true));
      reqs.push(addBorder(SID, base+1, sCol(si), base+2, sCol(si)+2));
      reqs.push(addBorder(SID, base+2, sCol(si), base+2+METRICS.length, sCol(si)+2, true));
    });
    reqs.push(addBorder(SID, base, 0, base+2+METRICS.length, 1, true));
  }

  // ── 진행률 패널 서식 ──
  {
    const pC = panelCol;
    const pb0 = blockStartRow(0);

    reqs.push({ mergeCells: { range:R(SID, pb0, pC, pb0+1, pC+2), mergeType:'MERGE_ALL' } });
    reqs.push(repeat(R(SID, pb0, pC, pb0+1, pC+2), cellFmt(C.TOTAL_HDR, C.WHITE, true, 'CENTER', 'MIDDLE', 'CLIP', 11)));

    reqs.push(repeat(R(SID, pb0+1, pC,   pb0+2, pC+1), cellFmt(C.PLAT_BG, C.WHITE, true, 'CENTER', 'MIDDLE', 'CLIP', 10)));
    reqs.push(repeat(R(SID, pb0+1, pC+1, pb0+2, pC+2), cellFmt(C.WHITE, C.BLACK, false, 'CENTER', 'MIDDLE', 'CLIP', 10)));
    reqs.push({ mergeCells: { range:R(SID, pb0+2, pC, pb0+3, pC+2), mergeType:'MERGE_ALL' } });
    reqs.push(repeat(R(SID, pb0+2, pC, pb0+3, pC+2), cellFmt(C.PASS_CELL, C.BLACK, false, 'CENTER', 'MIDDLE', 'CLIP', 9)));

    reqs.push(repeat(R(SID, pb0+3, pC,   pb0+4, pC+1), cellFmt(C.PLAT_BG, C.WHITE, true, 'CENTER', 'MIDDLE', 'CLIP', 10)));
    reqs.push(repeat(R(SID, pb0+3, pC+1, pb0+4, pC+2), cellFmt(C.WHITE, C.BLACK, false, 'CENTER', 'MIDDLE', 'CLIP', 10)));
    reqs.push({ mergeCells: { range:R(SID, pb0+4, pC, pb0+5, pC+2), mergeType:'MERGE_ALL' } });
    reqs.push(repeat(R(SID, pb0+4, pC, pb0+5, pC+2), cellFmt(C.PASS_CELL, C.BLACK, false, 'CENTER', 'MIDDLE', 'CLIP', 9)));

    reqs.push(repeat(R(SID, pb0+5, pC, pb0+8, pC+2), cellFmt(C.WHITE)));
    reqs.push(addBorder(SID, pb0, pC, pb0+8, pC+2, true));

    reqs.push({ updateDimensionProperties:{ range:{ sheetId:SID, dimension:'COLUMNS', startIndex:pC,   endIndex:pC+1 }, properties:{ pixelSize:60  }, fields:'pixelSize' } });
    reqs.push({ updateDimensionProperties:{ range:{ sheetId:SID, dimension:'COLUMNS', startIndex:pC+1, endIndex:pC+2 }, properties:{ pixelSize:200 }, fields:'pixelSize' } });
  }

  reqs.push({ updateDimensionProperties:{ range:{ sheetId:SID, dimension:'COLUMNS', startIndex:0, endIndex:1 }, properties:{ pixelSize:140 }, fields:'pixelSize' } });
  reqs.push({ updateDimensionProperties:{ range:{ sheetId:SID, dimension:'COLUMNS', startIndex:1, endIndex:2 }, properties:{ pixelSize:20  }, fields:'pixelSize' } });
  for (let c = 2; c < totalCols; c++) {
    reqs.push({ updateDimensionProperties:{ range:{ sheetId:SID, dimension:'COLUMNS', startIndex:c, endIndex:c+1 }, properties:{ pixelSize:80 }, fields:'pixelSize' } });
  }

  reqs.push({ updateDimensionProperties:{ range:{ sheetId:SID, dimension:'ROWS', startIndex:0, endIndex:1 }, properties:{ pixelSize:50 }, fields:'pixelSize' } });
  const ROW_HEIGHTS = [50, 30, 28, 28, 28, 28, 28, 30];
  for (let k = 0; k < chunks.length; k++) {
    const base = blockStartRow(k);
    ROW_HEIGHTS.forEach((px, ri) => {
      reqs.push({ updateDimensionProperties:{ range:{ sheetId:SID, dimension:'ROWS', startIndex:base+ri, endIndex:base+ri+1 }, properties:{ pixelSize:px }, fields:'pixelSize' } });
    });
  }

  for (let i = 0; i < reqs.length; i += 30) {
    Sheets.Spreadsheets.batchUpdate({ requests: reqs.slice(i, i+30) }, SPREADSHEET_ID);
  }

  console.log(`✅ 대시보드 재구성 완료 — TC 시트 ${tcSheets.length}개, 블록 ${chunks.length}개`);
  return { tcCount: tcSheets.length, blocks: chunks.length };
}
