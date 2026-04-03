// scripts/util/v2/pipeline_report.js — 파이프라인 완료 처리 일괄 수행
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { loadConfig } = require('./_config');

const cfg = loadConfig();

const [,, cmd] = process.argv;

function run(cmd, opts = {}) {
    try {
        return execSync(cmd, { encoding: 'utf-8', stdio: opts.silent ? 'pipe' : 'inherit', ...opts });
    } catch (e) {
        if (!opts.ignoreError) throw e;
        return '';
    }
}

function idleAllStatus() {
    const statusDir = cfg.paths.statusDir;
    if (!fs.existsSync(statusDir)) return;
    const files = fs.readdirSync(statusDir).filter(f => f.endsWith('.txt'));
    for (const f of files) {
        fs.writeFileSync(path.join(statusDir, f), 'idle|\n', 'utf-8');
    }
    console.log(`[REPORT] 에이전트 상태 파일 ${files.length}개 idle 초기화`);
}

function calcTotalCost() {
    const timingFile = cfg.paths.timingFile;
    if (!fs.existsSync(timingFile)) return 0;
    const lines = fs.readFileSync(timingFile, 'utf-8').split('\n').slice(1);
    let total = 0;
    for (const line of lines) {
        const cols = line.split(',');
        const cost = parseFloat(cols[7]);
        if (!isNaN(cost)) total += cost;
    }
    return Math.round(total * 1000) / 1000;
}

function collectMetrics(specs) {
    // M-01~M-08 기본 집계 (타이밍 데이터 기반)
    const timingFile = cfg.paths.timingFile;
    const metrics = {};

    // M-03 부정+예외 비율, M-08 효율 등은 에이전트가 완료 보고 시 직접 기록
    // 여기서는 M-08 (총 소요 시간 집계만)
    let totalTcCount = 0;
    let totalMinutes = 0;

    if (fs.existsSync(timingFile)) {
        const lines = fs.readFileSync(timingFile, 'utf-8').split('\n').slice(1);
        for (const line of lines) {
            const cols = line.split(',');
            const dur = parseInt(cols[6], 10);
            if (!isNaN(dur)) totalMinutes += dur;
        }
    }

    metrics.totalMinutes = totalMinutes;
    metrics.totalCostUSD = calcTotalCost();
    return metrics;
}

switch (cmd) {
    case 'finalize': {
        const stateFile = cfg.paths.stateFile;
        let specs = [];
        if (fs.existsSync(stateFile)) {
            const data = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
            specs = data.specs || [];
        }

        console.log('\n[REPORT] 파이프라인 완료 처리 시작...\n');

        // 1. 에이전트 status 파일 전체 idle 초기화
        idleAllStatus();

        // 2. 대시보드 갱신 (스프레드시트 ID별)
        const dashboards = cfg.dashboards || {};
        const sheetIds = new Set(specs.map(s => s.spreadsheet_id).filter(Boolean));
        for (const id of sheetIds) {
            const script = dashboards[id];
            if (script) {
                const scriptPath = path.join(cfg.paths.scriptsUtil, script);
                if (fs.existsSync(scriptPath)) {
                    console.log(`[REPORT] 대시보드 갱신: ${script}`);
                    run(`"${cfg.paths.nodejs}" "${scriptPath}"`, { ignoreError: true });
                }
            }
        }

        // 3. 체크포인트 로그
        const checkpointLog = path.join(cfg.paths.teamDir, 'checkpoints.log');
        const doneCount = specs.filter(s => s.state === 'done').length;
        const logLine = `${new Date().toISOString().replace('T', ' ').slice(0, 16)} | pipeline-complete | 완료 스펙: ${doneCount}개\n`;
        fs.appendFileSync(checkpointLog, logLine, 'utf-8');

        // 4. 비용 집계 + 경고
        const metrics = collectMetrics(specs);
        const totalCost = metrics.totalCostUSD;
        console.log(`\n[REPORT] 총 추정 비용: $${totalCost.toFixed(3)}`);
        if (totalCost > cfg.budgetWarningThreshold) {
            console.warn(`⚠️  예산 경고: $${cfg.budgetWarningThreshold} 초과 (실제: $${totalCost.toFixed(3)})`);
        }

        // 5. 완료 보고 출력
        console.log('\n' + '='.repeat(60));
        console.log('TC 파이프라인 완료 처리 완료');
        console.log(`  완료 스펙: ${doneCount}개`);
        console.log(`  총 소요:   ${metrics.totalMinutes}분`);
        console.log(`  추정 비용: $${totalCost.toFixed(3)}`);
        console.log('='.repeat(60));

        // 6. 드라이브 sync — 기능별 specs 폴더 전체 업로드
        const uploadScript = path.join(cfg.paths.scriptsUtil, 'upload_md_to_drive.js');
        if (fs.existsSync(uploadScript)) {
            const features = [...new Set(specs.map(s => s.feature).filter(Boolean))];
            for (const feature of features) {
                console.log(`\n[REPORT] 드라이브 sync: ${feature}`);
                run(`"${cfg.paths.nodejs}" "${uploadScript}" --sync "${feature}"`, { ignoreError: true });
            }
        } else {
            console.warn('[REPORT] upload_md_to_drive.js 없음 — 드라이브 sync 건너뜀');
        }

        // 7. state.json 완료 마킹
        if (fs.existsSync(stateFile)) {
            const data = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
            data.done = true;
            data.completedAt = new Date().toISOString();
            fs.writeFileSync(stateFile, JSON.stringify(data, null, 2), 'utf-8');
        }
        break;
    }
    default:
        console.error('알 수 없는 명령:', cmd);
        console.error('사용법: pipeline_report.js <finalize>');
        process.exit(1);
}
