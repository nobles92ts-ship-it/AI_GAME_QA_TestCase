/**
 * MD/XLSX 파일을 구글 드라이브 기획서 폴더에 업로드
 *
 * 사용법:
 *   node upload_md_to_drive.js --folder 친구_시스템 <파일경로1> [파일경로2] ...
 *   node upload_md_to_drive.js <파일경로1> [파일경로2] ...          ← 루트에 업로드 (레거시)
 *   node upload_md_to_drive.js --sync 친구_시스템 [로컬경로]        ← 폴더 전체 동기화
 *
 * --folder: 기능별 하위 폴더명. 없으면 자동 생성. 중복 파일은 타임스탬프 붙여 보존.
 * --sync:   team/specs/기능명/ 전체를 드라이브 기능명 폴더에 재귀 업로드.
 *           로컬경로 생략 시 team/specs/기능명/ 자동 탐색.
 */
const { google } = require('googleapis');
const { getAuthClient } = require('./google_auth');
const fs = require('fs');
const path = require('path');

const ROOT_FOLDER_ID = '1YxK2WVH6nr-e0_2qjDb4DSxXgAffsA2q';
const SPECS_BASE = path.resolve(__dirname, '../../team/specs');

async function getOrCreateSubfolder(drive, parentId, folderName) {
    const res = await drive.files.list({
        q: `'${parentId}' in parents and name = '${folderName.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id, name)',
        pageSize: 1,
    });
    if (res.data.files && res.data.files.length > 0) {
        return res.data.files[0].id;
    }
    const folder = await drive.files.create({
        requestBody: {
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentId],
        },
        fields: 'id',
    });
    console.log(`  [폴더 생성] ${folderName}`);
    return folder.data.id;
}

async function getExistingNames(drive, folderId) {
    const res = await drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'files(name)',
        pageSize: 500,
    });
    return new Set((res.data.files || []).map(f => f.name));
}

function deduplicateName(fileName, existingNames) {
    if (!existingNames.has(fileName)) return fileName;
    const ext = path.extname(fileName);
    const base = path.basename(fileName, ext);
    const ts = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    let candidate = `${base}_${ts}${ext}`;
    if (!existingNames.has(candidate)) return candidate;
    let ver = 2;
    while (existingNames.has(`${base}_${ts}_v${ver}${ext}`)) ver++;
    return `${base}_${ts}_v${ver}${ext}`;
}

function getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap = {
        '.md': 'text/markdown',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.txt': 'text/plain',
        '.json': 'application/json',
    };
    return mimeMap[ext] || 'application/octet-stream';
}

async function uploadFiles(folderName, filePaths) {
    const auth = await getAuthClient();
    const drive = google.drive({ version: 'v3', auth });

    let targetFolderId = ROOT_FOLDER_ID;
    if (folderName) {
        targetFolderId = await getOrCreateSubfolder(drive, ROOT_FOLDER_ID, folderName);
        console.log(`  대상 폴더: ${folderName}/`);
    }

    const existingNames = await getExistingNames(drive, targetFolderId);

    for (const filePath of filePaths) {
        const absPath = path.resolve(filePath);
        if (!fs.existsSync(absPath)) {
            console.error(`  ✗ 파일 없음: ${absPath}`);
            continue;
        }

        const originalName = path.basename(absPath);
        const uploadName = deduplicateName(originalName, existingNames);
        const mimeType = getMimeType(absPath);

        console.log(`  업로드 중: ${originalName}${uploadName !== originalName ? ` → ${uploadName}` : ''}`);

        const res = await drive.files.create({
            requestBody: {
                name: uploadName,
                parents: [targetFolderId],
                mimeType,
            },
            media: {
                mimeType,
                body: fs.createReadStream(absPath),
            },
            fields: 'id, webViewLink',
        });

        existingNames.add(uploadName);
        console.log(`  ✔ 업로드 완료: ${uploadName}`);
        console.log(`     ${res.data.webViewLink}`);
    }
}

async function syncDirToDrive(drive, localDir, driveFolderId, displayPath) {
    let entries;
    try {
        entries = fs.readdirSync(localDir, { withFileTypes: true });
    } catch (e) {
        console.error(`  ✗ 폴더 읽기 실패: ${localDir}`);
        return;
    }

    const existingNames = await getExistingNames(drive, driveFolderId);

    for (const entry of entries) {
        const localPath = path.join(localDir, entry.name);
        if (entry.isDirectory()) {
            const subFolderId = await getOrCreateSubfolder(drive, driveFolderId, entry.name);
            await syncDirToDrive(drive, localPath, subFolderId, `${displayPath}/${entry.name}`);
        } else {
            const uploadName = deduplicateName(entry.name, existingNames);
            const mimeType = getMimeType(localPath);

            console.log(`  업로드 중: ${displayPath}/${entry.name}${uploadName !== entry.name ? ` → ${uploadName}` : ''}`);

            const res = await drive.files.create({
                requestBody: {
                    name: uploadName,
                    parents: [driveFolderId],
                    mimeType,
                },
                media: {
                    mimeType,
                    body: fs.createReadStream(localPath),
                },
                fields: 'id, webViewLink',
            });

            existingNames.add(uploadName);
            console.log(`  ✔ ${uploadName}`);
            console.log(`     ${res.data.webViewLink}`);
        }
    }
}

async function syncFolder(featureName, localPath) {
    const localRoot = localPath || path.join(SPECS_BASE, featureName);

    if (!fs.existsSync(localRoot)) {
        console.error(`✗ 로컬 폴더 없음: ${localRoot}`);
        process.exit(1);
    }

    const auth = await getAuthClient();
    const drive = google.drive({ version: 'v3', auth });

    console.log(`\n[sync] ${featureName}`);
    console.log(`  로컬: ${localRoot}`);

    const driveFolderId = await getOrCreateSubfolder(drive, ROOT_FOLDER_ID, featureName);
    console.log(`  드라이브: ${featureName}/\n`);

    await syncDirToDrive(drive, localRoot, driveFolderId, featureName);

    console.log('\n[sync] 완료');
}

// Export for programmatic use
module.exports = { uploadFiles, syncFolder, getOrCreateSubfolder, deduplicateName };

// CLI 파싱 (직접 실행 시에만)
if (require.main !== module) return;
const args = process.argv.slice(2);

if (args[0] === '--sync') {
    const featureName = args[1];
    const localPath = args[2] || null;
    if (!featureName) {
        console.error('사용법: node upload_md_to_drive.js --sync <기능명> [로컬경로]');
        process.exit(1);
    }
    syncFolder(featureName, localPath).catch(err => {
        console.error('에러:', err.message || err);
        process.exit(1);
    });
} else {
    let folderName = null;
    const filePaths = [];

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--folder' && i + 1 < args.length) {
            folderName = args[++i];
        } else {
            filePaths.push(args[i]);
        }
    }

    if (filePaths.length === 0) {
        console.error('사용법:');
        console.error('  node upload_md_to_drive.js [--folder 기능명] <파일경로1> [파일경로2] ...');
        console.error('  node upload_md_to_drive.js --sync <기능명> [로컬경로]');
        process.exit(1);
    }

    uploadFiles(folderName, filePaths).catch(err => {
        console.error('에러:', err.message || err);
        process.exit(1);
    });
}
