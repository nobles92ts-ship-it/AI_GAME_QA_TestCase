// scripts/util/v2/_config.js — 공통 config 로더
'use strict';
const fs = require('fs');
const path = require('path');

const CONFIG_PATHS = [
    path.resolve(__dirname, '../../../pipeline_config.local.json'),
    path.resolve(__dirname, '../../../pipeline_config.json'),
];

function loadConfig() {
    for (const p of CONFIG_PATHS) {
        if (fs.existsSync(p)) {
            try {
                return JSON.parse(fs.readFileSync(p, 'utf-8'));
            } catch (e) {
                throw new Error(`pipeline_config.json 파싱 실패 (${p}): ${e.message}`);
            }
        }
    }
    throw new Error(
        'pipeline_config.json을 찾을 수 없습니다.\n' +
        'pipeline_config.json.template을 복사하여 pipeline_config.json을 만들고 경로를 설정하세요.'
    );
}

module.exports = { loadConfig };
