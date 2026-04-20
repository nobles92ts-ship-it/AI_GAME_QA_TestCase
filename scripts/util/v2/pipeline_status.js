// scripts/util/v2/pipeline_status.js — 에이전트 상태 파일 관리 (통합 진입점)
// start: 상태 기록 + 타이밍 시작
// end:   상태 idle + 타이밍 종료 + state.json 업데이트
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { loadConfig } = require('./_config');

const cfg = loadConfig();
const STATUS_DIR = cfg.paths.statusDir;
const NODE = cfg.paths.nodejs;
const V2_DIR = cfg.paths.scriptsV2;

const [,, cmd, agentName, feature, stageName, newState, reviewRound] = process.argv;

function ensureDir(p) {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function statusFile(agent) {
    return path.join(STATUS_DIR, `${agent}.txt`);
}

function run(script, ...args) {
    const fullPath = path.join(V2_DIR, script);
    const quotedArgs = args.map(a => `"${a}"`).join(' ');
    execSync(`"${NODE}" "${fullPath}" ${quotedArgs}`, { stdio: 'inherit' });
}

switch (cmd) {
    case 'start': {
        if (!agentName || !feature) {
            console.error('사용법: pipeline_status.js start <agentName> <feature>');
            process.exit(1);
        }
        ensureDir(STATUS_DIR);
        // 상태 파일 기록
        const actionMap = {
            'tc-designer': '분석/설계중',
            'tc-writer': 'TC생성중',
            'qa-reviewer': '리뷰중',
            'tc-fixer': '수정중',
        };
        const action = actionMap[agentName] || '작업중';
        fs.writeFileSync(statusFile(agentName), `${action}|${feature}\n`, 'utf-8');
        // 타이밍 시작
        run('pipeline_timing.js', 'start', feature);
        console.log(`[STATUS] ${agentName} 시작: ${feature}`);
        break;
    }
    case 'end': {
        if (!agentName || !feature || !stageName) {
            console.error('사용법: pipeline_status.js end <agentName> <feature> <stageName> [newState] [reviewRound]');
            process.exit(1);
        }
        // 상태 파일 idle
        ensureDir(STATUS_DIR);
        fs.writeFileSync(statusFile(agentName), 'idle|\n', 'utf-8');
        // 타이밍 종료
        run('pipeline_timing.js', 'end', feature, stageName);
        // state.json 업데이트 (newState 제공 시)
        if (newState) {
            const rr = reviewRound || '';
            run('pipeline_state.js', 'update', feature, newState, ...(rr ? [rr] : []));
        }
        console.log(`[STATUS] ${agentName} 완료: ${feature} / ${stageName}`);
        break;
    }
    default:
        console.error('알 수 없는 명령:', cmd);
        console.error('사용법: pipeline_status.js <start|end>');
        process.exit(1);
}
