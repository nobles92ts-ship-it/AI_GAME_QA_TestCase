/**
 * jira_assignees.js — 기획서(confluence_raw.md)의 Jira 링크로 담당자 자동 조회 (2026-07-28)
 *
 * K~O열 패널(FINAL-2)의 담당자 칸(기획/서버/클라/UI) 자동 채움용.
 * 흐름: raw md에서 DX-키 추출 → 각 키의 부모 에픽(없으면 자신) → 에픽 하위 업무 검색
 *      → 제목 프리픽스로 분류([시스템 기획]→기획 · [서버]→서버 · [클라이언트]→클라 · [UI]→UI)
 *      → 담당자 displayName에서 이름만("시스템/강현규"→"강현규"). **[QA] 하위 업무는 제외**.
 *
 * 사용법:
 *   node jira_assignees.js <confluence_raw.md 경로 | DX-1234>
 *
 * 출력(stdout): {"기획":"...","서버":"...","클라":"...","UI":"..."}  (미발견=빈 문자열)
 * 종료 코드: 0=정상(키 미발견 포함 — 빈값 JSON) / 1=Jira 접근 실패(호출자는 '{}' 폴백)
 * 인증: ./jira_config.json (email/token/baseUrl — jira_bts.js와 동일 계정)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'jira_config.json'), 'utf8'));
const AUTH = 'Basic ' + Buffer.from(`${CONFIG.email}:${CONFIG.token}`).toString('base64');
const EMPTY = { '기획': '', '서버': '', '클라': '', 'UI': '' };

async function jget(urlPath) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    try {
        const res = await fetch(CONFIG.baseUrl + urlPath, {
            headers: { Authorization: AUTH, Accept: 'application/json' },
            signal: ctrl.signal,
        });
        if (!res.ok) return { status: res.status, data: null };
        return { status: res.status, data: await res.json() };
    } finally {
        clearTimeout(t);
    }
}

// 하위 업무 검색 — 신 엔드포인트(/search/jql) 우선, 구(/search) 폴백
async function searchChildren(epicKey) {
    const jql = encodeURIComponent(`parent = ${epicKey}`);
    const q = `jql=${jql}&fields=summary,assignee&maxResults=50`;
    let r = await jget(`/rest/api/3/search/jql?${q}`);
    if (r.status === 404 || r.status === 410) r = await jget(`/rest/api/3/search?${q}`);
    if (!r.data) throw new Error(`하위 업무 검색 실패 (${epicKey}, HTTP ${r.status})`);
    return r.data.issues || [];
}

function categoryOf(summary) {
    const tag = (summary.match(/^\s*\[([^\]]*)\]/) || [])[1] || '';
    if (/QA/i.test(tag)) return null;              // QA 하위 업무 제외 (오너 지정)
    if (tag.includes('기획')) return '기획';
    if (tag.includes('서버')) return '서버';
    if (tag.includes('클라')) return '클라';
    if (/UI/i.test(tag)) return 'UI';
    return null;
}

function nameOnly(displayName) {
    return String(displayName || '').split('/').pop().trim();
}

async function main() {
    const arg = process.argv[2];
    if (!arg) {
        console.error('사용법: node jira_assignees.js <confluence_raw.md 경로 | DX-1234>');
        process.exit(1);
    }

    let keys;
    if (/^[A-Z]+-\d+$/.test(arg)) {
        keys = [arg];
    } else {
        let raw = fs.readFileSync(arg, 'utf8');
        // Jira 매크로 UUID가 키 뒤에 공백 없이 붙는 컨버터 형식 대응 (2026-07-28 훈장 v115 실측:
        // "DX-35690e25af0f-63ab-…" → UUID 첫 글자 0까지 키로 먹혀 DX-35690으로 404).
        // 8-4-4-4-12 hex UUID가 뒤따르면 키와 UUID 사이를 띄운다.
        raw = raw.replace(
            /(DX-\d+?)(?=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi,
            '$1 '
        );
        keys = [...new Set(raw.match(/DX-\d+/g) || [])].slice(0, 5);
    }
    if (!keys.length) {
        console.error('[jira_assignees] 기획서에 DX-키 없음 — 빈값 반환');
        console.log(JSON.stringify(EMPTY));
        return;
    }

    // 각 키의 부모 에픽 후보 수집 (parent 없으면 자신이 에픽일 수 있음)
    const candidates = [];
    for (const key of keys) {
        const r = await jget(`/rest/api/3/issue/${key}?fields=parent`);
        if (!r.data) { console.error(`[jira_assignees] ${key} 조회 실패 (HTTP ${r.status}) — 스킵`); continue; }
        const cand = (r.data.fields && r.data.fields.parent && r.data.fields.parent.key) || key;
        if (!candidates.includes(cand)) candidates.push(cand);
    }
    if (!candidates.length) throw new Error('모든 DX-키 조회 실패');

    // 첫 번째로 매핑 가능한 하위 업무를 가진 에픽 채택
    for (const epic of candidates) {
        const children = await searchChildren(epic);
        const out = { ...EMPTY };
        let hit = 0;
        for (const c of children) {
            const cat = categoryOf((c.fields && c.fields.summary) || '');
            if (!cat) continue;
            const name = nameOnly(c.fields.assignee && c.fields.assignee.displayName);
            if (!name) continue;
            out[cat] = out[cat] ? (out[cat].includes(name) ? out[cat] : out[cat] + ', ' + name) : name;
            hit++;
        }
        if (hit > 0) {
            console.error(`[jira_assignees] 에픽 ${epic} — 담당자 ${hit}건 매핑`);
            console.log(JSON.stringify(out));
            return;
        }
    }
    console.error(`[jira_assignees] 에픽 후보(${candidates.join(', ')})에서 매핑 가능한 담당자 없음 — 빈값`);
    console.log(JSON.stringify(EMPTY));
}

main().catch(err => {
    console.error('[jira_assignees] 실패:', err.message || err);
    process.exit(1);
});
