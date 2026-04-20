/**
 * 대시보드 수식 설정 스크립트 (v2: 블록별 수직 배치)
 * - TC 시트 자동 감지 후 레이아웃 구성
 * - MAX_TC_PER_BLOCK 초과 시 다음 블록을 아래에 생성
 * - 새 TC 시트 추가 시에만 이 스크립트 재실행
 */
const { getAuthClient } = require('./google_auth');
const { google } = require('googleapis');

const argId = process.argv[2];
if (!argId && !process.env.SPREADSHEET_ID) {
  console.error('사용법: node update_dashboard.js <스프레드시트ID>');
  process.exit(1);
}
const SPREADSHEET_ID = argId || process.env.SPREADSHEET_ID;
const DASHBOARD_NAME = '대시보드';

// 대시보드에서 제외할 시트 목록 (숨김 처리된 시트)
const EXCLUDED_SHEETS = [];

const MAX_TC_PER_BLOCK = 5;   // 블록당 최대 TC 시트 수 (전체 제외)
const BLOCK_HEIGHT    = 8;    // 섹션헤더(1) + 플랫폼(1) + 데이터(6)
const BLOCK_GAP       = 2;    // 블록 사이 빈 행 수
const TITLE_ROWS      = 2;    // 타이틀(1) + 빈 행(1)

const PLAT_COLS = { PC: 'H', 모바일: 'I' };
const PLATFORMS  = ['PC', '모바일'];
const METRICS    = ['PASS', 'FAIL', 'BLOCK', '미진행', 'N/A', '합계'];
const ROW_LABELS = ['✅ PASS', '❌ FAIL', '🚫 BLOCK', '⏸ 미진행', '➖ N/A', '합계'];

// ─── 색상 ────────────────────────────────────────────────────────────────
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

// ─── 수식 빌더 ───────────────────────────────────────────────────────────
const ref = name => `'${name.replace(/'/g, "''")}'`;
const countif = (sheet, col, val) =>
  `COUNTIF(${ref(sheet)}!${col}:${col},"${val}")`;
const sumFormula = (sheet, col) =>
  `SUMPRODUCT(COUNTIF(${ref(sheet)}!${col}:${col},{"PASS","FAIL","BLOCK","미진행","N/A"}))`;

function totalFormula(tcSheets, col, metric) {
  if (metric === '합계') return '=' + tcSheets.map(s => sumFormula(s, col)).join('+');
  return '=' + tcSheets.map(s => countif(s, col, metric)).join('+');
}
function sheetFormula(sheetName, col, metric) {
  if (metric === '합계') return `=${sumFormula(sheetName, col)}`;
  return `=${countif(sheetName, col, metric)}`;
}

// ─── 헬퍼 ────────────────────────────────────────────────────────────────
const mix = (a, b) => ({ red:(a.red+b.red)/2, green:(a.green+b.green)/2, blue:(a.blue+b.blue)/2 });
function colLetter(c) {
  let result = '';
  let n = c + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}
const sCol = si => 2 + si * 2;
const blockStartRow = k => TITLE_ROWS + k * (BLOCK_HEIGHT + BLOCK_GAP);

function R(sheetId, r1, c1, r2, c2) {
  return { sheetId, startRowIndex:r1, endRowIndex:r2, startColumnIndex:c1, endColumnIndex:c2 };
}
function cellFmt(bg, fg=C.BLACK, bold=false, hAlign='CENTER', vAlign='MIDDLE', wrap='CLIP', size=10) {
  return { backgroundColor:bg, textFormat:{foregroundColor:fg, bold, fontSize:size}, horizontalAlignment:hAlign, verticalAlignment:vAlign, wrapStrategy:wrap };
}
function repeat(rng, fmt) {
  return { repeatCell: { range:rng, cell:{ userEnteredFormat:fmt }, fields:'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)' } };
}
function addBorder(SID, r1, c1, r2, c2, thick=false) {
  const outer = { style: thick ? 'SOLID_MEDIUM':'SOLID', colorStyle:{ rgbColor:{ red:0.3, green:0.3, blue:0.3 } } };
  const inner = { style:'SOLID', colorStyle:{ rgbColor:{ red:0.7, green:0.7, blue:0.7 } } };
  return { updateBorders: { range:R(SID,r1,c1,r2,c2), top:outer, bottom:outer, left:outer, right:outer, innerHorizontal:inner, innerVertical:inner } };
}

// ─── 메인 ────────────────────────────────────────────────────────────────
async function updateDashboard() {
  const auth = await getAuthClient();
  const sheets = google.sheets({ version:'v4', auth });

  // 1. 시트 목록 가져오기
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const dashSheet = meta.data.sheets.find(s => s.properties.title === DASHBOARD_NAME);
  const SID = dashSheet.properties.sheetId;

  const tcSheets = meta.data.sheets
    .filter(s => s.properties.title !== DASHBOARD_NAME)
    .filter(s => !EXCLUDED_SHEETS.includes(s.properties.title))
    .filter(s => !s.properties.hidden)
    .map(s => s.properties.title);

  // 시트명 → gid 맵 (하이퍼링크용)
  const sheetGidMap = {};
  meta.data.sheets.forEach(s => {
    sheetGidMap[s.properties.title] = s.properties.sheetId;
  });

  console.log(`TC 시트(${tcSheets.length}개): ${tcSheets.join(', ')}`);

  // 블록 분할: 첫 블록=[통합만], 이후=[TC시트 5개씩]
  const chunks = [['통합']];
  for (let i = 0; i < tcSheets.length; i += MAX_TC_PER_BLOCK) {
    chunks.push(tcSheets.slice(i, i + MAX_TC_PER_BLOCK));
  }

  const maxSections = Math.max(...chunks.map(c => c.length));
  const totalCols   = 2 + maxSections * 2;
  const totalRows   = blockStartRow(chunks.length) + 5; // 여유 행 포함
  const panelCol    = 5;  // 진행률 패널 시작 열: F열 (통합 블록 D열 바로 오른쪽 + gap 1칸)

  console.log(`블록 수: ${chunks.length}개, 열: ${totalCols}개 (${colLetter(totalCols-1)}열까지)`);

  // 2. 그리드 크기 확보
  const currentColCount = dashSheet.properties.gridProperties.columnCount;
  const currentRowCount = dashSheet.properties.gridProperties.rowCount;
  if (currentColCount < panelCol + 3 || currentRowCount < totalRows) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ updateSheetProperties: {
        properties: { sheetId: SID, gridProperties: {
          columnCount: Math.max(currentColCount, panelCol + 4),
          rowCount:    Math.max(currentRowCount, totalRows + 10),
        }},
        fields: 'gridProperties.columnCount,gridProperties.rowCount'
      }}] }
    });
    console.log(`  그리드 확장: ${currentColCount}열 → ${totalCols + 5}열`);
  }

  // 3. 초기화 (값 + 병합 + 서식 모두 초기화)
  console.log('초기화 중...');
  await sheets.spreadsheets.values.clear({ spreadsheetId:SPREADSHEET_ID, range:`${DASHBOARD_NAME}!A:AZ` });
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: [
      { unmergeCells: { range: R(SID, 0, 0, 200, 60) } },
      { repeatCell: {
          range: R(SID, 0, 0, 200, 60),
          cell: {},
          fields: 'userEnteredFormat'
      }},
    ]}
  });

  // 4. 값 + 수식 입력
  console.log('수식 입력 중...');
  const updates = [];
  updates.push({ range:`${DASHBOARD_NAME}!A1`, values:[['DX 전체 TC 현황 대시보드']] });

  for (let k = 0; k < chunks.length; k++) {
    const sections = chunks[k];
    const base = blockStartRow(k);  // 0-indexed 행 시작
    const r    = base + 1;          // 1-indexed (range 문자열용)

    // 구분 라벨
    updates.push({ range:`${DASHBOARD_NAME}!A${r}`, values:[['구분']] });

    // 섹션명 (하이퍼링크: 클릭 시 해당 시트로 이동)
    sections.forEach((sec, si) => {
      const gid = sheetGidMap[sec];
      const val = (sec === '통합')
        ? sec
        : `=HYPERLINK("https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit#gid=${gid}","${sec.replace(/"/g, '""')}")`;
      updates.push({ range:`${DASHBOARD_NAME}!${colLetter(sCol(si))}${r}`, values:[[val]] });
    });

    // 플랫폼 행
    updates.push({
      range: `${DASHBOARD_NAME}!${colLetter(sCol(0))}${r + 1}`,
      values: [sections.flatMap(() => PLATFORMS)],
    });

    // 데이터 행 (METRICS)
    METRICS.forEach((metric, mi) => {
      const rowData = [ROW_LABELS[mi], ''];
      sections.forEach(sec => {
        PLATFORMS.forEach(p => {
          const col = PLAT_COLS[p];
          rowData.push(sec === '통합'
            ? totalFormula(tcSheets, col, metric)
            : sheetFormula(sec, col, metric));
        });
      });
      updates.push({ range:`${DASHBOARD_NAME}!A${r + 2 + mi}`, values:[rowData] });
    });
  }

  // ── 진행률 패널 (통합 블록 우측, 수식 기반 자동 갱신) ──────────────────
  {
    const pCL  = colLetter(panelCol);      // 라벨 열 (좁)
    const pCB  = colLetter(panelCol + 1);  // 바 열   (넓)
    const pr0  = blockStartRow(0) + 1;     // 1-indexed 시작행 (통합 블록 첫 행)
    // 통합 데이터 셀: sCol(0)=2 → C열(PC), D열(모바일)
    const pcR = pr0 + 2;  // PASS  row (1-indexed)
    const pfR = pr0 + 3;  // FAIL  row
    const pbR = pr0 + 4;  // BLOCK row
    const pmR = pr0 + 5;  // 미진행 row
    const pnR = pr0 + 6;  // N/A   row
    const psR = pr0 + 7;  // 합계  row

    updates.push({ range:`${DASHBOARD_NAME}!${pCL}${pr0}`, values:[['진행 현황']] });

    // PC
    updates.push({ range:`${DASHBOARD_NAME}!${pCL}${pr0+1}`, values:[['PC']] });
    updates.push({ range:`${DASHBOARD_NAME}!${pCB}${pr0+1}`, values:[[
      `=SPARKLINE({C${pcR},C${pfR},C${pbR},C${pmR},C${pnR}},{"charttype","bar";"color1","#4285F4";"color2","#EA4335";"color3","#212121";"color4","#BDBDBD";"color5","#9E9E9E";"max",C${psR}})`
    ]] });
    updates.push({ range:`${DASHBOARD_NAME}!${pCB}${pr0+2}`, values:[[
      `=IFERROR(TEXT(C${pcR}/(C${psR}-C${pnR}),"0.0%")&" PASS  /  "&TEXT(C${pfR}/(C${psR}-C${pnR}),"0.0%")&" FAIL","미진행")`
    ]] });

    // 모바일
    updates.push({ range:`${DASHBOARD_NAME}!${pCL}${pr0+3}`, values:[['모바일']] });
    updates.push({ range:`${DASHBOARD_NAME}!${pCB}${pr0+3}`, values:[[
      `=SPARKLINE({D${pcR},D${pfR},D${pbR},D${pmR},D${pnR}},{"charttype","bar";"color1","#4285F4";"color2","#EA4335";"color3","#212121";"color4","#BDBDBD";"color5","#9E9E9E";"max",D${psR}})`
    ]] });
    updates.push({ range:`${DASHBOARD_NAME}!${pCB}${pr0+4}`, values:[[
      `=IFERROR(TEXT(D${pcR}/(D${psR}-D${pnR}),"0.0%")&" PASS  /  "&TEXT(D${pfR}/(D${psR}-D${pnR}),"0.0%")&" FAIL","미진행")`
    ]] });
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { valueInputOption:'USER_ENTERED', data:updates }
  });

  // 5. 서식 적용
  console.log('서식 적용 중...');
  const reqs = [];

  // 타이틀
  reqs.push({ mergeCells: { range:R(SID, 0, 0, 1, totalCols), mergeType:'MERGE_ALL' } });
  reqs.push(repeat(R(SID, 0, 0, 1, totalCols), cellFmt(C.TITLE_BG, C.WHITE, true, 'CENTER', 'MIDDLE', 'CLIP', 16)));
  reqs.push(addBorder(SID, 0, 0, 1, totalCols, true));

  for (let k = 0; k < chunks.length; k++) {
    const sections = chunks[k];
    const numSec  = sections.length;
    const base    = blockStartRow(k);
    const blockEndCol = sCol(numSec - 1) + 2;
    const hasTotal = sections[0] === '통합';

    // 병합: 구분(A열 2행), 각 섹션 헤더
    reqs.push({ mergeCells: { range:R(SID, base, 0, base+2, 1), mergeType:'MERGE_ALL' } });
    sections.forEach((_, si) => {
      reqs.push({ mergeCells: { range:R(SID, base, sCol(si), base+1, sCol(si)+2), mergeType:'MERGE_ALL' } });
    });

    // 섹션 헤더 서식
    reqs.push(repeat(R(SID, base, 0, base+1, 1), cellFmt(C.TOTAL_HDR, C.WHITE, true, 'CENTER', 'MIDDLE', 'CLIP', 11)));
    sections.forEach((_, si) => {
      const isTotal = si === 0 && hasTotal;
      reqs.push(repeat(
        R(SID, base, sCol(si), base+1, sCol(si)+2),
        cellFmt(isTotal ? C.TOTAL_HDR : C.HDR_BG, C.WHITE, true, 'CENTER', 'MIDDLE', 'WRAP', isTotal ? 11 : 10)
      ));
    });

    // 플랫폼 헤더
    reqs.push(repeat(R(SID, base+1, sCol(0), base+2, blockEndCol), cellFmt(C.PLAT_BG, C.WHITE, true, 'CENTER', 'MIDDLE', 'CLIP', 10)));

    // 데이터 행
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

    // 숫자 서식
    reqs.push({
      repeatCell: {
        range: R(SID, base+2, 2, base+2+METRICS.length, blockEndCol),
        cell: { userEnteredFormat: { numberFormat:{ type:'NUMBER', pattern:'#,##0' } } },
        fields: 'userEnteredFormat.numberFormat'
      }
    });

    // 테두리
    reqs.push(addBorder(SID, base, 0, base+2, 1, true));
    sections.forEach((_, si) => {
      reqs.push(addBorder(SID, base, sCol(si), base+1, sCol(si)+2, true));
      reqs.push(addBorder(SID, base+1, sCol(si), base+2, sCol(si)+2));
      reqs.push(addBorder(SID, base+2, sCol(si), base+2+METRICS.length, sCol(si)+2, true));
    });
    reqs.push(addBorder(SID, base, 0, base+2+METRICS.length, 1, true));
  }

  // ── 진행률 패널 서식 ────────────────────────────────────────────────────
  {
    const pC   = panelCol;           // 0-indexed
    const pb0  = blockStartRow(0);   // 0-indexed 통합 블록 시작행

    // 헤더 병합 + 서식
    reqs.push({ mergeCells: { range:R(SID, pb0, pC, pb0+1, pC+2), mergeType:'MERGE_ALL' } });
    reqs.push(repeat(R(SID, pb0, pC, pb0+1, pC+2),
      cellFmt(C.TOTAL_HDR, C.WHITE, true, 'CENTER', 'MIDDLE', 'CLIP', 11)));

    // PC 라벨 + 바
    reqs.push(repeat(R(SID, pb0+1, pC,   pb0+2, pC+1), cellFmt(C.PLAT_BG, C.WHITE, true, 'CENTER', 'MIDDLE', 'CLIP', 10)));
    reqs.push(repeat(R(SID, pb0+1, pC+1, pb0+2, pC+2), cellFmt(C.WHITE, C.BLACK, false, 'CENTER', 'MIDDLE', 'CLIP', 10)));
    // PC % 텍스트 (두 열 병합)
    reqs.push({ mergeCells: { range:R(SID, pb0+2, pC, pb0+3, pC+2), mergeType:'MERGE_ALL' } });
    reqs.push(repeat(R(SID, pb0+2, pC, pb0+3, pC+2),
      cellFmt(C.PASS_CELL, C.BLACK, false, 'CENTER', 'MIDDLE', 'CLIP', 9)));

    // 모바일 라벨 + 바
    reqs.push(repeat(R(SID, pb0+3, pC,   pb0+4, pC+1), cellFmt(C.PLAT_BG, C.WHITE, true, 'CENTER', 'MIDDLE', 'CLIP', 10)));
    reqs.push(repeat(R(SID, pb0+3, pC+1, pb0+4, pC+2), cellFmt(C.WHITE, C.BLACK, false, 'CENTER', 'MIDDLE', 'CLIP', 10)));
    // 모바일 % 텍스트 (두 열 병합)
    reqs.push({ mergeCells: { range:R(SID, pb0+4, pC, pb0+5, pC+2), mergeType:'MERGE_ALL' } });
    reqs.push(repeat(R(SID, pb0+4, pC, pb0+5, pC+2),
      cellFmt(C.PASS_CELL, C.BLACK, false, 'CENTER', 'MIDDLE', 'CLIP', 9)));

    // 나머지 행 (흰색)
    reqs.push(repeat(R(SID, pb0+5, pC, pb0+8, pC+2), cellFmt(C.WHITE)));

    // 전체 테두리
    reqs.push(addBorder(SID, pb0, pC, pb0+8, pC+2, true));

    // 열 너비: 라벨(좁) / 바(넓)
    reqs.push({ updateDimensionProperties:{ range:{ sheetId:SID, dimension:'COLUMNS', startIndex:pC,   endIndex:pC+1 }, properties:{ pixelSize:60  }, fields:'pixelSize' } });
    reqs.push({ updateDimensionProperties:{ range:{ sheetId:SID, dimension:'COLUMNS', startIndex:pC+1, endIndex:pC+2 }, properties:{ pixelSize:200 }, fields:'pixelSize' } });
  }

  // 열 너비
  reqs.push({ updateDimensionProperties:{ range:{ sheetId:SID, dimension:'COLUMNS', startIndex:0, endIndex:1 }, properties:{ pixelSize:140 }, fields:'pixelSize' } });
  reqs.push({ updateDimensionProperties:{ range:{ sheetId:SID, dimension:'COLUMNS', startIndex:1, endIndex:2 }, properties:{ pixelSize:20  }, fields:'pixelSize' } });
  for (let c = 2; c < totalCols; c++) {
    reqs.push({ updateDimensionProperties:{ range:{ sheetId:SID, dimension:'COLUMNS', startIndex:c, endIndex:c+1 }, properties:{ pixelSize:80 }, fields:'pixelSize' } });
  }

  // 행 높이: 타이틀
  reqs.push({ updateDimensionProperties:{ range:{ sheetId:SID, dimension:'ROWS', startIndex:0, endIndex:1 }, properties:{ pixelSize:50 }, fields:'pixelSize' } });
  // 행 높이: 각 블록 (섹션헤더/플랫폼/PASS/FAIL/BLOCK/미진행/합계)
  const ROW_HEIGHTS = [50, 30, 28, 28, 28, 28, 28, 30];
  for (let k = 0; k < chunks.length; k++) {
    const base = blockStartRow(k);
    ROW_HEIGHTS.forEach((px, ri) => {
      reqs.push({ updateDimensionProperties:{ range:{ sheetId:SID, dimension:'ROWS', startIndex:base+ri, endIndex:base+ri+1 }, properties:{ pixelSize:px }, fields:'pixelSize' } });
    });
  }

  // 30개씩 나눠서 배치 업데이트
  for (let i = 0; i < reqs.length; i += 30) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId:SPREADSHEET_ID, requestBody:{ requests: reqs.slice(i, i+30) } });
  }

  const totalFormulas = chunks.reduce((sum, secs) => sum + secs.length * METRICS.length * PLATFORMS.length, 0);
  console.log(`\n✅ 완료! — 수식 ${totalFormulas}개, 블록 ${chunks.length}개`);
  if (chunks.length > 1) {
    chunks.forEach((secs, k) => {
      const label = k === 0 ? `통합 + ${secs.length - 1}개` : `${secs.length}개`;
      console.log(`   블록 ${k+1}: ${label} (${secs.filter(s => s !== '통합').join(', ')})`);
    });
  }
  console.log(`   새 TC 시트 추가 시 이 스크립트를 다시 실행하세요.`);
  console.log(`   https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit#gid=0`);
}

module.exports = { updateDashboard };
if (require.main === module) {
  updateDashboard().catch(err => { console.error('❌', err.message); process.exit(1); });
}
