/**
 * FINAL-5b: 라벨(_labels.json)을 L/M 세로 레이아웃으로 기재 — 기능 무관 일반화
 *
 * 사용법:
 *   node apply_labeling.js <spreadsheetId> <sheetName> <labelsJsonPath>
 *
 * _labels.json 형식:
 *   {
 *     "기획확인":   ["[값 미정] 본문...\n→ 판정 불가...", ...],   // 0~N건
 *     "테스트데이터": ["[서버·기획] 본문...\n▷ 목적...", ...]       // 0~M건
 *   }
 *
 * 레이아웃(확정): L=섹션 헤더 한 칸(병합X, 기획확인 갈색 / 데이터 남색),
 *   M=항목 세로 나열(OVERFLOW, 배경·테두리 없음), 12행~, 열너비 불변(미니대시보드 보호).
 *   apply_v7_LM_layout.js 를 일반화한 것.
 */
const { google } = require('googleapis');
const { getAuthClient } = require('./google_auth');
const fs = require('fs');

const PLAN_HDR = '📋 기획 확인 요청';
const DATA_HDR = '🔧 테스트 데이터 생성 요청';
const LCOL = 11, MCOL = 12, START = 11; // L, M, 12행(0-base 11)

const NAVY = { red: 0.141, green: 0.231, blue: 0.322 };
const BROWN = { red: 0.420, green: 0.290, blue: 0.102 };
const WHITE = { red: 1, green: 1, blue: 1 };

const hdrFmt = (bg) => ({
    backgroundColor: bg,
    textFormat: { bold: true, foregroundColor: WHITE, fontSize: 10 },
    horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP',
});
const bodyFmt = {
    backgroundColor: WHITE,
    textFormat: { fontSize: 10 },
    horizontalAlignment: 'LEFT', verticalAlignment: 'MIDDLE', wrapStrategy: 'OVERFLOW_CELL',
};
const FMT_FIELDS = 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)';

async function applyLabeling(spreadsheetId, sheetName, labels) {
    const auth = await getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });
    const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(title,sheetId)' });
    let sheet = meta.data.sheets.find(s => s.properties.title === sheetName);
    if (!sheet) {
        // 정확 매칭 실패 시 부분 매칭(유일할 때만) — 한글 탭명 입력 편의
        const cands = meta.data.sheets.filter(s => s.properties.title.includes(sheetName));
        if (cands.length === 1) sheet = cands[0];
        else if (cands.length > 1) throw new Error(`'${sheetName}' 부분매칭 ${cands.length}건 — 정확한 탭명 지정 필요`);
    }
    if (!sheet) throw new Error(`탭 '${sheetName}'을 찾을 수 없습니다`);
    const gid = sheet.properties.sheetId;
    sheetName = sheet.properties.title; // 부분매칭 시 실제 탭명으로 교정(range 정확성)

    const planItems = labels['기획확인'] || [];
    const dataItems = labels['테스트데이터'] || [];

    const planStart = START, planEnd = planStart + planItems.length;
    const dataStart = planEnd, dataEnd = dataStart + dataItems.length;

    // 재실행 대비: L12:M(넉넉히) 값 정리
    await sheets.spreadsheets.values.clear({ spreadsheetId, range: `'${sheetName}'!L${START + 1}:M${START + 60}` });
    if (planItems.length === 0 && dataItems.length === 0) {
        console.log('라벨 없음 — 기재 생략');
        return;
    }

    // 값 입력 (L=헤더는 각 섹션 첫 행, M=본문)
    const rows = [];
    planItems.forEach((it, i) => rows.push([i === 0 ? PLAN_HDR : '', it]));
    dataItems.forEach((it, i) => rows.push([i === 0 ? DATA_HDR : '', it]));
    await sheets.spreadsheets.values.update({
        spreadsheetId, range: `'${sheetName}'!L${START + 1}`, valueInputOption: 'RAW', requestBody: { values: rows },
    });

    // 서식 (순서 중요: L 전체 흰색 먼저 → 헤더가 덮음)
    const reqs = [
        { repeatCell: { range: { sheetId: gid, startRowIndex: planStart, endRowIndex: dataEnd, startColumnIndex: LCOL, endColumnIndex: LCOL + 1 }, cell: { userEnteredFormat: { backgroundColor: WHITE } }, fields: 'userEnteredFormat.backgroundColor' } },
    ];
    if (planItems.length) {
        reqs.push({ repeatCell: { range: { sheetId: gid, startRowIndex: planStart, endRowIndex: planStart + 1, startColumnIndex: LCOL, endColumnIndex: LCOL + 1 }, cell: { userEnteredFormat: hdrFmt(BROWN) }, fields: FMT_FIELDS } });
        reqs.push({ repeatCell: { range: { sheetId: gid, startRowIndex: planStart, endRowIndex: planEnd, startColumnIndex: MCOL, endColumnIndex: MCOL + 1 }, cell: { userEnteredFormat: bodyFmt }, fields: FMT_FIELDS } });
    }
    if (dataItems.length) {
        reqs.push({ repeatCell: { range: { sheetId: gid, startRowIndex: dataStart, endRowIndex: dataStart + 1, startColumnIndex: LCOL, endColumnIndex: LCOL + 1 }, cell: { userEnteredFormat: hdrFmt(NAVY) }, fields: FMT_FIELDS } });
        reqs.push({ repeatCell: { range: { sheetId: gid, startRowIndex: dataStart, endRowIndex: dataEnd, startColumnIndex: MCOL, endColumnIndex: MCOL + 1 }, cell: { userEnteredFormat: bodyFmt }, fields: FMT_FIELDS } });
    }
    // ⚠ 열너비·테두리는 건드리지 않음 (불변 — 미니대시보드 M열 보호)

    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: reqs } });
    console.log(`라벨링 기재 완료 [${sheetName}] — 기획확인 ${planItems.length}건 / 테스트데이터 ${dataItems.length}건`);
}

// CLI
if (require.main === module) {
    const [spreadsheetId, sheetName, labelsPath] = process.argv.slice(2);
    if (!spreadsheetId || !sheetName || !labelsPath) {
        console.error('사용법: node apply_labeling.js <spreadsheetId> <sheetName> <labelsJsonPath>');
        process.exit(1);
    }
    const labels = JSON.parse(fs.readFileSync(labelsPath, 'utf8'));
    applyLabeling(spreadsheetId, sheetName, labels).catch(err => {
        console.error('에러:', err.message || err);
        process.exit(1);
    });
}

module.exports = { applyLabeling };
