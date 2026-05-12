/**
 * TC 파이프라인 공통 유틸리티 함수
 * tc-fixer, member5 등에서 require('./tc_utilities')로 사용
 */

// 각 행의 실제 분류를 복원 (빈 셀 = 위쪽 행에서 상속)
function resolveCategories(tcRows) {
    let major = '', mid = '', sub = '';
    return tcRows.map(r => {
        if (r[1]) major = r[1];
        if (r[2]) mid = r[2]; else if (r[1]) mid = '';
        if (r[3]) sub = r[3]; else if (r[2] || r[1]) sub = '';
        return { major, mid, sub };
    });
}

// 분류에 맞는 삽입 위치 찾기
function findInsertIndex(categories, newTc) {
    let lastMatchIdx = -1;
    for (let i = 0; i < categories.length; i++) {
        const c = categories[i];
        if (c.major === newTc.대분류) {
            if (newTc.중분류 && c.mid === newTc.중분류) {
                if (newTc.소분류 && c.sub === newTc.소분류) lastMatchIdx = i;
                else lastMatchIdx = i;
            } else {
                lastMatchIdx = i;
            }
        }
    }
    return lastMatchIdx;
}

// 분류별 그룹핑: 분산된 동일 분류를 하나의 블록으로 합침
// 첫 등장 순서 유지, 같은 소분류 내 원래 행 순서 유지
function groupByCategory(tcRows) {
    const cats = resolveCategories(tcRows);
    const tagged = tcRows.map((row, i) => ({ row, ...cats[i] }));

    // 첫 등장 순서 기록
    const majorOrder = [];
    const midOrder = {};
    const subOrder = {};
    tagged.forEach(t => {
        if (!majorOrder.includes(t.major)) majorOrder.push(t.major);
        if (!midOrder[t.major]) midOrder[t.major] = [];
        if (!midOrder[t.major].includes(t.mid)) midOrder[t.major].push(t.mid);
        const midKey = t.major + '|||' + t.mid;
        if (!subOrder[midKey]) subOrder[midKey] = [];
        if (!subOrder[midKey].includes(t.sub)) subOrder[midKey].push(t.sub);
    });

    // 분류별 행 수집
    const groups = {};
    tagged.forEach(t => {
        const key = t.major + '|||' + t.mid + '|||' + t.sub;
        if (!groups[key]) groups[key] = [];
        groups[key].push(t.row);
    });

    // 첫 등장 순서대로 재조립
    const result = [];
    majorOrder.forEach(major => {
        (midOrder[major] || []).forEach(mid => {
            const midKey = major + '|||' + mid;
            (subOrder[midKey] || []).forEach(sub => {
                const key = major + '|||' + mid + '|||' + sub;
                (groups[key] || []).forEach(row => result.push(row));
            });
        });
    });
    return result;
}

// TC ID 재부여 (001 format) + 분류 중복 표기 정리
function renumberAndDedup(tcRows) {
    const cats = resolveCategories(tcRows);
    for (let i = 0; i < tcRows.length; i++) {
        tcRows[i][0] = String(i + 1).padStart(3, '0');
        if (i === 0) {
            tcRows[i][1] = cats[i].major;
            tcRows[i][2] = cats[i].mid;
            tcRows[i][3] = cats[i].sub;
        } else {
            const prev = cats[i - 1], cur = cats[i];
            tcRows[i][1] = (cur.major === prev.major) ? '' : cur.major;
            tcRows[i][2] = (cur.mid === prev.mid && cur.major === prev.major) ? '' : (cur.mid || '');
            tcRows[i][3] = (cur.sub === prev.sub && cur.mid === prev.mid && cur.major === prev.major) ? '' : (cur.sub || '');
        }
    }
    return tcRows;
}

// 결과 열 조건부 서식 (PC/모바일/콘솔 결과)
function addResultCondFormat(sheetId, colIdx, totalDataRows) {
    const range = { sheetId, startRowIndex: 1, endRowIndex: totalDataRows + 1, startColumnIndex: colIdx, endColumnIndex: colIdx + 1 };
    return [
        { addConditionalFormatRule: { rule: { ranges: [range], booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'PASS' }] }, format: { backgroundColor: { red: 0.1294, green: 0.4510, blue: 0.8588 }, textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 } } } } }, index: 0 } },
        { addConditionalFormatRule: { rule: { ranges: [range], booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'FAIL' }] }, format: { backgroundColor: { red: 0.7529, green: 0, blue: 0 }, textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 } } } } }, index: 0 } },
        { addConditionalFormatRule: { rule: { ranges: [range], booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'BLOCK' }] }, format: { backgroundColor: { red: 0, green: 0, blue: 0 }, textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 } } } } }, index: 0 } },
        { addConditionalFormatRule: { rule: { ranges: [range], booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'N/A' }] }, format: { backgroundColor: { red: 0.9373, green: 0.9373, blue: 0.9373 }, textFormat: { foregroundColor: { red: 0, green: 0, blue: 0 } } } } }, index: 0 } },
    ];
}

// 검증단계 조건부 서식
function addVerifCondFormat(sheetId, totalDataRows) {
    const range = { sheetId, startRowIndex: 1, endRowIndex: totalDataRows + 1, startColumnIndex: 4, endColumnIndex: 5 };
    return [
        { addConditionalFormatRule: { rule: { ranges: [range], booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: '정상' }] }, format: { backgroundColor: { red: 0.851, green: 0.9216, blue: 0.827 } } } }, index: 0 } },
        { addConditionalFormatRule: { rule: { ranges: [range], booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: '부정' }] }, format: { backgroundColor: { red: 0.918, green: 0.796, blue: 0.796 } } } }, index: 0 } },
        { addConditionalFormatRule: { rule: { ranges: [range], booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: '예외' }] }, format: { backgroundColor: { red: 1.0, green: 0.949, blue: 0.8 } } } }, index: 0 } },
    ];
}

module.exports = {
    resolveCategories,
    findInsertIndex,
    groupByCategory,
    renumberAndDedup,
    addResultCondFormat,
    addVerifCondFormat,
};
