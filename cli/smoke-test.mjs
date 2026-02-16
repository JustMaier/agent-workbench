#!/usr/bin/env node

const args = process.argv.slice(2);
let port = 3000;
let apiKey = '';

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--port':
      port = parseInt(args[i + 1], 10);
      i++;
      break;
    case '--api-key':
      apiKey = args[i + 1];
      i++;
      break;
  }
}

const BASE = `http://localhost:${port}`;
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// Helper to parse SSE stream and collect events
async function collectSSE(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        events.push(JSON.parse(line.slice(6)));
      } catch { /* skip malformed */ }
    }
  }

  return events;
}

console.log(`\nSmoke tests against ${BASE}\n`);

// --- Test 1: GET /api/config ---

await test('GET /api/config returns valid response', async () => {
  const res = await fetch(`${BASE}/api/config`);
  assert(res.ok, `Expected 200, got ${res.status}`);

  const config = await res.json();
  assert(Array.isArray(config.models), 'models should be an array');
  assert(config.models.length > 0, 'models should not be empty');
  assert(typeof config.defaultModel === 'string', 'defaultModel should be a string');
  assert(typeof config.hasApiKey === 'boolean', 'hasApiKey should be a boolean');
});

// --- Test 2: POST /api/generate streams text ---

const headers = { 'Content-Type': 'application/json' };
if (apiKey) headers['x-api-key'] = apiKey;

await test('POST /api/generate streams text', async () => {
  const res = await fetch(`${BASE}/api/generate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'openai/gpt-4.1-nano',
      messages: [{ role: 'user', content: 'Say hello in exactly one word.' }],
    }),
  });
  assert(res.ok, `Expected 200, got ${res.status}`);

  const events = await collectSSE(res);
  const types = events.map(e => e.type);

  assert(types.includes('text_delta'), 'Should have text_delta events');
  assert(types.includes('content'), 'Should have content event');
  assert(types.includes('done'), 'Should have done event');

  const content = events.find(e => e.type === 'content');
  assert(content.content.length > 0, 'content should not be empty');
});

// --- Test 3: POST /api/generate with system prompt ---

await test('POST /api/generate with system prompt', async () => {
  const res = await fetch(`${BASE}/api/generate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'openai/gpt-4.1-nano',
      systemPrompt: 'You are a pirate. Always say "Arrr!" at the start of your response.',
      messages: [{ role: 'user', content: 'Say hi.' }],
    }),
  });
  assert(res.ok, `Expected 200, got ${res.status}`);

  const events = await collectSSE(res);
  const content = events.find(e => e.type === 'content');
  assert(content, 'Should have content event');
  assert(content.content.length > 0, 'content should not be empty');
});

// --- Test 4: Missing API key returns error ---

await test('Missing API key returns error (when server has no key)', async () => {
  // Fetch config to check if server has a key
  const configRes = await fetch(`${BASE}/api/config`);
  const config = await configRes.json();

  if (config.hasApiKey) {
    // Server has its own key — this test is not applicable, skip with pass
    return;
  }

  // Server has no key and we send no header — should get 401
  const res = await fetch(`${BASE}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'openai/gpt-4.1-nano',
      messages: [{ role: 'user', content: 'Hello' }],
    }),
  });
  assert(res.status === 401, `Expected 401, got ${res.status}`);
  const body = await res.json();
  assert(body.error, 'Should have error message');
});

// --- Results ---

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);

if (failed > 0) process.exit(1);
