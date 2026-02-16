#!/usr/bin/env node
// assistant-smoke-test.mjs — Smoke tests for AI Assistant widget

const PORT = process.argv.find(a => a.startsWith('--port='))?.split('=')[1]
  || process.argv[process.argv.indexOf('--port') + 1]
  || '3000';
const BASE = `http://localhost:${PORT}`;

const SYSTEM_PROMPT = `You are an AI assistant that helps create and edit agent configurations for a conversation testing workbench.

When asked to create or edit an agent, output a JSON code block with this schema:
\`\`\`json
{
  "_action": "create" or "edit",
  "name": "Agent Name",
  "model": "provider/model-name",
  "systemPrompt": "The system prompt...",
  "messages": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
\`\`\`

Rules:
- Always wrap agent JSON in a fenced code block with \`\`\`json
- Use "_action": "create" when making a new agent
- Use "_action": "edit" when modifying an existing agent
- When editing, only include fields you want to change
- The "messages" array contains the conversation turns (user and assistant messages)
- Keep responses concise — include a brief explanation, then the JSON block`;

let passed = 0;
let failed = 0;

function extractAgentJson(text) {
  const results = [];
  const regex = /```json\s*\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed.name || parsed.systemPrompt || parsed.messages) results.push(parsed);
    } catch {}
  }
  return results;
}

function test(name, ok, detail) {
  if (ok) {
    console.log(`  PASS  ${name}`);
    passed++;
  } else {
    console.log(`  FAIL  ${name} — ${detail || 'assertion failed'}`);
    failed++;
  }
}

async function collectSSE(payload, timeoutMs = 60000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const chunk = JSON.parse(line.slice(6));
          if (chunk.type === 'text_delta') fullText += chunk.delta;
          else if (chunk.type === 'content') fullText = chunk.content;
          else if (chunk.type === 'error') throw new Error(chunk.error);
        } catch (e) {
          if (e.message && !e.message.includes('JSON')) throw e;
        }
      }
    }

    return fullText;
  } finally {
    clearTimeout(timer);
  }
}

// --- Test 1: JSON extraction (unit tests, no server needed) ---
console.log('\n1. JSON extraction');

test('valid agent JSON',
  extractAgentJson('Here is your agent:\n```json\n{"_action":"create","name":"Test","messages":[]}\n```').length === 1
);

test('parses agent fields',
  (() => {
    const r = extractAgentJson('```json\n{"name":"Bot","systemPrompt":"Hi","messages":[{"role":"user","content":"hello"}]}\n```');
    return r.length === 1 && r[0].name === 'Bot' && r[0].messages.length === 1;
  })()
);

test('invalid JSON returns empty',
  extractAgentJson('```json\n{broken json}\n```').length === 0
);

test('no JSON block returns empty',
  extractAgentJson('Just some regular text without any code blocks').length === 0
);

test('non-agent JSON returns empty',
  extractAgentJson('```json\n{"foo":"bar","baz":123}\n```').length === 0
);

test('multiple blocks returns all valid',
  (() => {
    const text = '```json\n{"name":"A","messages":[]}\n```\nand\n```json\n{"name":"B","messages":[]}\n```';
    return extractAgentJson(text).length === 2;
  })()
);

// --- Test 2: Create agent request (requires server) ---
console.log('\n2. Create agent request');

try {
  const configRes = await fetch(`${BASE}/api/config`);
  const config = await configRes.json();

  const text = await collectSSE({
    model: config.defaultModel,
    systemPrompt: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: 'Create a simple greeting agent named "Greeter" with exactly 2 example conversation turns. The agent should help users say hello in different languages.' }],
  });

  const blocks = extractAgentJson(text);
  test('response contains agent JSON', blocks.length >= 1, `found ${blocks.length} blocks`);

  if (blocks.length > 0) {
    const agent = blocks[0];
    test('has name field', !!agent.name, `name: ${agent.name}`);
    test('has messages array', Array.isArray(agent.messages), `type: ${typeof agent.messages}`);
    test('messages have >= 2 entries', (agent.messages || []).length >= 2, `count: ${(agent.messages || []).length}`);
    test('action is create', agent._action === 'create', `action: ${agent._action}`);
  }
} catch (e) {
  test('create agent request', false, e.message);
}

// --- Test 3: Edit agent request (requires server) ---
console.log('\n3. Edit agent request');

try {
  const configRes = await fetch(`${BASE}/api/config`);
  const config = await configRes.json();

  const currentAgent = {
    name: 'My Agent',
    model: 'anthropic/claude-sonnet-4-5',
    systemPrompt: 'You are a helpful assistant.',
    messages: [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ],
  };

  const editSystemPrompt = SYSTEM_PROMPT + `\n\nCurrent agent (for editing):\n\`\`\`json\n${JSON.stringify(currentAgent, null, 2)}\n\`\`\``;

  const text = await collectSSE({
    model: config.defaultModel,
    systemPrompt: editSystemPrompt,
    messages: [{ role: 'user', content: 'Change the system prompt to: You are a formal British butler who speaks with eloquence.' }],
  });

  const blocks = extractAgentJson(text);
  test('response contains agent JSON', blocks.length >= 1, `found ${blocks.length} blocks`);

  if (blocks.length > 0) {
    const agent = blocks[0];
    test('action is edit', agent._action === 'edit', `action: ${agent._action}`);
    test('has systemPrompt field', !!agent.systemPrompt, `systemPrompt present: ${!!agent.systemPrompt}`);
    test('systemPrompt mentions butler', (agent.systemPrompt || '').toLowerCase().includes('butler'), `got: ${(agent.systemPrompt || '').slice(0, 60)}`);
  }
} catch (e) {
  test('edit agent request', false, e.message);
}

// --- Test 4: Multi-turn ---
console.log('\n4. Multi-turn conversation');

try {
  const configRes = await fetch(`${BASE}/api/config`);
  const config = await configRes.json();

  // First turn
  const text1 = await collectSSE({
    model: config.defaultModel,
    systemPrompt: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: 'Create a math tutor agent named "MathBot" with exactly 1 example conversation turn.' }],
  });

  const blocks1 = extractAgentJson(text1);
  test('first turn has agent JSON', blocks1.length >= 1);

  // Second turn — add 2 more turns
  const text2 = await collectSSE({
    model: config.defaultModel,
    systemPrompt: SYSTEM_PROMPT,
    messages: [
      { role: 'user', content: 'Create a math tutor agent named "MathBot" with exactly 1 example conversation turn.' },
      { role: 'assistant', content: text1 },
      { role: 'user', content: 'Now add 2 more example conversation turns to this agent, for a total of 3 turns. Output the complete agent JSON again.' },
    ],
  });

  const blocks2 = extractAgentJson(text2);
  test('second turn has agent JSON', blocks2.length >= 1);

  if (blocks2.length > 0) {
    test('second turn has >= 3 messages', (blocks2[0].messages || []).length >= 3, `count: ${(blocks2[0].messages || []).length}`);
  }
} catch (e) {
  test('multi-turn', false, e.message);
}

// --- Summary ---
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
