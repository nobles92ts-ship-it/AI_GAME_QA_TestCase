'use strict';
// 테스트 스텁 — FINAL-5b 가 시트에 쓰는 대신, 받은 라벨을 같은 폴더 _applied_labels.json 으로 남긴다.
const fs = require('fs');
const path = require('path');
const labelsPath = process.argv[4];
if (!labelsPath) process.exit(1);
fs.copyFileSync(labelsPath, path.join(path.dirname(labelsPath), '_applied_labels.json'));
console.log('stub apply_labeling ok');
