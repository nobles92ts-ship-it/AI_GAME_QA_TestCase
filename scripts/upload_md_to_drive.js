/**
 * MD 파일을 구글 드라이브 기획서 폴더에 업로드
 * 사용법: node upload_md_to_drive.js <파일경로1> [파일경로2] ...
 */
const { google } = require('googleapis');
const { getAuthClient } = require('./google_auth');
const fs = require('fs');
const path = require('path');

const FOLDER_ID = '1YxK2WVH6nr-e0_2qjDb4DSxXgAffsA2q'; // 기획서 폴더

async function uploadMdFiles(filePaths) {
    const auth = await getAuthClient();
    const drive = google.drive({ version: 'v3', auth });

    for (const filePath of filePaths) {
        const absPath = path.resolve(filePath);
        const fileName = path.basename(absPath);

        if (!fs.existsSync(absPath)) {
            console.error(`  ✗ 파일 없음: ${absPath}`);
            continue;
        }

        console.log(`  업로드 중: ${fileName}`);

        const res = await drive.files.create({
            resource: {
                name: fileName,
                parents: [FOLDER_ID],
                mimeType: 'text/markdown'
            },
            media: {
                mimeType: 'text/markdown',
                body: fs.createReadStream(absPath)
            },
            fields: 'id, webViewLink'
        });
        console.log(`  ✔ 업로드 완료: ${fileName}`);
        console.log(`     👉 ${res.data.webViewLink}`);
    }
}

const args = process.argv.slice(2);
if (args.length === 0) {
    console.error('사용법: node upload_md_to_drive.js <파일경로1> [파일경로2] ...');
    process.exit(1);
}

uploadMdFiles(args).catch(err => {
    console.error('에러:', err.message || err);
});
