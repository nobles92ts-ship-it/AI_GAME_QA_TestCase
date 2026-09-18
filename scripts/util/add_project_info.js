/**
 * L~P열 프로젝트 정보 패널 + 미니 결과 대시보드 추가
 *
 * ⚠ 2026-09-04 양식 개정: 링크 열(J) 신설로 전 구간이 오른쪽 1칸 이동했다 (구 K~O → L~P).
 *    TC 본문은 A~K(비고=K), 담당자=L(데이터 행), 패널=L~M(1~10행), 미니대시=N~P(1~7행).
 *
 * 사용법:
 *   node add_project_info.js <spreadsheetId> <sheetName> <confluenceUrl> [--assignees '<json>']
 *   --assignees: {"기획":"...","서버":"...","클라":"...","UI":"..."} — jira_assignees.js 산출.
 *                생략·파싱 실패 시 담당자 값은 빈칸(구 동작과 동일).
 *
 * L/M열 구조 (1~10행 — 2026-07-28 양식 개정: 테스트환경 하위 클라이언트/서버 → 리비전/QA):
 *   L1:M1   "담당자" (헤더, 병합)
 *   L2~L5   "기획"/"서버"/"클라"/"UI"       | M2~M5 담당자 이름(--assignees, 없으면 빈칸)
 *   L6      "기획서"                         | M6    Confluence URL
 *   L7      "테스트 환경" (헤더, 병합 없음)  | M7    (빈칸 — 값 전부 수동)
 *   L8~L10  "날짜/시간"/"리비전"/"QA"        | M8~M10 (빈칸 — 값 전부 수동)
 *
 * N~P열 구조 (1~7행) — TC 시트 자체 결과 미니 대시보드:
 *   N1/O1/P1  "구분"/"PC"/"모바일" (헤더)
 *   N2~N6     PASS/FAIL/BLOCK/미진행/N/A   | O/P COUNTIF(H or I, metric)
 *   N7        합계                          | O/P SUMPRODUCT(COUNTIF(...))
 */
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { getAuthClient } = require('./google_auth');

const METRICS = ['PASS', 'FAIL', 'BLOCK', '미진행', 'N/A'];
const PANEL_LABELS_M = ['구분', ...METRICS, '합계'];

// ── 패널 열 위치 (0-based, endIndex는 exclusive) ────────────────────────────
// 2026-09-04: 링크 열 신설로 구 K~O에서 한 칸씩 밀렸다. 또 옮길 일이 생기면
// COL_LABEL 하나만 고치면 아래가 전부 따라온다 (숫자 직접 기입 금지).
const COL_LABEL = 11;              // L — 패널 라벨
const COL_VALUE = COL_LABEL + 1;   // M — 패널 값
const COL_DASH  = COL_LABEL + 2;   // N — 미니 대시보드 "구분"
const COL_PC    = COL_LABEL + 3;   // O — PC (P=모바일)
const COL_END   = COL_LABEL + 5;   // P 다음 (exclusive)

// ── 패널 문구 SSoT = rules/완료처리.md "패널 문구" 절의 표 2개 ──────────────────
// 규칙서를 실행 시점에 파싱한다 → md만 고치면 데스크톱·Loki 양쪽에 반영(사본 0, 07-28).
// 파싱 실패 시에만 아래 비상값을 쓰고 stderr 경고 — 패널이 통째로 사라지는 것보다 낫다.
const RULES_DIR = process.env.TCTEAM_RULES_DIR
  || require('path').join(process.env.CLAUDE_CONFIG_DIR || require('os').homedir() + '/.claude', 'skills', 'tc-team', 'rules');
const FALLBACK_LABELS = ['담당자', '기획', '서버', '클라', 'UI', '기획서', '테스트 환경', '날짜/시간', '리비전', 'QA'];
const FALLBACK_NOTES = {
    'PASS': '재현스탭대로 실행했을 때 기대결과가 그대로 나온 경우.\n일부라도 다르면 PASS 아님.',
    'FAIL': '기대결과와 다르게 동작한 경우.\nBTS 등록 후 링크 열(J)에 DXBUG 링크를 기재.',
    'BLOCK': '동작이 틀린 게 아니라, 검증 자체를 시작할 수 없는 상태.\n(기능 진입 불가, 선행 버그로 사전조건을 만들 수 없음 등)',
    '미진행': '아직 테스트하지 않음 (기본값).\n빌드에는 있으나 후순위이거나, 기획 확인 대기인 경우도 포함.',
    'N/A': '검증 대상이 아님.\n① 해당 플랫폼 미지원 (예: PC 전용 기능의 모바일 칸)\n② 비고가 "추후 구현" — 빌드에 없어 검증 불가',
};

/** 헤딩 이후 첫 마크다운 표를 {키: 값} 으로 (구분선 `|---|` 행은 건너뜀) */
function parseTableAfter(md, headingIncludes) {
    const lines = md.split(/\r?\n/);
    const start = lines.findIndex(l => l.startsWith('**') && l.includes(headingIncludes));
    if (start < 0) return null;
    const out = {};
    let seen = false;
    for (let i = start + 1; i < lines.length; i++) {
        const l = lines[i].trim();
        if (!l.startsWith('|')) { if (seen) break; continue; }
        const cells = l.split('|').slice(1, -1).map(c => c.trim());
        if (cells.length < 2 || /^-{2,}$/.test(cells[0].replace(/:/g, ''))) continue;
        if (!seen) { seen = true; continue; }              // 첫 행 = 헤더
        out[cells[0]] = cells[1];
    }
    return Object.keys(out).length ? out : null;
}

function loadPanelSpec() {
    let md = '';
    try { md = fs.readFileSync(path.join(RULES_DIR, '완료처리.md'), 'utf8'); }
    catch (e) {
        console.error('[경고] 완료처리.md를 못 읽음 — 내장 비상값 사용:', e.message);
        return { labels: FALLBACK_LABELS, notes: FALLBACK_NOTES };
    }
    // ⚠ 표의 앵커·셀키는 완료처리.md와 한 쌍이다. 한쪽만 고치면 조용히 비상값으로 떨어진다.
    const lt = parseTableAfter(md, 'L열 라벨');
    const nt = parseTableAfter(md, '판정 기준 메모');
    let labels = FALLBACK_LABELS;
    if (lt) {
        const picked = FALLBACK_LABELS.map((def, i) => lt['L' + (i + 1)] || def);
        if (picked.every(Boolean)) labels = picked;
    } else {
        console.error('[경고] 완료처리.md "L열 라벨" 표 파싱 실패 — 내장 비상값 사용');
    }
    let notes = FALLBACK_NOTES;
    if (nt) {
        notes = {};
        for (const m of METRICS) notes[m] = (nt[m] || FALLBACK_NOTES[m]).replace(/<br\s*\/?>/gi, '\n');
    } else {
        console.error('[경고] 완료처리.md "판정 기준 메모" 표 파싱 실패 — 내장 비상값 사용');
    }
    return { labels, notes };
}

const COLOR_HEADER_BG = { red: 0.176, green: 0.251, blue: 0.349 };
const COLOR_WHITE = { red: 1, green: 1, blue: 1 };
const COLOR_BLACK = { red: 0, green: 0, blue: 0 };
const COLOR_LINK = { red: 0.067, green: 0.333, blue: 0.8 };
const COLOR_BORDER_OUTER = { red: 0.7, green: 0.7, blue: 0.7 };
const COLOR_BORDER_INNER = { red: 0.85, green: 0.85, blue: 0.85 };

function headerFmt() {
    return {
        backgroundColor: COLOR_HEADER_BG,
        textFormat: { foregroundColor: COLOR_WHITE, bold: true, fontSize: 10 },
        horizontalAlignment: 'CENTER',
        verticalAlignment: 'MIDDLE',
    };
}
function labelFmt() {
    return {
        backgroundColor: COLOR_WHITE,
        textFormat: { foregroundColor: COLOR_BLACK, bold: true, fontSize: 10 },
        horizontalAlignment: 'CENTER',
        verticalAlignment: 'MIDDLE',
    };
}
function valueFmt() {
    return {
        backgroundColor: COLOR_WHITE,
        horizontalAlignment: 'CENTER',
        verticalAlignment: 'MIDDLE',
    };
}
function linkFmt() {
    return {
        backgroundColor: COLOR_WHITE,
        textFormat: { foregroundColor: COLOR_LINK, fontSize: 10 },
        horizontalAlignment: 'LEFT',
        verticalAlignment: 'MIDDLE',
    };
}
function repeatCell(sheetId, r1, r2, c1, c2, format, fields) {
    return {
        repeatCell: {
            range: { sheetId, startRowIndex: r1, endRowIndex: r2, startColumnIndex: c1, endColumnIndex: c2 },
            cell: { userEnteredFormat: format },
            fields,
        },
    };
}
function borderAll(sheetId, r1, r2, c1, c2) {
    return {
        updateBorders: {
            range: { sheetId, startRowIndex: r1, endRowIndex: r2, startColumnIndex: c1, endColumnIndex: c2 },
            top: { style: 'SOLID', color: COLOR_BORDER_OUTER },
            bottom: { style: 'SOLID', color: COLOR_BORDER_OUTER },
            left: { style: 'SOLID', color: COLOR_BORDER_OUTER },
            right: { style: 'SOLID', color: COLOR_BORDER_OUTER },
            innerHorizontal: { style: 'SOLID', color: COLOR_BORDER_INNER },
            innerVertical: { style: 'SOLID', color: COLOR_BORDER_INNER },
        },
    };
}

async function addProjectInfo(spreadsheetId, sheetName, confluenceUrl, assignees = {}) {
    const { labels, notes } = loadPanelSpec();   // 규칙서(완료처리.md) 표 = 문구 정본
    const auth = await getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });

    const sp = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(title,sheetId)' });
    const sheet = sp.data.sheets.find(s => s.properties.title === sheetName);
    if (!sheet) throw new Error(`탭 '${sheetName}'을 찾을 수 없습니다`);
    const sheetId = sheet.properties.sheetId;

    // ─── L/M열 값 (10행) ─────────────────────────────────────────────
    // 재실행 안전(2026-07-28): 기존 값 열 손기입 값을 먼저 읽어 보존한다. 스크립트가
    // 채우지 않는 칸(테스트환경 값 4종)과, Jira 조회가 비어 온 담당자 칸은 덮지 않는다.
    // (재기록 후 FINAL-2 재실행이 QA가 적어둔 리비전·날짜를 지우던 문제)
    //
    // ⚠ 구 양식(~2026-09-03) 탭 대응: 그때 값 열은 L이었다. L1:M10을 한 번에 읽어
    //    M(신)이 비었으면 L(구)에서 끌어온다 — 구 양식 탭에 재실행해도 손기입이 살아서
    //    새 자리로 옮겨간다. 이 폴백이 없으면 L을 라벨로 덮어써 값이 사라진다.
    let prevVals = [];
    try {
        const cur = await sheets.spreadsheets.values.get({
            spreadsheetId, range: `'${sheetName}'!L1:M10`,
        });
        prevVals = (cur.data.values || []).map(r => {
            const oldL = r && r[0] != null ? String(r[0]) : '';
            const newM = r && r[1] != null ? String(r[1]) : '';
            return newM.trim() ? newM : oldL;
        });
    } catch (e) {
        console.error('[경고] 기존 값 열 조회 실패 — 보존 없이 진행:', e.message);
    }
    // 구 양식에서 끌어온 값이 라벨 자신이면 보존 대상이 아니다 (L=라벨이던 시절의 잔재).
    const keep = i => {
        const v = prevVals[i] || '';
        return v === labels[i] ? '' : v;                      // i = 0-based 행 인덱스
    };
    const fill = (i, v) => (v && String(v).trim() ? v : keep(i));

    // 라벨(L열)은 규칙서 표에서, 값(M열)은 담당자 인자 + 기존값 보존 규칙에서.
    // 담당자 4칸(인덱스 1~4)만 Jira 값이 들어가고, 나머지는 기존값 유지(기획서 URL 제외).
    const ASSIGNEE_ROWS = { 1: '기획', 2: '서버', 3: '클라', 4: 'UI' };
    const lmValues = labels.map((label, i) => {
        if (i === 5) return [label, confluenceUrl];                       // L6 기획서
        if (ASSIGNEE_ROWS[i]) return [label, fill(i, assignees[ASSIGNEE_ROWS[i]])];
        return [label, keep(i)];
    });
    await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${sheetName}'!L1:M10`,
        valueInputOption: 'RAW',
        requestBody: { values: lmValues },
    });

    // ─── N~P열 값 (7행) ──────────────────────────────────────────────
    // 헤더: N1=구분, O1=PC, P1=모바일
    // 데이터: PC=H열 COUNTIF / 모바일=I열 COUNTIF / 합계=SUMPRODUCT
    // ⚠ 결과 열 H·I는 링크 열 신설(2026-09-04)의 영향을 받지 않는다 (링크는 J에 들어감).
    const countif = (col, metric) => `=COUNTIF(H:H,"${metric}")`.replace('H:H', `${col}:${col}`);
    const sumAll = col =>
        `=SUMPRODUCT(COUNTIF(${col}:${col},{"PASS","FAIL","BLOCK","미진행","N/A"}))`;

    const moValues = [
        ['구분', 'PC', '모바일'],
        ['PASS',    countif('H', 'PASS'),    countif('I', 'PASS')],
        ['FAIL',    countif('H', 'FAIL'),    countif('I', 'FAIL')],
        ['BLOCK',   countif('H', 'BLOCK'),   countif('I', 'BLOCK')],
        ['미진행',  countif('H', '미진행'),  countif('I', '미진행')],
        ['N/A',     countif('H', 'N/A'),     countif('I', 'N/A')],
        ['합계',    sumAll('H'),             sumAll('I')],
    ];
    await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${sheetName}'!N1:P7`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: moValues },
    });

    // ─── 서식 요청 ──────────────────────────────────────────────────
    const fmtFields = 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)';
    const bgOnlyFields = 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment)';

    const requests = [
        // L1:M1 담당자 헤더 (병합 + 남색)
        { mergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: COL_LABEL, endColumnIndex: COL_DASH }, mergeType: 'MERGE_ALL' } },
        repeatCell(sheetId, 0, 1, COL_LABEL, COL_DASH, headerFmt(), fmtFields),

        // L2~L5 라벨
        repeatCell(sheetId, 1, 5, COL_LABEL, COL_VALUE, labelFmt(), fmtFields),
        // M2~M5 빈칸
        repeatCell(sheetId, 1, 5, COL_VALUE, COL_DASH, valueFmt(), bgOnlyFields),

        // L6 기획서 헤더
        repeatCell(sheetId, 5, 6, COL_LABEL, COL_VALUE, headerFmt(), fmtFields),
        // M6 URL
        repeatCell(sheetId, 5, 6, COL_VALUE, COL_DASH, linkFmt(), fmtFields),

        // L7 "테스트 환경" 헤더 (병합 없음, 남색) | M7 빈칸
        { unmergeCells: { range: { sheetId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: COL_LABEL, endColumnIndex: COL_DASH } } },
        repeatCell(sheetId, 6, 7, COL_LABEL, COL_VALUE, headerFmt(), fmtFields),
        repeatCell(sheetId, 6, 7, COL_VALUE, COL_DASH, valueFmt(), bgOnlyFields),

        // L8~L10 라벨
        repeatCell(sheetId, 7, 10, COL_LABEL, COL_VALUE, labelFmt(), fmtFields),
        // M8~M10 빈칸
        repeatCell(sheetId, 7, 10, COL_VALUE, COL_DASH, valueFmt(), bgOnlyFields),

        // L/M열 테두리 (1~10행)
        borderAll(sheetId, 0, 10, COL_LABEL, COL_DASH),

        // ─── N~P열 미니 대시보드 ─────────────────────────────────────
        // N1 "구분" 헤더
        repeatCell(sheetId, 0, 1, COL_DASH, COL_PC, headerFmt(), fmtFields),
        // O1/P1 PC/모바일 헤더
        repeatCell(sheetId, 0, 1, COL_PC, COL_END, {
            backgroundColor: { red: 0.384, green: 0.467, blue: 0.824 },
            textFormat: { foregroundColor: COLOR_WHITE, bold: true, fontSize: 10 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
        }, fmtFields),

        // M2~M6 메트릭 라벨 (좌정렬 + 각 색상)
        // PASS (연녹)
        repeatCell(sheetId, 1, 2, COL_DASH, COL_PC, {
            backgroundColor: { red: 0.678, green: 0.878, blue: 0.698 },
            textFormat: { foregroundColor: COLOR_BLACK, bold: true, fontSize: 10 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
        }, fmtFields),
        // FAIL (연빨강)
        repeatCell(sheetId, 2, 3, COL_DASH, COL_PC, {
            backgroundColor: { red: 0.980, green: 0.737, blue: 0.737 },
            textFormat: { foregroundColor: COLOR_BLACK, bold: true, fontSize: 10 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
        }, fmtFields),
        // BLOCK (연주황)
        repeatCell(sheetId, 3, 4, COL_DASH, COL_PC, {
            backgroundColor: { red: 1.000, green: 0.867, blue: 0.647 },
            textFormat: { foregroundColor: COLOR_BLACK, bold: true, fontSize: 10 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
        }, fmtFields),
        // 미진행 (연회색)
        repeatCell(sheetId, 4, 5, COL_DASH, COL_PC, {
            backgroundColor: { red: 0.800, green: 0.800, blue: 0.800 },
            textFormat: { foregroundColor: COLOR_BLACK, bold: true, fontSize: 10 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
        }, fmtFields),
        // N/A (회색)
        repeatCell(sheetId, 5, 6, COL_DASH, COL_PC, {
            backgroundColor: { red: 0.700, green: 0.700, blue: 0.700 },
            textFormat: { foregroundColor: COLOR_BLACK, bold: true, fontSize: 10 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
        }, fmtFields),
        // 합계 (연파랑)
        repeatCell(sheetId, 6, 7, COL_DASH, COL_PC, {
            backgroundColor: { red: 0.635, green: 0.831, blue: 0.953 },
            textFormat: { foregroundColor: COLOR_BLACK, bold: true, fontSize: 10 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
        }, fmtFields),

        // N~O 숫자 영역 (배경 + 중앙 정렬 + 숫자 포맷)
        repeatCell(sheetId, 1, 2, COL_PC, COL_END, {
            backgroundColor: { red: 0.878, green: 0.969, blue: 0.886 },
            horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE',
            numberFormat: { type: 'NUMBER', pattern: '#,##0' },
        }, 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,numberFormat)'),
        repeatCell(sheetId, 2, 3, COL_PC, COL_END, {
            backgroundColor: { red: 1.000, green: 0.894, blue: 0.894 },
            horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE',
            numberFormat: { type: 'NUMBER', pattern: '#,##0' },
        }, 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,numberFormat)'),
        repeatCell(sheetId, 3, 4, COL_PC, COL_END, {
            backgroundColor: { red: 1.000, green: 0.957, blue: 0.867 },
            horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE',
            numberFormat: { type: 'NUMBER', pattern: '#,##0' },
        }, 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,numberFormat)'),
        repeatCell(sheetId, 4, 5, COL_PC, COL_END, {
            backgroundColor: { red: 0.933, green: 0.933, blue: 0.933 },
            horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE',
            numberFormat: { type: 'NUMBER', pattern: '#,##0' },
        }, 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,numberFormat)'),
        repeatCell(sheetId, 5, 6, COL_PC, COL_END, {
            backgroundColor: { red: 0.878, green: 0.878, blue: 0.878 },
            horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE',
            numberFormat: { type: 'NUMBER', pattern: '#,##0' },
        }, 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,numberFormat)'),
        repeatCell(sheetId, 6, 7, COL_PC, COL_END, {
            backgroundColor: { red: 0.867, green: 0.937, blue: 0.984 },
            textFormat: { foregroundColor: COLOR_BLACK, bold: true, fontSize: 10 },
            horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE',
            numberFormat: { type: 'NUMBER', pattern: '#,##0' },
        }, 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,numberFormat)'),

        // N2~N6 판정 기준 메모 (fields:'note' — 값·서식은 건드리지 않음)
        {
            updateCells: {
                range: { sheetId, startRowIndex: 1, endRowIndex: 6, startColumnIndex: COL_DASH, endColumnIndex: COL_PC },
                rows: METRICS.map(m => ({ values: [{ note: notes[m] }] })),
                fields: 'note',
            },
        },

        // N~P열 테두리 (1~7행)
        borderAll(sheetId, 0, 7, COL_DASH, COL_END),

        // 열 너비 — 완료처리 영역(L~P)은 이 스크립트가 소유한다.
        //   TC 본문 A~K 폭은 apply_format_tab.js 소유. 경계를 넘지 말 것.
        //   ⚠ M(패널 값) 100은 오너 지정값(2026-09-04). 기획서 URL·담당자 병기는 잘려 보인다.
        { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: COL_LABEL, endIndex: COL_VALUE }, properties: { pixelSize: 100 }, fields: 'pixelSize' } },
        { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: COL_VALUE, endIndex: COL_DASH }, properties: { pixelSize: 100 }, fields: 'pixelSize' } },
        { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: COL_DASH, endIndex: COL_PC }, properties: { pixelSize: 90 }, fields: 'pixelSize' } },
        { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: COL_PC, endIndex: COL_END }, properties: { pixelSize: 70 }, fields: 'pixelSize' } },
    ];

    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });

    console.log(`L~P열 프로젝트 정보 + 미니 대시보드 추가 완료: ${sheetName}`);
}

// CLI
if (require.main === module) {
    const argv = process.argv.slice(2);
    let assignees = {};
    const ai = argv.indexOf('--assignees');
    if (ai >= 0) {
        try { assignees = JSON.parse(argv[ai + 1] || '{}') || {}; }
        catch (e) { console.error('[경고] --assignees JSON 파싱 실패 — 담당자 빈칸으로 진행:', e.message); }
        argv.splice(ai, 2);
    }
    const [spreadsheetId, sheetName, confluenceUrl] = argv;
    if (!spreadsheetId || !sheetName || !confluenceUrl) {
        console.error("사용법: node add_project_info.js <spreadsheetId> <sheetName> <confluenceUrl> [--assignees '<json>']");
        process.exit(1);
    }
    addProjectInfo(spreadsheetId, sheetName, confluenceUrl, assignees).catch(err => {
        console.error('에러:', err.message || err);
        process.exit(1);
    });
}

module.exports = { addProjectInfo };
