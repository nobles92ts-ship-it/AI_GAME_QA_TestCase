// scripts/util/v2/pipeline_timing.js — 타이밍 로그 기록 (시작/종료)
'use strict';
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./_config');

const cfg = loadConfig();
const TIMING_FILE = cfg.paths.timingFile;
const STATUS_DIR = cfg.paths.statusDir;

const [,, cmd, feature, stageName] = process.argv;

function ensureDir(filePath) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function startFile(feature) {
    return path.join(STATUS_DIR, `.tc_stage_start_${feature.replace(/[^a-zA-Z0-9가-힣_-]/g, '_')}`);
}

function now() {
    return new Date();
}

function fmtDate(d) {
    return d.toISOString().slice(0, 10);
}

function fmtDateTime(d) {
    return d.toISOString().replace('T', ' ').slice(0, 19);
}

switch (cmd) {
    case 'start': {
        if (!feature) { console.error('사용법: pipeline_timing.js start <feature>'); process.exit(1); }
        ensureDir(STATUS_DIR);
        const d = now();
        fs.writeFileSync(startFile(feature), `${d.getTime()}|${fmtDateTime(d)}`, 'utf-8');
        console.log(`[타이밍] 시작 기록: ${feature}`);
        break;
    }
    case 'end': {
        if (!feature || !stageName) { console.error('사용법: pipeline_timing.js end <feature> <stageName>'); process.exit(1); }
        const sf = startFile(feature);
        let startTs = null, startDt = '';
        if (fs.existsSync(sf)) {
            const parts = fs.readFileSync(sf, 'utf-8').split('|');
            startTs = parseInt(parts[0], 10);
            startDt = parts[1] || '';
            fs.unlinkSync(sf);
        }
        const endD = now();
        const endDt = fmtDateTime(endD);
        const durMin = startTs ? Math.round((endD.getTime() - startTs) / 60000) : '';
        const costMap = cfg.costPerStage || {};
        const cost = costMap[stageName] || '';
        const line = `${fmtDate(endD)},${feature},-,${stageName},${startDt},${endDt},${durMin},${cost}`;
        ensureDir(TIMING_FILE);
        if (!fs.existsSync(TIMING_FILE)) {
            fs.writeFileSync(TIMING_FILE, '날짜,기능명,파트,단계,시작시간,완료시간,소요(분),비용USD(추정)\n', 'utf-8');
        }
        fs.appendFileSync(TIMING_FILE, line + '\n', 'utf-8');
        console.log(`[타이밍] 기록 완료: ${feature} / ${stageName} / ${durMin}분`);
        break;
    }
    default:
        console.error('알 수 없는 명령:', cmd);
        console.error('사용법: pipeline_timing.js <start|end>');
        process.exit(1);
}
