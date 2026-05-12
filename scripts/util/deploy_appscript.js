/**
 * deploy_appscript.js
 * Apps Script 코드를 구글 스프레드시트에 자동 배포
 *
 * 사용법:
 *   node deploy_appscript.js <스프레드시트ID>
 *
 * 동작:
 *   1. Apps Script API 인증 (최초 1회 브라우저 인증)
 *   2. 스프레드시트에 바인딩된 스크립트 프로젝트 생성 (또는 기존 재사용)
 *   3. appscript/tab_manager.gs 코드 업로드
 *   4. 설정 함수 실행 안내 출력
 */
const { google } = require('googleapis');
const http = require('http');
const url = require('url');
const exec = require('child_process').exec;
const fs = require('fs');
const path = require('path');

const SPREADSHEET_ID = process.argv[2];
if (!SPREADSHEET_ID) {
    console.error('사용법: node deploy_appscript.js <스프레드시트ID>');
    process.exit(1);
}

const OAUTH_PATH   = process.env.GOOGLE_OAUTH_CLIENT_SECRET_PATH || path.join(__dirname, '../credentials/client_secret.json');
const TOKEN_PATH   = process.env.GOOGLE_OAUTH_TOKEN_PATH || path.join(__dirname, '../credentials/appscript_token.json');
const SCRIPT_ID_PATH = path.join(__dirname, '../credentials/appscript_script_id.json');
const GS_FILE      = path.join(__dirname, '../../appscript/tab_manager.gs');

const SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/script.projects',
    'https://www.googleapis.com/auth/script.scriptapp',
    'https://www.googleapis.com/auth/drive',
];

async function getAuthClient() {
    const credentials = JSON.parse(fs.readFileSync(OAUTH_PATH, 'utf-8'));
    const { client_id, client_secret } = credentials.installed;
    const oauth2Client = new google.auth.OAuth2(client_id, client_secret, 'http://localhost:3005');

    if (fs.existsSync(TOKEN_PATH)) {
        const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
        oauth2Client.setCredentials(token);
        oauth2Client.on('tokens', (tokens) => {
            const saved = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
            if (tokens.refresh_token) saved.refresh_token = tokens.refresh_token;
            saved.access_token = tokens.access_token;
            saved.expiry_date = tokens.expiry_date;
            fs.writeFileSync(TOKEN_PATH, JSON.stringify(saved, null, 2));
        });
        console.log('✔ 저장된 Apps Script 토큰으로 인증 완료');
        return oauth2Client;
    }

    console.log('🔐 Apps Script API 최초 인증 필요. 브라우저가 열립니다...');
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent'
    });

    const code = await new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            const query = url.parse(req.url, true).query;
            if (query.code) {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end('<h1>✅ 인증 완료!</h1><p>이 창을 닫으셔도 됩니다.</p>');
                server.close();
                resolve(query.code);
            }
        }).listen(3005, () => {
            exec(`cmd /c start "" "${authUrl}"`);
            console.log('브라우저에서 Google 계정을 선택하고 권한을 허용해주세요.');
        });
        setTimeout(() => { server.close(); reject(new Error('인증 타임아웃')); }, 300000);
    });

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
    console.log('✔ Apps Script 토큰 저장 완료');
    return oauth2Client;
}

async function getOrCreateScriptId(auth) {
    if (fs.existsSync(SCRIPT_ID_PATH)) {
        const saved = JSON.parse(fs.readFileSync(SCRIPT_ID_PATH, 'utf-8'));
        if (saved[SPREADSHEET_ID]) {
            console.log(`✔ 기존 스크립트 프로젝트 재사용: ${saved[SPREADSHEET_ID]}`);
            return saved[SPREADSHEET_ID];
        }
    }

    const response = await auth.request({
        method: 'POST',
        url: 'https://script.googleapis.com/v1/projects',
        data: {
            title: 'TC Tab Manager',
            parentId: SPREADSHEET_ID
        }
    });

    const scriptId = response.data.scriptId;
    console.log(`✔ 새 Apps Script 프로젝트 생성: ${scriptId}`);

    const saved = fs.existsSync(SCRIPT_ID_PATH)
        ? JSON.parse(fs.readFileSync(SCRIPT_ID_PATH, 'utf-8'))
        : {};
    saved[SPREADSHEET_ID] = scriptId;
    fs.writeFileSync(SCRIPT_ID_PATH, JSON.stringify(saved, null, 2));

    return scriptId;
}

async function uploadCode(auth, scriptId) {
    const source = fs.readFileSync(GS_FILE, 'utf-8');

    await auth.request({
        method: 'PUT',
        url: `https://script.googleapis.com/v1/projects/${scriptId}/content`,
        data: {
            files: [
                {
                    name: 'tab_manager',
                    type: 'SERVER_JS',
                    source
                },
                {
                    name: 'appsscript',
                    type: 'JSON',
                    source: JSON.stringify({
                        timeZone: 'Asia/Seoul',
                        dependencies: {},
                        exceptionLogging: 'STACKDRIVER',
                        runtimeVersion: 'V8',
                        oauthScopes: [
                            'https://www.googleapis.com/auth/spreadsheets',
                            'https://www.googleapis.com/auth/script.scriptapp'
                        ]
                    }, null, 2)
                }
            ]
        }
    });

    console.log('✔ tab_manager.gs 코드 업로드 완료');
}

async function main() {
    const auth = await getAuthClient();
    const scriptId = await getOrCreateScriptId(auth);
    await uploadCode(auth, scriptId);

    const editorUrl = `https://script.google.com/d/${scriptId}/edit`;
    console.log('\n═══════════════════════════════════════════════');
    console.log('✅ 배포 완료!');
    console.log(`\n📝 Apps Script 편집기: ${editorUrl}`);
    console.log('\n⚠️  마지막으로 아래 2개 함수를 Apps Script에서 1회 실행해주세요:');
    console.log('   1. setupDailyTrigger()  ← 매일 09:00 자동 실행 트리거 등록');
    console.log('   2. setupM3Button()      ← 대시보드 M3 체크박스 삽입');
    console.log('\n방법: 편집기 열기 → 함수 드롭다운 선택 → ▶ 실행');
    console.log('═══════════════════════════════════════════════\n');
}

main().catch(err => {
    console.error('❌ 배포 실패:', err.message);
    process.exit(1);
});
