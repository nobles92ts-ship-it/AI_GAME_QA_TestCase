// scripts/util/v2/pipeline_gate.js — 검증 게이트 점유/해제 판정
'use strict';
const fs = require('fs');
const { loadConfig } = require('./_config');

const cfg = loadConfig();
const STATE_FILE = cfg.paths.stateFile;

// 게이트 점유 상태 목록
const GATE_STATES = new Set(['written', 'reviewing', 'fixing', 'verifying']);

function loadState() {
    if (!fs.existsSync(STATE_FILE)) return { specs: [] };
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
}

function saveState(data) {
    data.savedAt = new Date().toISOString();
    fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

const [,, cmd, feature] = process.argv;

switch (cmd) {
    case 'check': {
        const data = loadState();
        const occupant = data.specs.find(s => GATE_STATES.has(s.state));
        const waiters = data.specs.filter(s => s.state === 'wait_for_gate').map(s => s.feature);
        const result = {
            occupied: !!occupant,
            occupant: occupant ? occupant.feature : null,
            waiters,
        };
        console.log(JSON.stringify(result, null, 2));
        break;
    }
    case 'enter': {
        if (!feature) { console.error('사용법: pipeline_gate.js enter <feature>'); process.exit(1); }
        const data = loadState();
        const hasOccupant = data.specs.some(s => GATE_STATES.has(s.state) && s.feature !== feature);
        const spec = data.specs.find(s => s.feature === feature);
        if (!spec) { console.error(`스펙 '${feature}'을 찾을 수 없습니다.`); process.exit(1); }

        if (hasOccupant) {
            spec.state = 'wait_for_gate';
            saveState(data);
            console.log(JSON.stringify({ entered: false, state: 'wait_for_gate', feature }));
        } else {
            spec.state = 'written';
            saveState(data);
            // 다음 pending 스펙 확인
            const nextPending = data.specs.find(s => s.state === 'pending');
            console.log(JSON.stringify({ entered: true, state: 'written', feature, nextPending: nextPending ? nextPending.feature : null }));
        }
        break;
    }
    case 'release': {
        if (!feature) { console.error('사용법: pipeline_gate.js release <feature>'); process.exit(1); }
        const data = loadState();
        const spec = data.specs.find(s => s.feature === feature);
        if (spec) spec.state = 'done';

        // wait_for_gate 첫 번째 스펙 자동 진입
        const waiter = data.specs.find(s => s.state === 'wait_for_gate');
        let entered = null;
        let nextPending = null;
        if (waiter) {
            waiter.state = 'written';
            entered = waiter.feature;
            const np = data.specs.find(s => s.state === 'pending');
            if (np) nextPending = np.feature;
        }
        saveState(data);
        console.log(JSON.stringify({ released: feature, gateEntered: entered, nextPending }));
        break;
    }
    default:
        console.error('알 수 없는 명령:', cmd);
        console.error('사용법: pipeline_gate.js <check|enter|release>');
        process.exit(1);
}
