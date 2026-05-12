// scripts/util/v2/pipeline_state.js — state.json CRUD + 크래시 복구
'use strict';
const fs = require('fs');
const { loadConfig } = require('./_config');

const cfg = loadConfig();
const STATE_FILE = cfg.paths.stateFile;

const [,, cmd, ...args] = process.argv;

function ensureDir(filePath) {
    const dir = require('path').dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

switch (cmd) {
    case 'init': {
        // args[0] = JSON 문자열 (specs 배열)
        if (!args[0]) { console.error('사용법: pipeline_state.js init <specs_json>'); process.exit(1); }
        let specs;
        try { specs = JSON.parse(args[0]); } catch (e) { console.error('specs JSON 파싱 실패:', e.message); process.exit(1); }
        const state = { specs, savedAt: new Date().toISOString() };
        ensureDir(STATE_FILE);
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
        console.log(`state.json 초기화 완료 (${specs.length}개 스펙)`);
        break;
    }
    case 'update': {
        // args: feature, newState, reviewRound(optional)
        const [feature, newState, reviewRound] = args;
        if (!feature || !newState) { console.error('사용법: pipeline_state.js update <feature> <state> [reviewRound]'); process.exit(1); }
        if (!fs.existsSync(STATE_FILE)) { console.error('state.json 없음. init 먼저 실행 필요.'); process.exit(1); }
        const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
        const spec = data.specs.find(s => s.feature === feature);
        if (!spec) { console.error(`스펙 '${feature}'을 찾을 수 없습니다.`); process.exit(1); }
        spec.state = newState;
        if (reviewRound !== undefined) spec.review_round = parseInt(reviewRound, 10);
        data.savedAt = new Date().toISOString();
        fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2), 'utf-8');
        console.log(`[${feature}] state → ${newState}${reviewRound !== undefined ? ` (round ${reviewRound})` : ''}`);
        break;
    }
    case 'get': {
        if (!fs.existsSync(STATE_FILE)) { console.log('{}'); break; }
        process.stdout.write(fs.readFileSync(STATE_FILE, 'utf-8'));
        break;
    }
    case 'recover': {
        if (!fs.existsSync(STATE_FILE)) {
            console.log('state.json 없음 — 신규 파이프라인으로 시작');
            process.exit(0);
        }
        const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
        console.log(`복구 가능: ${data.specs ? data.specs.length : 0}개 스펙, 저장 시각: ${data.savedAt}`);
        data.specs && data.specs.forEach(s => console.log(`  [${s.state}] ${s.feature}`));
        break;
    }
    default:
        console.error('알 수 없는 명령:', cmd);
        console.error('사용법: pipeline_state.js <init|update|get|recover>');
        process.exit(1);
}
