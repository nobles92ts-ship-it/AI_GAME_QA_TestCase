/**
 * 대시보드 AI 메트릭 영역 갱신 스크립트
 * - 위치: 대시보드 탭 Q열~R열 (기존 영역 A~L 무변경)
 * - 1차 메트릭: 편향 분포 (플랫폼/검증단계/카테고리)
 * - 추후 추가: 환각률, 평균 토큰, 리뷰어 일관성
 *
 * 사용법: node update_metrics.js <스프레드시트ID>
 */
const { getAuthClient } = require('./google_auth');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

// specs 폴더 위치 (스크립트 위치 기준)
const SPECS_DIR = path.resolve(__dirname, '../../team/specs');

// 토큰 로그 위치 (Claude Code 세션 로그)
const TOKEN_LOG_DIRS = [
  '{CLAUDE_HOME}/projects/c--Users-Admin-Downloads',
  '{CLAUDE_HOME}/projects/C--Users-Admin-Downloads-AI-AntiGravity',
  '{CLAUDE_HOME}/projects/C--Users-Admin-Downloads-AI-AntiGravity-scripts-util',
];
const TOKEN_RECENT_DAYS = 30; // 최근 N일 토큰만 집계

// 환각 의심 키워드 (이슈 본문에 포함되면 환각으로 분류)
// 노이즈 키워드("기획 확인 필요", "없는 ")는 의도적 제외
const HALLUCINATION_KEYWORDS = [
  '기획서에 없',
  '기획서 미존재',
  '기획서에 명시되지 않',
  '기획서에 명시 없',
  '기획에 없',
  '미명시',
  '임의 추가',
  '임의 추론',
  '임의로 추가',
  '임의로 추론',
  '근거 없',
  '근거가 없',
  '근거 부족',
];

// 환각 신호 태그 ([기획] 태그는 환각으로 자동 분류)
const HALLUCINATION_TAGS = new Set(['기획']);

// 시트명 ↔ specs 폴더 alias (normalize로 매칭 안 되는 케이스)
const SHEET_TO_FOLDER_ALIAS = {
  '퀘스트UI개선': '퀘스트_UI_시스템_개선',
  '아바타합성확정': '한 기능',
  // 필요 시 추가
};

const argId = process.argv[2];
if (!argId && !process.env.SPREADSHEET_ID) {
  console.error('사용법: node update_metrics.js <스프레드시트ID>');
  process.exit(1);
}
const SPREADSHEET_ID = argId || process.env.SPREADSHEET_ID;
const DASHBOARD_NAME = '대시보드';
const METRIC_COL_START = 16; // Q열 (0-indexed)

const RESULT_VALUES = new Set(['PASS', 'FAIL', 'BLOCK', '미진행', 'N/A']);

const C = {
  HDR_BG:   { red: 0.173, green: 0.243, blue: 0.694 },
  SUB_HDR:  { red: 0.384, green: 0.467, blue: 0.824 },
  WHITE:    { red: 1, green: 1, blue: 1 },
  BLACK:    { red: 0, green: 0, blue: 0 },
  CELL_BG:  { red: 0.95, green: 0.95, blue: 0.98 },
  NA_BG:    { red: 0.93, green: 0.93, blue: 0.93 },
  WARN_BG:  { red: 1.0, green: 0.92, blue: 0.85 },
  GOOD_BG:  { red: 0.88, green: 0.96, blue: 0.88 },
};

function R(sheetId, r1, c1, r2, c2) {
  return { sheetId, startRowIndex: r1, endRowIndex: r2, startColumnIndex: c1, endColumnIndex: c2 };
}
function fmt(bg, fg = C.BLACK, bold = false, hAlign = 'CENTER', size = 10) {
  return {
    backgroundColor: bg,
    textFormat: { foregroundColor: fg, bold, fontSize: size },
    horizontalAlignment: hAlign,
    verticalAlignment: 'MIDDLE',
    wrapStrategy: 'CLIP',
  };
}
function repeat(rng, format) {
  return {
    repeatCell: {
      range: rng, cell: { userEnteredFormat: format },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)',
    },
  };
}

// 헤더에서 컬럼 자동 매핑
function findCol(headers, candidates) {
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] || '').trim();
    if (candidates.some(c => h.includes(c))) return i;
  }
  return -1;
}
function colLetter(c) {
  let result = '', n = c + 1;
  while (n > 0) {
    result = String.fromCharCode(65 + ((n - 1) % 26)) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

// 시트명/폴더명 정규화 (공백/언더스코어 통일, 소문자)
function normalizeName(s) {
  return String(s).replace(/[\s_]/g, '').toLowerCase();
}

// 시트명에 가장 잘 매칭되는 specs 폴더 찾기
function findSpecFolder(sheetName, specFolders) {
  // 0순위: alias 명시적 매핑
  if (SHEET_TO_FOLDER_ALIAS[sheetName]) {
    const aliased = SHEET_TO_FOLDER_ALIAS[sheetName];
    if (specFolders.includes(aliased)) return aliased;
  }
  const target = normalizeName(sheetName);
  // 1순위: 완전 일치
  for (const f of specFolders) {
    if (normalizeName(f) === target) return f;
  }
  // 2순위: 부분 일치
  for (const f of specFolders) {
    const nf = normalizeName(f);
    if (nf.includes(target) || target.includes(nf)) return f;
  }
  return null;
}

// 폴더에서 가장 최신 review_*.md 1개 선택 (mtime 기준)
function pickLatestReview(folderPath) {
  if (!fs.existsSync(folderPath)) return null;
  const files = fs.readdirSync(folderPath)
    .filter(f => f.startsWith('review_') && f.endsWith('.md'));
  if (files.length === 0) return null;
  const withMtime = files.map(f => ({
    name: f,
    mtime: fs.statSync(path.join(folderPath, f)).mtimeMs,
  }));
  withMtime.sort((a, b) => b.mtime - a.mtime);
  return path.join(folderPath, withMtime[0].name);
}

// 최근 N일 토큰 사용량 집계 (.claude/projects/ .jsonl 파싱)
function collectTokenUsage(days) {
  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  const totals = { input: 0, output: 0, cacheCreate: 0, cacheRead: 0, sessions: 0 };

  for (const dir of TOKEN_LOG_DIRS) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'));
    for (const f of files) {
      const fp = path.join(dir, f);
      let stat;
      try { stat = fs.statSync(fp); } catch { continue; }
      if (stat.mtimeMs < cutoff) continue;
      totals.sessions++;

      let content;
      try { content = fs.readFileSync(fp, 'utf8'); } catch { continue; }
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          const u = obj.message && obj.message.usage;
          if (!u) continue;
          totals.input       += u.input_tokens                 || 0;
          totals.output      += u.output_tokens                || 0;
          totals.cacheCreate += u.cache_creation_input_tokens  || 0;
          totals.cacheRead   += u.cache_read_input_tokens      || 0;
        } catch {}
      }
    }
  }
  return totals;
}

// review 파일에서 이슈 카운트 추출
function parseReview(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const result = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, hallucination: 0 };

  // 이슈 요약 표 파싱: "| CRITICAL | 3 |" 형식
  const tableRe = /\|\s*(CRITICAL|HIGH|MEDIUM|LOW)\s*\|\s*(\d+)\s*\|/gi;
  let m;
  while ((m = tableRe.exec(content)) !== null) {
    const sev = m[1].toUpperCase();
    if (result.hasOwnProperty(sev)) {
      result[sev] = Math.max(result[sev], parseInt(m[2], 10) || 0);
    }
  }

  // 환각 의심 이슈 카운트: [CRITICAL]/[HIGH] 블록 중
  //   (A) 태그가 [기획] 이거나, (B) 환각 키워드 매칭
  const issueBlocks = content.split(/\n####\s+/);
  for (const block of issueBlocks) {
    const sevTagMatch = block.match(/^\[(CRITICAL|HIGH)\]\[([^\]]+)\]/);
    if (!sevTagMatch) continue;
    const tag = sevTagMatch[2];
    const isHallucinationTag = HALLUCINATION_TAGS.has(tag);
    const hasKeyword = HALLUCINATION_KEYWORDS.some(kw => block.includes(kw));
    if (isHallucinationTag || hasKeyword) {
      result.hallucination++;
    }
  }

  return result;
}

async function main() {
  const auth = await getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const dashSheet = meta.data.sheets.find(s => s.properties.title === DASHBOARD_NAME);
  if (!dashSheet) {
    console.error(`❌ "${DASHBOARD_NAME}" 탭 없음`);
    process.exit(1);
  }
  const SID = dashSheet.properties.sheetId;

  const tcSheets = meta.data.sheets
    .filter(s => s.properties.title !== DASHBOARD_NAME && !s.properties.hidden)
    .map(s => s.properties.title);

  console.log(`TC 시트 ${tcSheets.length}개 분석 시작...`);

  // 누적 통계
  let totalTc = 0;
  let pcCount = 0, mobileCount = 0;
  const categoryDist = {};
  const verifyDist = {};

  for (const sheetName of tcSheets) {
    // 헤더 + 데이터 한 번에 읽기
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1:Z`,
    });
    const rows = resp.data.values || [];
    if (rows.length < 2) continue;

    const headers = rows[0];
    const catCol    = findCol(headers, ['대분류']);
    const verifyCol = findCol(headers, ['검증단계', '검증 단계']);
    const pcCol     = findCol(headers, ['PC', 'PC 결과', 'PC결과']);
    const mobileCol = findCol(headers, ['모바일']);

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const cat     = catCol    >= 0 ? String(row[catCol]    || '').trim() : '';
      const verify  = verifyCol >= 0 ? String(row[verifyCol] || '').trim() : '';
      const pc      = pcCol     >= 0 ? String(row[pcCol]     || '').trim() : '';
      const mb      = mobileCol >= 0 ? String(row[mobileCol] || '').trim() : '';

      if (!cat && !verify && !pc && !mb) continue; // 빈 행

      totalTc++;
      if (RESULT_VALUES.has(pc) && pc !== 'N/A') pcCount++;
      if (RESULT_VALUES.has(mb) && mb !== 'N/A') mobileCount++;
      if (cat)    categoryDist[cat]   = (categoryDist[cat]   || 0) + 1;
      if (verify) verifyDist[verify]  = (verifyDist[verify]  || 0) + 1;
    }
  }

  // 편향 점수 (0~1, 1=균형)
  const platTotal = pcCount + mobileCount;
  const platBalance = platTotal === 0 ? 0 :
    1 - Math.abs(pcCount - mobileCount) / platTotal;

  const normal   = verifyDist['정상'] || 0;
  const negative = verifyDist['부정'] || 0;
  const boundary = verifyDist['경계'] || 0;
  const vbTotal = normal + negative;
  const verifyBalance = vbTotal === 0 ? 0 :
    1 - Math.abs(normal - negative) / vbTotal;

  const biasScore = ((platBalance + verifyBalance) / 2);

  // ─── review 파일 스캔 ──────────────────────────
  const issueTotals = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, hallucination: 0 };
  let matchedSheets = 0;
  const noFolderSheets = [];   // specs 폴더 자체 없음
  const noReviewSheets = [];   // 폴더는 있는데 review 없음

  let specFolders = [];
  if (fs.existsSync(SPECS_DIR)) {
    specFolders = fs.readdirSync(SPECS_DIR)
      .filter(f => fs.statSync(path.join(SPECS_DIR, f)).isDirectory());
  }

  for (const sheetName of tcSheets) {
    const folder = findSpecFolder(sheetName, specFolders);
    if (!folder) { noFolderSheets.push(sheetName); continue; }
    const reviewPath = pickLatestReview(path.join(SPECS_DIR, folder));
    if (!reviewPath) { noReviewSheets.push(sheetName); continue; }
    matchedSheets++;
    const parsed = parseReview(reviewPath);
    for (const k of Object.keys(issueTotals)) issueTotals[k] += parsed[k];
  }

  const denom = totalTc || 1;
  const criticalDensity = (issueTotals.CRITICAL / denom * 100).toFixed(2);
  const highDensity     = (issueTotals.HIGH     / denom * 100).toFixed(2);
  const mediumDensity   = (issueTotals.MEDIUM   / denom * 100).toFixed(2);
  const hallucinationRate = (issueTotals.hallucination / denom * 100).toFixed(2);

  // ─── 토큰 사용량 집계 ─────────────────────────
  console.log(`\n토큰 로그 스캔 중 (최근 ${TOKEN_RECENT_DAYS}일)...`);
  const tokens = collectTokenUsage(TOKEN_RECENT_DAYS);
  const tokenTotal = tokens.input + tokens.output + tokens.cacheCreate + tokens.cacheRead;
  const tokenPerTc = totalTc > 0 ? Math.round(tokenTotal / totalTc) : 0;

  // 단위 변환 (M = 백만, K = 천)
  const fmtTokens = (n) => {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return String(n);
  };

  console.log(`\n=== 결과 ===`);
  console.log(`총 TC: ${totalTc}`);
  console.log(`PC 결과: ${pcCount} / 모바일 결과: ${mobileCount} → 플랫폼 균형 ${platBalance.toFixed(2)}`);
  console.log(`정상 ${normal} / 부정 ${negative} / 경계 ${boundary} → 검증 균형 ${verifyBalance.toFixed(2)}`);
  console.log(`종합 편향 점수: ${biasScore.toFixed(2)}`);
  console.log(`\n[이슈 밀도] review 매칭 ${matchedSheets}/${tcSheets.length} 시트`);
  console.log(`  CRITICAL ${issueTotals.CRITICAL} (${criticalDensity}%) / HIGH ${issueTotals.HIGH} (${highDensity}%) / MEDIUM ${issueTotals.MEDIUM} (${mediumDensity}%)`);
  console.log(`  환각 의심: ${issueTotals.hallucination}건 (${hallucinationRate}%)`);
  console.log(`\n[토큰 사용 최근 ${TOKEN_RECENT_DAYS}일] 세션 ${tokens.sessions}개`);
  console.log(`  입력 ${fmtTokens(tokens.input)} / 출력 ${fmtTokens(tokens.output)} / 캐시생성 ${fmtTokens(tokens.cacheCreate)} / 캐시읽기 ${fmtTokens(tokens.cacheRead)}`);
  console.log(`  총합 ${fmtTokens(tokenTotal)} → TC당 평균 ${fmtTokens(tokenPerTc)}`);
  if (noReviewSheets.length > 0) {
    console.log(`  📂 폴더 있음/review 없음 (${noReviewSheets.length}): ${noReviewSheets.join(', ')}`);
  }
  if (noFolderSheets.length > 0) {
    console.log(`  ❌ specs 폴더 없음 (${noFolderSheets.length}): ${noFolderSheets.join(', ')}`);
  }

  // ─── Q열 영역 쓰기 ─────────────────────────────────
  const Qcol = colLetter(METRIC_COL_START);     // 'Q'
  const Rcol = colLetter(METRIC_COL_START + 1); // 'R'

  // 그리드 확장
  const reqs = [];
  if (dashSheet.properties.gridProperties.columnCount < METRIC_COL_START + 2) {
    reqs.push({
      updateSheetProperties: {
        properties: {
          sheetId: SID,
          gridProperties: {
            columnCount: METRIC_COL_START + 4,
            rowCount: Math.max(dashSheet.properties.gridProperties.rowCount, 80),
          },
        },
        fields: 'gridProperties.columnCount,gridProperties.rowCount',
      },
    });
  }

  // Q열 영역 초기화 (기존 영역 무변경)
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `${DASHBOARD_NAME}!${Qcol}1:${Rcol}80`,
  });

  // 값 입력
  const data = [];
  const sectionHdrRows = []; // 0-indexed 섹션 헤더 행 (서식용)
  let r = 1; // 1-indexed

  const pushSection = (title) => {
    sectionHdrRows.push(r - 1); // 0-indexed
    data.push({ range: `${DASHBOARD_NAME}!${Qcol}${r}`, values: [[title]] });
    r += 1;
  };
  const pushRow = (row) => {
    data.push({ range: `${DASHBOARD_NAME}!${Qcol}${r}`, values: [row] });
    r += 1;
  };

  // 메인 헤더 (별도 처리)
  data.push({ range: `${DASHBOARD_NAME}!${Qcol}${r}`, values: [['AI 메트릭']] });
  const mainHdrRow = r - 1; // 0-indexed
  r += 1;

  // 핵심 지표
  pushSection('핵심 지표');
  [
    ['전체 TC 수',     totalTc],
    ['편향 점수',      biasScore.toFixed(2)],
    ['환각 의심률',    `${hallucinationRate}%`],
    ['리뷰어 일관성',  'N/A (추후)'],
    ['TC당 평균 토큰', fmtTokens(tokenPerTc)],
  ].forEach(pushRow);
  r += 1; // 공백

  // 이슈 밀도
  pushSection('이슈 밀도 (리뷰 보고서)');
  [
    ['CRITICAL 밀도', `${criticalDensity}%  (${issueTotals.CRITICAL})`],
    ['HIGH 밀도',     `${highDensity}%  (${issueTotals.HIGH})`],
    ['MEDIUM 밀도',   `${mediumDensity}%  (${issueTotals.MEDIUM})`],
    ['LOW 건수',      issueTotals.LOW],
    ['환각 의심 건수', issueTotals.hallucination],
    ['리뷰 커버리지', `${matchedSheets}/${tcSheets.length}`],
  ].forEach(pushRow);
  r += 1;

  // 토큰 사용량
  pushSection(`토큰 사용 (최근 ${TOKEN_RECENT_DAYS}일)`);
  [
    ['세션 수',     tokens.sessions],
    ['입력 토큰',   fmtTokens(tokens.input)],
    ['출력 토큰',   fmtTokens(tokens.output)],
    ['캐시 생성',   fmtTokens(tokens.cacheCreate)],
    ['캐시 읽기',   fmtTokens(tokens.cacheRead)],
    ['총합',        fmtTokens(tokenTotal)],
    ['TC당 평균',   fmtTokens(tokenPerTc)],
  ].forEach(pushRow);
  r += 1;

  // 플랫폼 분포
  pushSection('플랫폼 분포');
  [
    ['PC 결과 수',     pcCount],
    ['모바일 결과 수', mobileCount],
    ['균형도',         platBalance.toFixed(2)],
  ].forEach(pushRow);
  r += 1;

  // 검증단계 분포
  pushSection('검증단계 분포');
  [
    ['정상',   normal],
    ['부정',   negative],
    ['경계',   boundary],
    ['균형도', verifyBalance.toFixed(2)],
  ].forEach(pushRow);
  r += 1;

  // 카테고리 분포 (상위 N개)
  pushSection('카테고리 분포 (상위 15)');
  const sortedCats = Object.entries(categoryDist)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);
  sortedCats.forEach(([name, cnt]) => pushRow([name, cnt]));

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { valueInputOption: 'USER_ENTERED', data },
  });

  // ─── 서식 ─────────────────────────────────
  // 메인 헤더 (Q1:R1)
  reqs.push({ mergeCells: { range: R(SID, mainHdrRow, METRIC_COL_START, mainHdrRow + 1, METRIC_COL_START + 2), mergeType: 'MERGE_ALL' } });
  reqs.push(repeat(R(SID, mainHdrRow, METRIC_COL_START, mainHdrRow + 1, METRIC_COL_START + 2),
    fmt(C.HDR_BG, C.WHITE, true, 'CENTER', 13)));

  // 섹션 헤더 행 (동적 계산, 병합 + 진한 색)
  sectionHdrRows.forEach(rIdx => {
    reqs.push({ mergeCells: { range: R(SID, rIdx, METRIC_COL_START, rIdx + 1, METRIC_COL_START + 2), mergeType: 'MERGE_ALL' } });
    reqs.push(repeat(R(SID, rIdx, METRIC_COL_START, rIdx + 1, METRIC_COL_START + 2),
      fmt(C.SUB_HDR, C.WHITE, true, 'CENTER', 11)));
  });

  // 전체 본문 배경
  const lastRow = r;
  reqs.push(repeat(R(SID, 1, METRIC_COL_START, lastRow, METRIC_COL_START + 2), fmt(C.CELL_BG)));

  // 라벨 좌측 정렬 + 굵게 (Q열만)
  reqs.push(repeat(R(SID, 1, METRIC_COL_START, lastRow, METRIC_COL_START + 1),
    fmt(C.CELL_BG, C.BLACK, true, 'LEFT')));

  // 섹션/메인 헤더 다시 덮어쓰기 (좌측정렬에 의해 덮인 부분 복구)
  reqs.push(repeat(R(SID, mainHdrRow, METRIC_COL_START, mainHdrRow + 1, METRIC_COL_START + 2),
    fmt(C.HDR_BG, C.WHITE, true, 'CENTER', 13)));
  sectionHdrRows.forEach(rIdx => {
    reqs.push(repeat(R(SID, rIdx, METRIC_COL_START, rIdx + 1, METRIC_COL_START + 2),
      fmt(C.SUB_HDR, C.WHITE, true, 'CENTER', 11)));
  });

  // 열 너비
  reqs.push({
    updateDimensionProperties: {
      range: { sheetId: SID, dimension: 'COLUMNS', startIndex: METRIC_COL_START, endIndex: METRIC_COL_START + 1 },
      properties: { pixelSize: 200 }, fields: 'pixelSize',
    },
  });
  reqs.push({
    updateDimensionProperties: {
      range: { sheetId: SID, dimension: 'COLUMNS', startIndex: METRIC_COL_START + 1, endIndex: METRIC_COL_START + 2 },
      properties: { pixelSize: 110 }, fields: 'pixelSize',
    },
  });

  // 배치 적용
  for (let i = 0; i < reqs.length; i += 30) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: reqs.slice(i, i + 30) },
    });
  }

  console.log(`\n✅ ${Qcol}열 메트릭 영역 갱신 완료`);
  console.log(`   https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit#gid=${SID}`);
}

module.exports = { main };
if (require.main === module) {
  main().catch(err => { console.error('❌', err.message); process.exit(1); });
}
