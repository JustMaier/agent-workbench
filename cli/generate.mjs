#!/usr/bin/env node

const args = process.argv.slice(2);
let port = 3000;
let model = '';
let systemPrompt = '';
let apiKey = '';
const positional = [];

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--port':
      port = parseInt(args[i + 1], 10);
      i++;
      break;
    case '--model':
      model = args[i + 1];
      i++;
      break;
    case '--system':
      systemPrompt = args[i + 1];
      i++;
      break;
    case '--api-key':
      apiKey = args[i + 1];
      i++;
      break;
    default:
      positional.push(args[i]);
  }
}

const userMessage = positional.join(' ');
if (!userMessage) {
  console.error('Usage: node cli/generate.mjs "Your message" [--model name] [--system "prompt"] [--api-key key] [--port 3000]');
  process.exit(1);
}

// If no model specified, fetch default from config
if (!model) {
  try {
    const configRes = await fetch(`http://localhost:${port}/api/config`);
    const config = await configRes.json();
    model = config.defaultModel;
  } catch {
    model = 'anthropic/claude-sonnet-4';
  }
}

const headers = { 'Content-Type': 'application/json' };
if (apiKey) headers['x-api-key'] = apiKey;

const body = {
  model,
  messages: [{ role: 'user', content: userMessage }],
};
if (systemPrompt) body.systemPrompt = systemPrompt;

try {
  const res = await fetch(`http://localhost:${port}/api/generate`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Error ${res.status}: ${text}`);
    process.exit(1);
  }

  // Parse SSE stream
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete line in buffer

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = JSON.parse(line.slice(6));

      switch (data.type) {
        case 'text_delta':
          process.stdout.write(data.delta);
          break;
        case 'error':
          console.error(`\nError: ${data.error}`);
          process.exit(1);
          break;
        case 'done':
          process.stdout.write('\n');
          break;
      }
    }
  }
} catch (err) {
  if (err.cause?.code === 'ECONNREFUSED') {
    console.error(`Cannot connect to server at localhost:${port}. Is the server running?`);
  } else {
    console.error(`Error: ${err.message}`);
  }
  process.exit(1);
}
