import 'dotenv/config';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PORT = process.env.PORT ?? 3000;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const DEFAULT_MODEL = 'anthropic/claude-sonnet-4';

const MODELS = [
  'anthropic/claude-sonnet-4',
  'openai/gpt-4.1-mini',
  'openai/gpt-4.1-nano',
  'google/gemini-2.5-flash',
  'x-ai/grok-3-mini',
  'meta-llama/llama-4-scout',
  'deepseek/deepseek-chat-v3-0324:free',
];

// --- MIME types ---

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

// --- Static file serving ---

async function serveStatic(req, res) {
  const url = req.url.split('?')[0]; // strip query string
  const path = url === '/' ? '/index.html' : url;
  const publicDir = resolve(join(__dirname, 'public'));
  const filePath = resolve(join(publicDir, path));

  // Prevent path traversal
  if (!filePath.startsWith(publicDir + sep) && filePath !== publicDir) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('Not a file');

    const content = await readFile(filePath);
    const ext = extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

// --- SSE helper ---

function sse(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// --- CORS headers ---

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
}

// --- Generate endpoint (Chat Completions API, streaming) ---

async function handleGenerate(req, res) {
  let body = '';
  for await (const chunk of req) body += chunk;

  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON' }));
    return;
  }

  const { model, systemPrompt, messages } = payload;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'messages array is required' }));
    return;
  }

  // Resolve API key: env first, then x-api-key header
  const apiKey = OPENROUTER_API_KEY || req.headers['x-api-key'];
  if (!apiKey) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'No API key. Set OPENROUTER_API_KEY in .env or pass x-api-key header.' }));
    return;
  }

  // SSE response
  setCors(res);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.socket?.setNoDelay?.(true);

  // Track abort
  let aborted = false;
  const abortController = new AbortController();
  req.on('close', () => {
    aborted = true;
    abortController.abort();
  });

  try {
    // Build Chat Completions messages (prepend system prompt)
    const chatMessages = [];
    if (systemPrompt) {
      chatMessages.push({ role: 'system', content: systemPrompt });
    }
    chatMessages.push(...messages);

    // Stream via OpenRouter Chat Completions API
    const apiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        messages: chatMessages,
        stream: true,
      }),
      signal: abortController.signal,
    });

    if (!apiRes.ok) {
      const errBody = await apiRes.text();
      let errMsg;
      try { errMsg = JSON.parse(errBody).error?.message || errBody; } catch { errMsg = errBody; }
      sse(res, { type: 'error', error: `OpenRouter API error ${apiRes.status}: ${errMsg}` });
      res.end();
      return;
    }

    // Parse SSE stream from OpenRouter
    const reader = apiRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (aborted) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        let chunk;
        try { chunk = JSON.parse(data); } catch { continue; }

        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          fullText += delta;
          sse(res, { type: 'text_delta', delta });
        }
      }
    }

    if (!aborted) {
      sse(res, { type: 'content', content: fullText });
      sse(res, { type: 'done' });
    }
  } catch (err) {
    if (!aborted) {
      sse(res, { type: 'error', error: err.message });
    }
  }

  res.end();
}

// --- Server ---

const server = createServer(async (req, res) => {
  setCors(res);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/api/config') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      defaultModel: DEFAULT_MODEL,
      models: MODELS,
      hasApiKey: !!OPENROUTER_API_KEY,
    }));
    return;
  }

  if (req.method === 'POST' && req.url === '/api/generate') {
    await handleGenerate(req, res);
    return;
  }

  if (req.method === 'GET') {
    await serveStatic(req, res);
    return;
  }

  res.writeHead(405);
  res.end('Method not allowed');
});

server.listen(PORT, () => {
  console.log(`Agent Workbench running at http://localhost:${PORT}`);
});
