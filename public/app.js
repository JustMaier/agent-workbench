// app.js — Main entry point: wires state + api + render together

import * as state from './state.js';
import { fetchConfig, generate } from './api.js';
import { renderAgentBar, renderMessages, renderMarkdown, escapeHtml, autoResize } from './render.js';

let config = { defaultModel: 'anthropic/claude-sonnet-4', models: [], hasApiKey: true };
let abortController = null;
let streaming = false;
let apiKey = '';
let doneFired = false;

// --- Init ---

async function init() {
  state.init();

  try {
    config = await fetchConfig();
  } catch { /* use defaults */ }

  setupModelSelector();
  setupApiKeyField();
  setupEventListeners();
  render();
}

// --- Model selector ---

function setupModelSelector() {
  const select = document.getElementById('model-select');
  const customInput = document.getElementById('custom-model');

  select.innerHTML = '';
  for (const m of config.models) {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    select.appendChild(opt);
  }
  const otherOpt = document.createElement('option');
  otherOpt.value = '__custom__';
  otherOpt.textContent = 'Other...';
  select.appendChild(otherOpt);

  // Set current model
  const agent = state.getCurrentAgent();
  const modelVal = agent.model || config.defaultModel;
  if (config.models.includes(modelVal)) {
    select.value = modelVal;
  } else if (modelVal) {
    select.value = '__custom__';
    customInput.value = modelVal;
    customInput.style.display = '';
  }

  select.addEventListener('change', () => {
    if (select.value === '__custom__') {
      customInput.style.display = '';
      customInput.focus();
    } else {
      customInput.style.display = 'none';
      state.updateCurrentAgent({ model: select.value });
    }
  });

  customInput.addEventListener('input', () => {
    state.updateCurrentAgent({ model: customInput.value.trim() });
  });
}

function getModel() {
  const select = document.getElementById('model-select');
  const customInput = document.getElementById('custom-model');
  if (select.value === '__custom__') return customInput.value.trim();
  return select.value;
}

// --- API key ---

function setupApiKeyField() {
  const wrap = document.getElementById('apikey-wrap');
  const input = document.getElementById('apikey-input');

  if (config.hasApiKey) {
    wrap.style.display = 'none';
  } else {
    wrap.style.display = '';
  }

  input.addEventListener('input', () => {
    apiKey = input.value.trim();
  });
}

// --- Export ---

function setupExportDropdown() {
  const btn = document.getElementById('export-btn');
  const menu = document.getElementById('export-menu');

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('show');
  });

  document.addEventListener('click', () => menu.classList.remove('show'));

  document.getElementById('export-openai').addEventListener('click', () => {
    const agent = state.getCurrentAgent();
    const data = formatOpenAI(agent);
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    showToast('Copied OpenAI JSON');
    menu.classList.remove('show');
  });

  document.getElementById('export-openrouter').addEventListener('click', () => {
    const agent = state.getCurrentAgent();
    const data = formatOpenRouter(agent);
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    showToast('Copied OpenRouter JSON');
    menu.classList.remove('show');
  });

  document.getElementById('export-download').addEventListener('click', () => {
    const agent = state.getCurrentAgent();
    const data = formatOpenRouter(agent);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${agent.name.replace(/[^a-z0-9]/gi, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    menu.classList.remove('show');
  });
}

function formatOpenAI(agent) {
  const out = {};
  if (agent.model) out.model = agent.model;
  if (agent.systemPrompt) {
    out.messages = [{ role: 'system', content: agent.systemPrompt }];
  } else {
    out.messages = [];
  }
  for (const msg of agent.messages) {
    out.messages.push({ role: msg.role, content: msg.content });
  }
  return out;
}

function formatOpenRouter(agent) {
  const out = {};
  if (agent.model) out.model = agent.model;
  if (agent.systemPrompt) {
    out.messages = [{ role: 'system', content: agent.systemPrompt }];
  } else {
    out.messages = [];
  }
  for (const msg of agent.messages) {
    if (msg.images && msg.images.length > 0) {
      const content = [{ type: 'text', text: msg.content || '' }];
      for (const img of msg.images) {
        content.push({ type: 'image_url', image_url: { url: img } });
      }
      out.messages.push({ role: msg.role, content });
    } else {
      out.messages.push({ role: msg.role, content: msg.content });
    }
  }
  return out;
}

function showToast(text) {
  const toast = document.getElementById('toast');
  toast.textContent = text;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}

// --- Event listeners ---

function setupEventListeners() {
  // System prompt
  const sysPrompt = document.getElementById('system-prompt');
  const agent = state.getCurrentAgent();
  sysPrompt.value = agent.systemPrompt || '';
  autoResize(sysPrompt);

  sysPrompt.addEventListener('input', () => {
    autoResize(sysPrompt);
    state.updateCurrentAgent({ systemPrompt: sysPrompt.value });
  });

  // Bottom bar buttons
  document.getElementById('add-user-btn').addEventListener('click', () => {
    const agent = state.getCurrentAgent();
    agent.messages.push({ role: 'user', content: '', images: [] });
    state.updateCurrentAgent({ messages: agent.messages });
    render();
    focusLastTextarea();
  });

  document.getElementById('add-assistant-btn').addEventListener('click', () => {
    const agent = state.getCurrentAgent();
    agent.messages.push({ role: 'assistant', content: '', images: [] });
    state.updateCurrentAgent({ messages: agent.messages });
    render();
  });

  document.getElementById('generate-btn').addEventListener('click', () => {
    if (streaming) {
      stopGeneration();
    } else {
      startGeneration();
    }
  });

  setupExportDropdown();
}

function focusLastTextarea() {
  requestAnimationFrame(() => {
    const textareas = document.querySelectorAll('#messages .message-content-edit');
    if (textareas.length > 0) {
      const last = textareas[textareas.length - 1];
      last.focus();
      last.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  });
}

// --- Generation ---

function startGeneration() {
  const agent = state.getCurrentAgent();
  if (agent.messages.length === 0) return;

  // Build messages for API (include images as content array if present)
  const apiMessages = agent.messages.map(msg => {
    if (msg.images && msg.images.length > 0) {
      const content = [{ type: 'text', text: msg.content || '' }];
      for (const img of msg.images) {
        content.push({ type: 'image_url', image_url: { url: img } });
      }
      return { role: msg.role, content };
    }
    return { role: msg.role, content: msg.content };
  });

  streaming = true;
  doneFired = false;
  updateGenerateButton();

  // Append blank assistant message for streaming
  agent.messages.push({ role: 'assistant', content: '', images: [] });
  state.updateCurrentAgent({ messages: agent.messages });
  render();

  const streamIndex = agent.messages.length - 1;
  let fullText = '';

  // Add streaming cursor to the last message block
  requestAnimationFrame(() => {
    const blocks = document.querySelectorAll('.message-block');
    const lastBlock = blocks[blocks.length - 1];
    if (lastBlock) lastBlock.classList.add('streaming');
  });

  abortController = new AbortController();

  generate(
    getModel() || config.defaultModel,
    agent.systemPrompt,
    apiMessages,
    apiKey,
    {
      signal: abortController.signal,
      onDelta(delta) {
        fullText += delta;
        agent.messages[streamIndex].content = fullText;
        // Update just the content display without full re-render
        const blocks = document.querySelectorAll('.message-block');
        const block = blocks[streamIndex];
        if (block) {
          const display = block.querySelector('.message-content-display');
          if (display) {
            display.innerHTML = renderMarkdown(fullText);
          }
        }
        scrollToBottom();
      },
      onContent(content) {
        if (content) {
          fullText = content;
          agent.messages[streamIndex].content = fullText;
        }
        state.updateCurrentAgent({ messages: agent.messages });
      },
      onError(error) {
        agent.messages[streamIndex].content = `**Error:** ${error}`;
        state.updateCurrentAgent({ messages: agent.messages });
        finishStreaming();
      },
      onDone() {
        if (doneFired) return;
        doneFired = true;
        state.updateCurrentAgent({ messages: agent.messages });
        finishStreaming();
      },
    }
  );
}

function stopGeneration() {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
  finishStreaming();
}

function finishStreaming() {
  streaming = false;
  updateGenerateButton();
  render();
}

function updateGenerateButton() {
  const btn = document.getElementById('generate-btn');
  if (streaming) {
    btn.textContent = 'Stop';
    btn.classList.add('stop');
  } else {
    btn.textContent = 'Generate';
    btn.classList.remove('stop');
  }
}

function scrollToBottom() {
  const area = document.getElementById('messages');
  area.scrollTop = area.scrollHeight;
}

// --- Render ---

function render() {
  const agent = state.getCurrentAgent();

  // Agent bar
  renderAgentBar(state.getAgents(), state.getCurrentId(), {
    onSelect(id) {
      state.setCurrentAgent(id);
      syncUIToAgent();
      render();
    },
    onCreate() {
      state.createAgent();
      syncUIToAgent();
      render();
    },
    onDelete(id) {
      if (state.getAgents().length <= 1) return;
      state.deleteAgent(id);
      syncUIToAgent();
      render();
    },
    onDuplicate(id) {
      state.duplicateAgent(id);
      syncUIToAgent();
      render();
    },
    onRename(id, name) {
      state.renameAgent(id, name);
      render();
    },
  });

  // Messages
  renderMessages(agent.messages, {
    onInsert(index) {
      agent.messages.splice(index, 0, { role: 'user', content: '', images: [] });
      state.updateCurrentAgent({ messages: agent.messages });
      render();
      // Focus the inserted textarea
      requestAnimationFrame(() => {
        const blocks = document.querySelectorAll('.message-block');
        const block = blocks[index];
        if (block) {
          const ta = block.querySelector('.message-content-edit');
          if (ta) ta.focus();
        }
      });
    },
    onDelete(index) {
      agent.messages.splice(index, 1);
      state.updateCurrentAgent({ messages: agent.messages });
      render();
    },
    onEditContent(index, content) {
      agent.messages[index].content = content;
      state.updateCurrentAgent({ messages: agent.messages });
    },
    onToggleRole(index) {
      agent.messages[index].role = agent.messages[index].role === 'user' ? 'assistant' : 'user';
      state.updateCurrentAgent({ messages: agent.messages });
      render();
    },
    onAddImage(index, file) {
      const reader = new FileReader();
      reader.onload = () => {
        if (!agent.messages[index].images) agent.messages[index].images = [];
        agent.messages[index].images.push(reader.result);
        state.updateCurrentAgent({ messages: agent.messages });
        render();
      };
      reader.readAsDataURL(file);
    },
    onRemoveImage(msgIndex, imgIndex) {
      agent.messages[msgIndex].images.splice(imgIndex, 1);
      state.updateCurrentAgent({ messages: agent.messages });
      render();
    },
  });
}

function syncUIToAgent() {
  const agent = state.getCurrentAgent();

  // Update system prompt
  const sysPrompt = document.getElementById('system-prompt');
  sysPrompt.value = agent.systemPrompt || '';
  autoResize(sysPrompt);

  // Update model selector
  const select = document.getElementById('model-select');
  const customInput = document.getElementById('custom-model');
  const modelVal = agent.model || config.defaultModel;

  if (config.models.includes(modelVal)) {
    select.value = modelVal;
    customInput.style.display = 'none';
  } else if (modelVal) {
    select.value = '__custom__';
    customInput.value = modelVal;
    customInput.style.display = '';
  } else {
    select.value = config.defaultModel;
    customInput.style.display = 'none';
  }
}

// --- Start ---

init();
