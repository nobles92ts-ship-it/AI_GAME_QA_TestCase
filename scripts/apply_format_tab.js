/**
 * TC 시트 서식 일괄 적용 — 탭명을 인자로 받아 해당 탭에 적용
 *
 * 사용법:
 *   node apply_format_tab.js "탭명"
 *   node apply_format_tab.js "채팅_시스템"
 *   node apply_format_tab.js "어그로 시스템" --console   ← 콘솔 플랫폼 추가
 *
 * 적용 내용 (tc-생성 스킬 마스터 기준):
 *   - 헤더(1행): #2D4059 네이비, 흰 글씨·bold·11pt·가운데 정렬, 행 고정
 *   - A~E, G~I열: 가운데 정렬 + WRAP
 *   - F열(재현 스탭): 왼쪽 정렬 + WRAP
 *   - J열(비고): 왼쪽 정렬, WRAP 없음(OVERFLOW), 드롭다운 없음
 *   - 드롭다운: E(검증단계), G(플랫폼), H(PC결과), I(모바일결과)
 *   - 조건부 서식: 검증단계(E), 결과(H/I)
 *   - 필터: 전체 데이터 범위
 *   - 열 너비: TC ID(60) | 대분류(90) | 중분류(110) | 소분류(160) | 검증단계(80) | 재현스탭(500) | 플랫폼(90) | PC결과(80) | 모바일결과(90) | 비고(160)
 */

const { google } = require('googleapis');
const { getAuthClient } = require('./google_auth');
const { addResultCondFormat, addVerifCondFormat } = require('./tc_utilities');

const DEFAULT_SHEET_ID = process.env.GAME_QA_ID;

async function applyFormatToTab(tabName, addConsole = false, spreadsheetId = DEFAULT_SHEET_ID) {
  const auth = await getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });

  // 시트 메타 조회
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetMeta = spreadsheet.data.sheets.find(s => s.properties.title === tabName);
  if (!sheetMeta) {
    console.error(`❌ 탭 '${tabName}'을 찾을 수 없습니다.`);
    console.log('사용 가능한 탭:');
    spreadsheet.data.sheets.forEach(s => console.log(`  - ${s.properties.title}`));
    process.exit(1);
  }

  const sheetId = sheetMeta.properties.sheetId;

  // 데이터 행 수 파악
  const rowRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tabName}!A:A`,
  });
  const dataCount = Math.max(0, (rowRes.data.values || []).length - 1);
  if (dataCount === 0) {
    console.log(`⚠️ [${tabName}] 데이터 없음`);
    return;
  }
  const endRow = dataCount + 1;

  const requests = [];

  // ── 헤더(1행) 서식 ──────────────────────────
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 10 },
      cell: {
        userEnteredFormat: {
          backgroundColor: { red: 0.1765, green: 0.2510, blue: 0.3490 }, // #2D4059
          textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true, fontSize: 11 },
          horizontalAlignment: 'CENTER',
          verticalAlignment: 'MIDDLE',
        }
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
    }
  });

  // 행 고정 (1행)
  requests.push({
    updateSheetProperties: {
      properties: {
        sheetId,
        gridProperties: { frozenRowCount: 1 },
      },
      fields: 'gridProperties.frozenRowCount',
    }
  });

  // ── 데이터 행 서식 ───────────────────────────

  // A~E (index 0~4): 흰 배경, 검정 텍스트, bold 없음, 가운데 정렬, WRAP
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 1, endRowIndex: endRow, startColumnIndex: 0, endColumnIndex: 5 },
      cell: {
        userEnteredFormat: {
          backgroundColor: { red: 1, green: 1, blue: 1 },
          textFormat: { foregroundColor: { red: 0, green: 0, blue: 0 }, bold: false },
          horizontalAlignment: 'CENTER',
          verticalAlignment: 'MIDDLE',
          wrapStrategy: 'WRAP',
        }
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)',
    }
  });

  // F (index 5): 왼쪽 정렬 + WRAP + TOP 정렬
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 1, endRowIndex: endRow, startColumnIndex: 5, endColumnIndex: 6 },
      cell: {
        userEnteredFormat: {
          backgroundColor: { red: 1, green: 1, blue: 1 },
          textFormat: { foregroundColor: { red: 0, green: 0, blue: 0 }, bold: false },
          horizontalAlignment: 'LEFT',
          verticalAlignment: 'TOP',
          wrapStrategy: 'WRAP',
        }
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)',
    }
  });

  // G~I (index 6~8): 가운데 정렬 + WRAP
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 1, endRowIndex: endRow, startColumnIndex: 6, endColumnIndex: 9 },
      cell: {
        userEnteredFormat: {
          backgroundColor: { red: 1, green: 1, blue: 1 },
          textFormat: { foregroundColor: { red: 0, green: 0, blue: 0 }, bold: false },
          horizontalAlignment: 'CENTER',
          verticalAlignment: 'MIDDLE',
          wrapStrategy: 'WRAP',
        }
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)',
    }
  });

  // J (index 9): 왼쪽 정렬 + OVERFLOW (줄바꿈 없음)
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 1, endRowIndex: endRow, startColumnIndex: 9, endColumnIndex: 10 },
      cell: {
        userEnteredFormat: {
          backgroundColor: { red: 1, green: 1, blue: 1 },
          textFormat: { foregroundColor: { red: 0, green: 0, blue: 0 }, bold: false },
          horizontalAlignment: 'LEFT',
          verticalAlignment: 'MIDDLE',
          wrapStrategy: 'OVERFLOW_CELL',
        }
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)',
    }
  });

  // ── 열 너비 ──────────────────────────────────
  const colWidths = [60, 90, 110, 160, 80, 500, 90, 80, 90, 160];
  colWidths.forEach((px, ci) => {
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: ci, endIndex: ci + 1 },
        properties: { pixelSize: px },
        fields: 'pixelSize',
      }
    });
  });

  // ── 행 높이: 헤더 고정, 데이터 행 자동 ─────────
  requests.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
      properties: { pixelSize: 24 },
      fields: 'pixelSize',
    }
  });
  requests.push({
    autoResizeDimensions: {
      dimensions: { sheetId, dimension: 'ROWS', startIndex: 1, endIndex: endRow },
    }
  });

  // ── 드롭다운 ─────────────────────────────────

  // E열(검증단계)
  requests.push({
    setDataValidation: {
      range: { sheetId, startRowIndex: 1, endRowIndex: endRow, startColumnIndex: 4, endColumnIndex: 5 },
      rule: {
        condition: {
          type: 'ONE_OF_LIST',
          values: [
            { userEnteredValue: '정상' },
            { userEnteredValue: '부정' },
            { userEnteredValue: '예외' },
          ]
        },
        showCustomUi: true,
        strict: false,
      }
    }
  });

  // G열(플랫폼)
  const platformValues = [
    { userEnteredValue: 'PC' },
    { userEnteredValue: '모바일' },
    { userEnteredValue: 'PC/모바일' },
    ...(addConsole ? [{ userEnteredValue: '콘솔' }] : []),
  ];
  requests.push({
    setDataValidation: {
      range: { sheetId, startRowIndex: 1, endRowIndex: endRow, startColumnIndex: 6, endColumnIndex: 7 },
      rule: {
        condition: { type: 'ONE_OF_LIST', values: platformValues },
        showCustomUi: true,
        strict: false,
      }
    }
  });

  // H/I열(결과)
  const resultValues = [
    { userEnteredValue: 'PASS' },
    { userEnteredValue: 'FAIL' },
    { userEnteredValue: 'BLOCK' },
    { userEnteredValue: '미진행' },
    { userEnteredValue: 'N/A' },
  ];
  [7, 8].forEach(col => {
    requests.push({
      setDataValidation: {
        range: { sheetId, startRowIndex: 1, endRowIndex: endRow, startColumnIndex: col, endColumnIndex: col + 1 },
        rule: { condition: { type: 'ONE_OF_LIST', values: resultValues }, showCustomUi: true, strict: false }
      }
    });
  });

  // J열(비고) — 드롭다운 제거 (repeatCell + fields:'dataValidation'으로 덮어쓰기)
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 1, endRowIndex: endRow, startColumnIndex: 9, endColumnIndex: 10 },
      cell: {},
      fields: 'dataValidation'
    }
  });

  // ── 조건부 서식 ───────────────────────────────

  // 기존 조건부 서식 삭제 (역순)
  const existingCondFmt = sheetMeta.conditionalFormats || [];
  for (let j = existingCondFmt.length - 1; j >= 0; j--) {
    requests.push({ deleteConditionalFormatRule: { sheetId, index: j } });
  }
  requests.push(...addVerifCondFormat(sheetId, dataCount));
  requests.push(...addResultCondFormat(sheetId, 7, dataCount));
  requests.push(...addResultCondFormat(sheetId, 8, dataCount));

  // ── 필터 (E·G·H·I 열만) ──────────────────────
  if (sheetMeta.basicFilter) {
    requests.push({ clearBasicFilter: { sheetId } });
  }
  requests.push({
    setBasicFilter: {
      filter: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: endRow,
          startColumnIndex: 0,
          endColumnIndex: 10,
        },
        filterSpecs: [
          { columnIndex: 4 },  // E: 검증단계
          { columnIndex: 6 },  // G: 플랫폼
          { columnIndex: 7 },  // H: PC 결과
          { columnIndex: 8 },  // I: 모바일 결과
        ],
      }
    }
  });

  // ── 일괄 적용 ─────────────────────────────────
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests }
  });

  console.log(`✅ [${tabName}] 서식 적용 완료 (${dataCount}행, ${requests.length}개 요청)`);
}

module.exports = { applyFormatToTab };

// CLI 실행
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('사용법: node apply_format_tab.js "탭명" [--spreadsheet ID] [--console]');
    console.log('예시: node apply_format_tab.js "채팅_시스템"');
    console.log('      node apply_format_tab.js "어그로 시스템" --console');
    process.exit(1);
  }

  const tabName = args[0];
  const addConsole = args.includes('--console');
  const ssIdx = args.indexOf('--spreadsheet');
  const spreadsheetId = ssIdx !== -1 ? args[ssIdx + 1] : DEFAULT_SHEET_ID;
  applyFormatToTab(tabName, addConsole, spreadsheetId).catch(console.error);
}
