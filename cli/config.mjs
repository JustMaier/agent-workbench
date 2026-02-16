#!/usr/bin/env node

const args = process.argv.slice(2);
let port = 3000;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && args[i + 1]) {
    port = parseInt(args[i + 1], 10);
    i++;
  }
}

try {
  const res = await fetch(`http://localhost:${port}/api/config`);
  if (!res.ok) {
    console.error(`Error: ${res.status} ${res.statusText}`);
    process.exit(1);
  }

  const config = await res.json();

  console.log('Agent Workbench Configuration');
  console.log('-----------------------------');
  console.log(`API Key configured: ${config.hasApiKey ? 'Yes' : 'No (client must provide x-api-key)'}`);
  console.log(`Default model: ${config.defaultModel}`);
  console.log(`Available models:`);
  for (const model of config.models) {
    console.log(`  - ${model}`);
  }
} catch (err) {
  if (err.cause?.code === 'ECONNREFUSED') {
    console.error(`Cannot connect to server at localhost:${port}. Is the server running?`);
  } else {
    console.error(`Error: ${err.message}`);
  }
  process.exit(1);
}
