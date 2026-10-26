/**
 * FINAL-5b: 라벨(_labels.json)을 M/N 세로 레이아웃으로 기재 — 기능 무관 일반화
 *
 * 사용법:
 *   node apply_labeling.js <spreadsheetId> <sheetName> <labelsJsonPath>
 *
 * _labels.json 형식:
 *   {
 *     "기획확인":   ["[값 미정] 질문 한 문장?\n왜 필요한지 한 줄", ...],   // 0~N건 (구 `\n→` 형식은 08-04 폐기)
 *     "테스트데이터": ["[서버·기획] 본문...\n▷ 목적...", ...]       // 0~M건
 *   }
 *   ⚠ 받은 그대로 기재한다 — 거르기는 여기 일이 아니다. finalize.sh FINAL-5a↔5b 사이에서
 *     tc-team/lib/crossref_labels_annotate.js 가 대조가 답을 찾은 질문을 이미 뺐다(2026-09-11~ · 꼬리표는 붙이지 않는다).
 *
 * 레이아웃(2026-10-14 R2 이동 · 기준 페이지 = 기능F_v3):
 *   R2 = 섹션 헤더 한 줄(병합X, 기획확인 갈색 / 데이터 남색), 그 아래 R=번호(1부터) · S=항목 세로 나열
 *   (OVERFLOW, 테두리 없음), 열너비 불변. 섹션마다 헤더 줄이 따로 서고 번호는 섹션별로 다시 1부터 센다.
 *   구 레이아웃(M 헤더/N 항목, 12행~, 헤더가 첫 항목과 같은 줄)은 이 날 이후 생성 탭에 쓰지 않는다 — 기존 탭은 옮기지 않았다.
 *   apply_v7_LM_layout.js 를 일반화한 것.
 */
const { google } = require('googleapis');
const { getAuthClient } = require('./google_auth');
const fs = require('fs');

const PLAN_HDR = '기획 확인 요청';
const DATA_HDR = '🔧 테스트 데이터 생성 요청';
// 2026-10-14 R2 이동: 구 M/N 12행~ → R(섹션 헤더·번호)/S(항목 본문) 2행~.
// 프로젝트 정보 패널(L~P, 1~10행) 오른쪽 Q 한 칸을 띄운 자리라 행이 겹쳐도 열이 달라 패널을 덮지 않는다.
// (이전: 2026-09-04 BTS 열 신설로 구 L/M → M/N.) 이름으로 부른다 — 또 밀릴 때 숫자만 고치면 된다.
// 패널 끝 열과의 간격은 test/sheet_layout_contract.test.js 가 지킨다.
const HDR_COL = 17, BODY_COL = 18, START = 1; // R, S, 2행(0-base 1)

const NAVY = { red: 0.141, green: 0.231, blue: 0.322 };
const BROWN = { red: 0.420, green: 0.290, blue: 0.102 };
const WHITE = { red: 1, green: 1, blue: 1 };
const INK = { red: 0.098, green: 0.098, blue: 0.098 }; // 기준 페이지의 본문 글자색

const hdrFmt = (bg) => ({
    backgroundColor: bg,
    textFormat: { bold: true, foregroundColor: WHITE, fontSize: 10 },
    horizontalAlignment: 'LEFT', verticalAlignment: 'TOP', wrapStrategy: 'WRAP',
});
const numFmt = {
    backgroundColor: WHITE,
    textFormat: { foregroundColor: INK, fontSize: 10 },
    horizontalAlignment: 'LEFT', verticalAlignment: 'TOP', wrapStrategy: 'WRAP',
};
const bodyFmt = {
    backgroundColor: WHITE,
    textFormat: { foregroundColor: INK, fontSize: 10 },
    horizontalAlignment: 'LEFT', verticalAlignment: 'TOP', wrapStrategy: 'OVERFLOW_CELL',
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

    // 섹션 배치: 헤더 한 줄 + 항목 n줄. 빈 섹션은 건너뛴다(헤더도 안 세운다).
    // hdrRow = 헤더 줄(0-base), 항목은 그 아래 hdrRow+1 ~ hdrRow+n.
    const sections = [];
    let row = START;
    [[PLAN_HDR, BROWN, planItems], [DATA_HDR, NAVY, dataItems]].forEach(([hdr, bg, items]) => {
        if (!items.length) return;
        sections.push({ hdr, bg, items, hdrRow: row });
        row += 1 + items.length;
    });

    // 재실행 대비: R2:S(넉넉히) 값 정리
    await sheets.spreadsheets.values.clear({ spreadsheetId, range: `'${sheetName}'!R${START + 1}:S${START + 60}` });
    if (!sections.length) {
        console.log('라벨 없음 — 기재 생략');
        return;
    }

    // 값 입력 (R=헤더 줄·번호, S=본문). 번호는 섹션별로 1부터.
    const rows = [];
    sections.forEach(s => {
        rows.push([s.hdr, '']);
        s.items.forEach((it, i) => rows.push([i + 1, it]));
    });
    await sheets.spreadsheets.values.update({
        spreadsheetId, range: `'${sheetName}'!R${START + 1}`, valueInputOption: 'RAW', requestBody: { values: rows },
    });

    // 서식 (순서 중요: 번호 칸 서식 먼저 → 헤더 줄이 덮음). 헤더 줄의 S 칸은 값·서식 모두 건드리지 않는다.
    const cellRange = (r1, r2, col) => ({ sheetId: gid, startRowIndex: r1, endRowIndex: r2, startColumnIndex: col, endColumnIndex: col + 1 });
    const reqs = [];
    sections.forEach(s => {
        const first = s.hdrRow + 1, end = first + s.items.length;
        reqs.push({ repeatCell: { range: cellRange(first, end, HDR_COL), cell: { userEnteredFormat: numFmt }, fields: FMT_FIELDS } });
        reqs.push({ repeatCell: { range: cellRange(s.hdrRow, first, HDR_COL), cell: { userEnteredFormat: hdrFmt(s.bg) }, fields: FMT_FIELDS } });
        reqs.push({ repeatCell: { range: cellRange(first, end, BODY_COL), cell: { userEnteredFormat: bodyFmt }, fields: FMT_FIELDS } });
    });
    // ⚠ 열너비·테두리는 건드리지 않음 (불변 — 폭 소유자는 add_project_info.js)

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
