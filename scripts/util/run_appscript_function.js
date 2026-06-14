/**
 * run_appscript_function.js
 * Apps Script API로 함수를 원격 실행
 *
 * 사용법: node run_appscript_function.js <스프레드시트ID> <함수명>
 */
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const SPREADSHEET_ID = process.argv[2];
const FUNCTION_NAME  = process.argv[3];
if (!SPREADSHEET_ID || !FUNCTION_NAME) {
    console.error('사용법: node run_appscript_function.js <스프레드시트ID> <함수명>');
    process.exit(1);
}

const OAUTH_PATH     = process.env.GOOGLE_OAUTH_PATH || path.join(__dirname, '../credentials/client_secret.json');
const TOKEN_PATH     = path.join(__dirname, '../credentials/appscript_token.json');
const SCRIPT_ID_PATH = path.join(__dirname, '../credentials/appscript_script_id.json');

async function getAuth() {
    const credentials = JSON.parse(fs.readFileSync(OAUTH_PATH, 'utf-8'));
    const { client_id, client_secret } = credentials.installed;
    const oauth2Client = new google.auth.OAuth2(client_id, client_secret, 'http://localhost:3005');
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    oauth2Client.setCredentials(token);
    return oauth2Client;
}

async function main() {
    const auth = await getAuth();
    const saved = JSON.parse(fs.readFileSync(SCRIPT_ID_PATH, 'utf-8'));
    const scriptId = saved[SPREADSHEET_ID];
    if (!scriptId) throw new Error('scriptId 없음. 먼저 deploy_appscript.js 실행 필요');

    // ① API 실행용 deployment 보장 (기존 있으면 재사용)
    const deps = await auth.request({
        method: 'GET',
        url: `https://script.googleapis.com/v1/projects/${scriptId}/deployments`,
    });

    let apiDeployment = (deps.data.deployments || []).find(d =>
        d.entryPoints && d.entryPoints.some(e => e.entryPointType === 'EXECUTION_API')
    );

    if (!apiDeployment) {
        console.log('🔧 API_EXECUTABLE 배포 생성 중...');
        // 버전 먼저 생성
        const ver = await auth.request({
            method: 'POST',
            url: `https://script.googleapis.com/v1/projects/${scriptId}/versions`,
            data: { description: 'API executable for run_appscript_function' }
        });
        await auth.request({
            method: 'POST',
            url: `https://script.googleapis.com/v1/projects/${scriptId}/deployments`,
            data: {
                versionNumber: ver.data.versionNumber,
                manifestFileName: 'appsscript',
                description: 'API Executable'
            }
        });
        console.log('✔ 배포 생성 완료');
    } else {
        console.log('✔ 기존 API_EXECUTABLE 배포 재사용');
    }

    // ② scripts.run 호출
    console.log(`🚀 ${FUNCTION_NAME}() 실행 중...`);
    const res = await auth.request({
        method: 'POST',
        url: `https://script.googleapis.com/v1/scripts/${scriptId}:run`,
        data: {
            function: FUNCTION_NAME,
            devMode: true,  // 최신 저장본 실행 (배포 버전과 무관)
        }
    });

    if (res.data.error) {
        console.error('❌ 실행 오류:');
        console.error(JSON.stringify(res.data.error, null, 2));
        process.exit(1);
    }
    console.log('✅ 실행 완료');
    if (res.data.response) console.log('결과:', JSON.stringify(res.data.response, null, 2));
}

main().catch(err => {
    console.error('❌ 실패:', err.message);
    if (err.response && err.response.data) {
        console.error(JSON.stringify(err.response.data, null, 2));
    }
    process.exit(1);
});
