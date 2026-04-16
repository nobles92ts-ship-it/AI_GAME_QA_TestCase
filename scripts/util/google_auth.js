/**
 * Google OAuth 2.0 인증 및 토큰 저장
 * 최초 1회만 브라우저 인증 필요, 이후에는 저장된 토큰으로 자동 인증
 */
const { google } = require('googleapis');
const http = require('http');
const url = require('url');
const open = require('child_process').exec;
const fs = require('fs');

const OAUTH_PATH = process.env.GOOGLE_OAUTH_CLIENT_SECRET_PATH || './credentials/client_secret.json';
const TOKEN_PATH = process.env.GOOGLE_OAUTH_TOKEN_PATH || './credentials/oauth_token.json';
const SCOPES = ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets'];

async function getAuthClient() {
    const credentials = JSON.parse(fs.readFileSync(OAUTH_PATH, 'utf-8'));
    const { client_id, client_secret, redirect_uris } = credentials.installed;

    const oauth2Client = new google.auth.OAuth2(client_id, client_secret, 'http://localhost:3000/callback');

    // 이미 저장된 토큰이 있으면 재사용
    if (fs.existsSync(TOKEN_PATH)) {
        const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
        oauth2Client.setCredentials(token);

        // 토큰 자동 갱신 핸들러
        oauth2Client.on('tokens', (tokens) => {
            const saved = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
            if (tokens.refresh_token) saved.refresh_token = tokens.refresh_token;
            saved.access_token = tokens.access_token;
            saved.expiry_date = tokens.expiry_date;
            fs.writeFileSync(TOKEN_PATH, JSON.stringify(saved, null, 2));
            console.log('  [토큰 자동 갱신 완료]');
        });

        console.log('✔ 저장된 OAuth 토큰으로 인증 완료');
        return oauth2Client;
    }

    // 최초 인증: 브라우저에서 구글 로그인
    console.log('🔐 최초 인증이 필요합니다. 브라우저가 열립니다...');

    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent'
    });

    // 로컬 서버로 콜백 수신
    const code = await new Promise((resolve, reject) => {
        const server = http.createServer(async (req, res) => {
            const query = url.parse(req.url, true).query;
            if (query.code) {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end('<h1>✅ 인증 완료!</h1><p>이 창을 닫으셔도 됩니다.</p><script>window.close()</script>');
                server.close();
                resolve(query.code);
            }
        }).listen(3000, () => {
            console.log(`\n👉 아래 URL을 브라우저에서 열어 구글 로그인 해주세요:\n`);
            console.log(authUrl);
            console.log('\n(자동으로 브라우저를 엽니다...)\n');
            // Windows에서 자동으로 브라우저 열기
            open(`start "" "${authUrl}"`);
        });

        // 3분 타임아웃
        setTimeout(() => { server.close(); reject(new Error('인증 타임아웃 (3분)')); }, 180000);
    });

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // 토큰 저장 (다음부터 자동 인증)
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
    console.log('✔ OAuth 토큰 저장 완료 (다음부터 자동 인증)');

    return oauth2Client;
}

module.exports = { getAuthClient };

// 직접 실행 시 인증 테스트
if (require.main === module) {
    getAuthClient()
        .then(auth => {
            console.log('\n🎉 구글 API 인증 성공! 이제 스프레드시트를 자동 생성할 수 있습니다.');
        })
        .catch(err => console.error('인증 실패:', err.message));
}
