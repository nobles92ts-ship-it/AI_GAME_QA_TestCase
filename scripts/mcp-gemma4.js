#!/usr/bin/env node
// Gemma4 MCP Server — Ollama HTTP API 래퍼
// 모델명 환경변수화 (GEMMA4_MODEL로 외부 설정 가능)
// 기본값: gemma4:26b (MoE A4B, 활성 4B — 31B Dense 대비 4~6배 빠름)
// HTTP 요청 타임아웃 추가 (무한 대기 방지)
const readline = require('readline');
const http = require('http');

const GEMMA4_MODEL = process.env.GEMMA4_MODEL || 'gemma4:26b';
const REQUEST_TIMEOUT_MS = parseInt(process.env.GEMMA4_TIMEOUT_MS || '300000', 10); // 기본 5분

const rl = readline.createInterface({ input: process.stdin });

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

rl.on('line', async (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }

  const { id, method, params } = msg;

  if (method === 'initialize') {
    send({ jsonrpc: '2.0', id, result: {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'gemma4-mcp', version: '1.1.0' }
    }});

  } else if (method === 'notifications/initialized') {
    // no-op

  } else if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools: [{
      name: 'ask_gemma4',
      description: `로컬 Gemma4 LLM에 질문합니다. 무료·빠름·오프라인. 간단한 분석, 코드 검토, 초안 작성에 적합. 현재 모델: ${GEMMA4_MODEL}`,
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: '질문 또는 작업 내용' }
        },
        required: ['prompt']
      }
    }]}});

  } else if (method === 'tools/call') {
    const { name, arguments: args } = params || {};
    if (name === 'ask_gemma4') {
      try {
        const result = await callOllama(args.prompt);
        send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: result }] }});
      } catch (e) {
        send({ jsonrpc: '2.0', id, result: {
          content: [{ type: 'text', text: `Gemma4 오류: ${e.message}\nOllama가 실행 중인지 확인하세요: ollama serve` }],
          isError: true
        }});
      }
    } else {
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown tool: ${name}` }});
    }

  } else {
    if (id !== undefined) {
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' }});
    }
  }
});

function callOllama(prompt) {
  return new Promise((resolve, reject) => {
    // C-2: 통일된 모델명 사용 (GEMMA4_MODEL 상수)
    const body = JSON.stringify({ model: GEMMA4_MODEL, prompt, stream: false });
    const req = http.request({
      hostname: 'localhost',
      port: 11434,
      path: '/api/generate',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.response || data);
        } catch {
          resolve(data);
        }
      });
    });

    // M-5: 타임아웃 설정 (Ollama hanging 방지)
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error(`Ollama 응답 타임아웃 (${REQUEST_TIMEOUT_MS / 1000}초). ollama serve 상태를 확인하세요.`));
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
