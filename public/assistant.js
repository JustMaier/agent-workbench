// assistant.js — AI Assistant Widget for creating/editing agents via conversation

import { generate } from './api.js';
import { renderMarkdown, escapeHtml } from './render.js';

const STORAGE_KEY = 'agent-workbench-assistant';
const DEFAULT_MODEL = 'anthropic/claude-sonnet-4-5';

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

let config = null;
let callbacks = null;
let messages = [];
let model = DEFAULT_MODEL;
let streaming = false;
let abortController = null;
let parsedJsonBlocks = []; // rebuilt each render

// --- Persistence ---

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      messages = data.messages || [];
      model = data.model || DEFAULT_MODEL;
    }
  } catch { /* ignore corrupt data */ }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ messages, model }));
}

// --- Panel Construction ---

function buildPanel() {
  const panel = document.createElement('div');
  panel.id = 'assistant-panel';
  panel.className = 'assistant-panel';

  panel.innerHTML = `
    <div class="assistant-header">
      <span class="assistant-title">AI Assistant</span>
      <select id="assistant-model-select" class="assistant-model-select"></select>
      <button class="assistant-close-btn" id="assistant-close-btn">&times;</button>
    </div>
    <div class="assistant-messages" id="assistant-messages"></div>
    <div class="assistant-input-bar">
      <textarea id="assistant-input" class="assistant-input" placeholder="Ask me to create or edit an agent..." rows="1"></textarea>
      <button id="assistant-send-btn" class="assistant-send-btn">Send</button>
    </div>
    <button id="assistant-clear-btn" class="assistant-clear-btn">Clear chat</button>
  `;

  document.body.appendChild(panel);

  // Populate model selector
  const select = panel.querySelector('#assistant-model-select');
  for (const m of config.models) {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m.split('/').pop();
    select.appendChild(opt);
  }
  select.value = model;
  select.addEventListener('change', () => {
    model = select.value;
    saveState();
  });

  // Close
  panel.querySelector('#assistant-close-btn').addEventListener('click', toggle);

  // Send / Stop
  panel.querySelector('#assistant-send-btn').addEventListener('click', () => {
    if (streaming) {
      stopStreaming();
      return;
    }
    const input = panel.querySelector('#assistant-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    resizeInput();
    sendMessage(text);
  });

  // Input: auto-resize + Enter to send
  const input = panel.querySelector('#assistant-input');
  input.addEventListener('input', resizeInput);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      panel.querySelector('#assistant-send-btn').click();
    }
  });

  // Clear
  panel.querySelector('#assistant-clear-btn').addEventListener('click', () => {
    messages = [];
    saveState();
    renderMessages();
  });
}

function resizeInput() {
  const input = document.getElementById('assistant-input');
  if (!input) return;
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 120) + 'px';
}

// --- Toggle ---

function toggle() {
  const panel = document.getElementById('assistant-panel');
  const fab = document.getElementById('assistant-fab');
  if (panel.classList.contains('open')) {
    panel.classList.remove('open');
    fab.classList.remove('active');
  } else {
    panel.classList.add('open');
    fab.classList.add('active');
    renderMessages();
    requestAnimationFrame(() => {
      const input = document.getElementById('assistant-input');
      if (input) input.focus();
    });
  }
}

// --- Rendering ---

function renderMessages() {
  const area = document.getElementById('assistant-messages');
  if (!area) return;
  area.innerHTML = '';
  parsedJsonBlocks = [];

  if (messages.length === 0) {
    const welcome = document.createElement('div');
    welcome.className = 'assistant-msg assistant';
    welcome.innerHTML = renderMarkdown('I can help you **create** or **edit** agents. Tell me what you need!');
    area.appendChild(welcome);
    scrollChat();
    return;
  }

  for (const msg of messages) {
    const div = document.createElement('div');
    div.className = `assistant-msg ${msg.role}`;

    if (msg.role === 'assistant') {
      div.innerHTML = renderAssistantContent(msg.content || '');
    } else {
      div.textContent = msg.content;
    }

    area.appendChild(div);
  }

  attachApplyHandlers(area);
  scrollChat();
}

function renderAssistantContent(content) {
  if (!content) return '';

  const jsonBlockRegex = /```json\s*\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let html = '';
  let match;

  while ((match = jsonBlockRegex.exec(content)) !== null) {
    const before = content.slice(lastIndex, match.index);
    if (before.trim()) html += renderMarkdown(before);

    const jsonStr = match[1].trim();
    let isValidAgent = false;
    try {
      const parsed = JSON.parse(jsonStr);
      isValidAgent = !!(parsed.name || parsed.systemPrompt || parsed.messages);
      if (isValidAgent) parsedJsonBlocks.push(parsed);
    } catch { /* not valid JSON */ }

    html += `<div class="assistant-json-block">`;
    html += `<pre><code>${escapeHtml(jsonStr)}</code></pre>`;
    if (isValidAgent) {
      const idx = parsedJsonBlocks.length - 1;
      html += `<div class="assistant-json-actions">`;
      html += `<button class="assistant-apply-btn" data-action="create" data-block="${idx}">Apply as New</button>`;
      html += `<button class="assistant-apply-btn" data-action="edit" data-block="${idx}">Apply to Current</button>`;
      html += `</div>`;
    }
    html += `</div>`;

    lastIndex = match.index + match[0].length;
  }

  const after = content.slice(lastIndex);
  if (after.trim()) html += renderMarkdown(after);

  return html || renderMarkdown(content);
}

function attachApplyHandlers(container) {
  container.querySelectorAll('.assistant-apply-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      const idx = parseInt(btn.dataset.block, 10);
      const data = parsedJsonBlocks[idx];
      if (!data) return;

      // Remove meta field
      const clean = { ...data };
      delete clean._action;

      if (action === 'create') {
        callbacks.createAgent(clean);
        showToast('Created new agent: ' + (clean.name || 'AI Created'));
      } else {
        callbacks.updateCurrentAgent(clean);
        showToast('Updated current agent');
      }
    });
  });
}

function scrollChat() {
  const area = document.getElementById('assistant-messages');
  if (area) area.scrollTop = area.scrollHeight;
}

function showToast(text) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = text;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}

// --- Generation ---

function sendMessage(text) {
  messages.push({ role: 'user', content: text });
  saveState();
  renderMessages();

  // Build system prompt with current agent context
  let sysPrompt = SYSTEM_PROMPT;
  const current = callbacks.getCurrentAgent();
  if (current) {
    sysPrompt += `\n\nCurrent agent (for editing):\n\`\`\`json\n${JSON.stringify({
      name: current.name,
      model: current.model,
      systemPrompt: current.systemPrompt,
      messages: (current.messages || []).map(m => ({ role: m.role, content: m.content })),
    }, null, 2)}\n\`\`\``;
  }

  streaming = true;
  updateSendButton();

  messages.push({ role: 'assistant', content: '' });
  saveState();
  renderMessages();

  const streamIndex = messages.length - 1;
  let fullText = '';
  let doneFired = false;

  // Add streaming cursor to last message
  requestAnimationFrame(() => {
    const msgs = document.querySelectorAll('#assistant-messages .assistant-msg');
    const last = msgs[msgs.length - 1];
    if (last) last.classList.add('streaming');
  });

  abortController = new AbortController();

  // Send all messages except the blank one we just appended
  const apiMessages = messages.slice(0, -1).map(m => ({ role: m.role, content: m.content }));

  generate(
    model,
    sysPrompt,
    apiMessages,
    callbacks.getApiKey(),
    {
      signal: abortController.signal,
      onDelta(delta) {
        fullText += delta;
        messages[streamIndex].content = fullText;

        // Update last message content in-place
        const msgs = document.querySelectorAll('#assistant-messages .assistant-msg');
        const last = msgs[msgs.length - 1];
        if (last) {
          // Rebuild parsedJsonBlocks for this message only
          const savedBlocks = parsedJsonBlocks;
          parsedJsonBlocks = [];
          last.innerHTML = renderAssistantContent(fullText);
          attachApplyHandlers(last);
          // Merge with any previously rendered blocks from other messages
          // (not needed since we re-render fully, but keep parsedJsonBlocks in sync)
        }
        scrollChat();
      },
      onContent(content) {
        if (content) {
          fullText = content;
          messages[streamIndex].content = fullText;
        }
        saveState();
      },
      onError(error) {
        messages[streamIndex].content = `**Error:** ${error}`;
        saveState();
        finishStreaming();
      },
      onDone() {
        if (doneFired) return;
        doneFired = true;
        saveState();
        finishStreaming();
      },
    }
  );
}

function stopStreaming() {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
  finishStreaming();
}

function finishStreaming() {
  streaming = false;
  abortController = null;
  updateSendButton();
  renderMessages();
}

function updateSendButton() {
  const btn = document.getElementById('assistant-send-btn');
  if (!btn) return;
  btn.textContent = streaming ? 'Stop' : 'Send';
  btn.classList.toggle('stop', streaming);
}

// --- JSON Extraction (exported for testing) ---

export function extractAgentJson(text) {
  const results = [];
  const regex = /```json\s*\n([\s\S]*?)```/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed.name || parsed.systemPrompt || parsed.messages) {
        results.push(parsed);
      }
    } catch { /* skip invalid JSON */ }
  }

  return results;
}

// --- Init ---

export function initAssistant(appConfig, appCallbacks) {
  config = appConfig;
  callbacks = appCallbacks;

  loadState();

  // Ensure model is valid
  if (!config.models.includes(model)) {
    model = config.models.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : (config.models[0] || DEFAULT_MODEL);
    saveState();
  }

  buildPanel();

  document.getElementById('assistant-fab').addEventListener('click', toggle);
}
