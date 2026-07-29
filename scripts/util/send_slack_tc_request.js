/**
 * send_slack_tc_request.js
 * TC 팀 v2 파이프라인 착수 시 설정된 QA 채널에 "TC 생성 요청" 공지를 전송한다.
 *
 * 사용법:
 *   # 단일 기능
 *   node send_slack_tc_request.js --feature "월드맵" --confluence "https://..." --sheet "https://docs.google.com/..."
 *   # 통합 리스트 (배치) — items.json: [{"feature":"월드맵","confluence":"https://..."}, ...]
 *   node send_slack_tc_request.js --items items.json --sheet "https://docs.google.com/..."
 *   # 중복 방지(재개 안전): 요청 내용 해시 마커. 같은 요청 재실행 시 스킵.
 *   node send_slack_tc_request.js --items items.json --sheet "..." --dedup-dir "{PROJECT_ROOT}/team/specs"
 *
 * 토큰: slack_config.json("token") 또는 환경변수 SLACK_BOT_TOKEN (send_slack_qa.js와 동일)
 * 채널: --channel > 환경변수 SLACK_CHANNEL_ID > slack_config.json("channel") > 기본값 없음(미지정 시 전송 스킵)
 * 미설정 시(토큰 없음/채널 플레이스홀더) 설정 안내 출력 후 종료 — 파이프라인은 비차단으로 계속
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const DEFAULT_CHANNEL = process.env.SLACK_CHANNEL_ID || '';  // 배포본: 회사 채널 ID 미포함 — env 또는 slack_config.json 로 지정
const CONFIG_FILE = path.join(__dirname, 'slack_config.json');

// ── CLI 파라미터 파싱 ──
function parseArgs() {
  const args = process.argv.slice(2);
  const get = (name) => {
    const i = args.indexOf(`--${name}`);
    return i !== -1 && args[i + 1] ? args[i + 1] : null;
  };
  return {
    feature: get('feature'),
    confluence: get('confluence'),
    items: get('items'),       // JSON 파일 경로 (통합 리스트 모드)
    sheet: get('sheet'),
    batch: get('batch'),       // "2/5" 형식 (선택, 단일 모드)
    dedupDir: get('dedup-dir'), // 중복 방지 마커 디렉터리 (선택)
    channel: get('channel') || process.env.SLACK_CHANNEL_ID || loadConfig().channel || DEFAULT_CHANNEL,
  };
}

// ── 중복 방지: 요청 내용(기능+링크+시트) 해시 기반 마커 ──
// 같은 요청 재실행(재개 포함) → 마커 존재 → 스킵 / 다른 요청 → 다른 해시 → 전송
function dedupMarkerPath(dir, items, sheet) {
  const key = JSON.stringify({
    items: items.map(it => `${it.feature}|${it.confluence}`).sort(),
    sheet: sheet || '',
  });
  const hash = crypto.createHash('sha1').update(key).digest('hex').slice(0, 16);
  return path.join(dir, `.tc_kickoff_${hash}.sent`);
}

// ── 요청 항목 로드: --items(리스트) 우선, 없으면 --feature(단일) ──
function loadItems(cfg) {
  if (cfg.items) {
    const p = path.resolve(__dirname, cfg.items);
    if (!fs.existsSync(p)) {
      console.error(`items 파일을 찾을 수 없습니다: ${p}`);
      process.exit(1);
    }
    const arr = JSON.parse(fs.readFileSync(p, 'utf-8'));
    if (!Array.isArray(arr) || arr.length === 0) {
      console.error('items 파일은 비어있지 않은 배열이어야 합니다.');
      process.exit(1);
    }
    return arr.map(x => ({ feature: x.feature, confluence: x.confluence }));
  }
  if (cfg.feature) {
    return [{ feature: cfg.feature, confluence: cfg.confluence }];
  }
  return [];
}

// ── slack_config.json 로드 (없거나 파싱 실패 시 빈 객체) ──
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')); } catch { return {}; }
}

// ── Slack 토큰 로드 (send_slack_qa.js와 동일 규칙) ──
function getToken() {
  if (process.env.SLACK_BOT_TOKEN) return process.env.SLACK_BOT_TOKEN;
  return loadConfig().token || null;
}

// ── Slack API 전송 ──
function postSlack(token, channel, blocks, text) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ channel, blocks, text });
    const opts = {
      hostname: 'slack.com',
      path: '/api/chat.postMessage',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': `Bearer ${token}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        let r;
        try { r = JSON.parse(data); } catch { return reject(new Error(`Slack 응답 파싱 실패: ${data.slice(0, 200)}`)); }
        if (r.ok) resolve(r);
        else reject(new Error(`Slack API 오류: ${r.error}`));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── 메시지 빌드 (items 1건이면 단일, N건이면 통합 리스트) ──
function buildMessage(items, { sheet, batch }) {
  const today = new Date().toISOString().slice(0, 10);
  const dayName = ['일', '월', '화', '수', '목', '금', '토'][new Date().getDay()];
  const count = items.length;
  const batchTag = batch ? `  _(배치 ${batch})_` : (count > 1 ? `  _(${count}건)_` : '');

  // 요청 항목 라인: 기능명 + Confluence 링크
  const lines = items.map((it, i) => {
    const name = (it.feature || '(미상)').replace(/_/g, ' ');
    const idx = count > 1 ? `${i + 1}. ` : '';
    return it.confluence
      ? `📄 ${idx}*${name}* — <${it.confluence}|기획서(Confluence) 열기>`
      : `📄 ${idx}*${name}*`;
  }).join('\n');

  const intro = count > 1
    ? `아래 *${count}건*의 TC 작성을 시작합니다.`
    : `아래 기능의 TC 작성을 시작합니다.`;

  const blocks = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*🆕 TC 생성 요청 접수 — ${today} (${dayName})*${batchTag}` },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `${intro}\n\n${lines}` },
    },
  ];

  if (sheet) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `📊 <${sheet}|대상 TC 시트 열기>` },
    });
  }

  blocks.push({
    type: 'context',
    elements: [
      { type: 'mrkdwn', text: `_TC 팀 v2 파이프라인 착수 • ${new Date().toLocaleTimeString('ko-KR')}_` },
    ],
  });

  const namesForText = items.map(it => (it.feature || '(미상)').replace(/_/g, ' ')).join(', ');
  return {
    blocks,
    text: `TC 생성 요청 접수 (${count}건): ${namesForText}`,
  };
}

// ── 실행 ──
async function main() {
  const cfg = parseArgs();
  const items = loadItems(cfg);
  if (items.length === 0) {
    console.error('필수 인자 누락: --items <jsonfile> 또는 --feature');
    process.exit(1);
  }

  // 중복 방지: 동일 요청이 이미 전송됐으면 스킵
  let marker = null;
  if (cfg.dedupDir) {
    marker = dedupMarkerPath(cfg.dedupDir, items, cfg.sheet);
    if (fs.existsSync(marker)) {
      console.log(`[slack] 동일 요청 이미 전송됨 — 스킵 (${path.basename(marker)})`);
      return;
    }
  }

  const token = getToken();
  if (!token || cfg.channel.startsWith('YOUR_')) {
    console.error('Slack 착수 공지 미설정 — 켜려면 scripts/util/slack_config.json 생성 (slack_config.json.example 참고):');
    console.error('  {"token": "xoxb-...", "channel": "C0XXXXXXXXX"}');
    console.error('  (또는 환경변수 SLACK_BOT_TOKEN + SLACK_CHANNEL_ID)');
    process.exit(1);
  }

  const { blocks, text } = buildMessage(items, cfg);
  await postSlack(token, cfg.channel, blocks, text);
  if (marker) {
    try { fs.writeFileSync(marker, new Date().toISOString()); } catch { /* 마커 실패는 무시 */ }
  }
  const names = items.map(it => it.feature).join(', ');
  console.log(`[slack] TC 생성 요청 공지 전송 완료 (${items.length}건): ${names}`);
}

main().catch(e => {
  console.error('Slack 전송 오류:', e.message);
  process.exit(1);
});
