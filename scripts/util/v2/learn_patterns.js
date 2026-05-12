// scripts/util/v2/learn_patterns.js — 학습 패턴 추출/저장/조회 (Phase 2)
// Phase 1: query/suggest는 동작하지만 추출(extract)은 기본 구현만 제공
'use strict';
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./_config');

const cfg = loadConfig();
const PATTERNS_FILE = cfg.paths.learnedPatterns;

function ensureDir(p) {
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadPatterns() {
    if (!fs.existsSync(PATTERNS_FILE)) return { version: '2.0', lastUpdated: '', patterns: [] };
    return JSON.parse(fs.readFileSync(PATTERNS_FILE, 'utf-8'));
}

function savePatterns(data) {
    data.lastUpdated = new Date().toISOString().slice(0, 10);
    ensureDir(PATTERNS_FILE);
    fs.writeFileSync(PATTERNS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

const [,, cmd, ...args] = process.argv;

switch (cmd) {
    case 'query': {
        // 주입용: occurrences >= 2인 패턴 출력
        const data = loadPatterns();
        const minOcc = parseInt(args[0] || '2', 10);
        const relevant = data.patterns
            .filter(p => p.occurrences >= minOcc)
            .slice(0, 5); // 최대 5개 주입
        if (relevant.length === 0) {
            console.log('(학습 패턴 없음)');
        } else {
            relevant.forEach(p => {
                console.log(`- [${p.id}] ${p.eval} ${p.category}: ${p.occurrences}회 반복. ${p.prevention}`);
            });
        }
        break;
    }
    case 'suggest': {
        // 3회 이상 반복 패턴 → 스킬 파일 개선 권고
        const data = loadPatterns();
        const repeated = data.patterns.filter(p => p.occurrences >= 3);
        if (repeated.length === 0) {
            console.log('(스킬 파일 개선 권고 없음)');
        } else {
            console.log('\n📌 스킬 파일 개선 권고 (3회+ 반복 패턴):');
            repeated.forEach(p => {
                console.log(`  [${p.id}] ${p.eval} → ${p.skillTarget} 수정 권고 (${p.occurrences}회)`);
                console.log(`    원인: ${p.description}`);
            });
        }
        break;
    }
    case 'extract': {
        // Phase 2에서 완전 구현 예정. 현재는 파일 존재 확인만.
        const [filePath] = args;
        if (!filePath || !fs.existsSync(filePath)) {
            console.log('[learn_patterns] extract: 회고 파일 없음 (건너뜀)');
            break;
        }
        console.log(`[learn_patterns] extract: ${filePath} — Phase 2에서 완전 구현 예정`);
        break;
    }
    default:
        console.error('알 수 없는 명령:', cmd);
        console.error('사용법: learn_patterns.js <query|suggest|extract>');
        process.exit(1);
}
