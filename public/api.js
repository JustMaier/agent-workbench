// api.js — API communication module

// Fallback config when no server is available (static / GitHub Pages deployment)
export const FALLBACK_CONFIG = {
  defaultModel: 'anthropic/claude-sonnet-4-5',
  models: [
    'anthropic/claude-opus-4-6',
    'anthropic/claude-sonnet-4-5',
    'openai/gpt-5.3',
    'openai/gpt-5.2',
    'openai/gpt-5-nano',
    'x-ai/grok-4.1-fast',
    'stepfun/step-3.5-flash:free',
    'openai/gpt-oss-120b:free',
    'openai/gpt-oss-20b:free',
    'arcee-ai/trinity-large-preview:free',
    'z-ai/glm-4.7-flash',
    'xiaomi/mimo-v2-flash',
    'nvidia/nemotron-3-nano-30b-a3b',
  ],
  hasApiKey: false,
};

export async function fetchConfig() {
  const res = await fetch('/api/config');
  return res.json();
}

export function generate(model, systemPrompt, messages, apiKey, { onDelta, onContent, onError, onDone, onUsage, signal, direct }) {
  if (direct) {
    generateDirect(model, systemPrompt, messages, apiKey, { onDelta, onContent, onError, onDone, onUsage, signal });
    return;
  }

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['x-api-key'] = apiKey;

  fetch('/api/generate', {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, systemPrompt, messages }),
    signal,
  })
    .then(res => {
      if (!res.ok) {
        return res.json().then(j => { onError?.(j.error || `HTTP ${res.status}`); });
      }
      return readSSE(res.body, { onDelta, onContent, onError, onDone, onUsage });
    })
    .catch(err => {
      if (err.name === 'AbortError') return;
      onError?.(err.message);
    });
}

export async function fetchGenerationStats(generationId, apiKey) {
  try {
    const res = await fetch(`https://openrouter.ai/api/v1/generation?id=${generationId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.data;
  } catch {
    return null;
  }
}

// --- Direct-to-OpenRouter (browser → OpenRouter, no server proxy) ---

function generateDirect(model, systemPrompt, messages, apiKey, { onDelta, onContent, onError, onDone, onUsage, signal }) {
  if (!apiKey) {
    onError?.('No API key. Enter your OpenRouter API key above.');
    return;
  }

  const chatMessages = [];
  if (systemPrompt) chatMessages.push({ role: 'system', content: systemPrompt });
  chatMessages.push(...messages);

  fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': location.href,
      'X-Title': 'Agent Workbench',
    },
    body: JSON.stringify({
      model: model || FALLBACK_CONFIG.defaultModel,
      messages: chatMessages,
      stream: true,
      stream_options: { include_usage: true },
    }),
    signal,
  })
    .then(res => {
      if (!res.ok) {
        return res.text().then(body => {
          let msg;
          try { msg = JSON.parse(body).error?.message || body; } catch { msg = body; }
          onError?.(`OpenRouter API error ${res.status}: ${msg}`);
        });
      }
      return readOpenRouterSSE(res.body, { onDelta, onContent, onError, onDone, onUsage });
    })
    .catch(err => {
      if (err.name === 'AbortError') return;
      onError?.(err.message);
    });
}

// Parse OpenRouter's native SSE format (Chat Completions streaming)
async function readOpenRouterSSE(body, { onDelta, onContent, onError, onDone, onUsage }) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let generationId = '';
  let usage = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;

      let chunk;
      try { chunk = JSON.parse(data); } catch { continue; }

      // Check for error responses in the stream
      if (chunk.error) {
        onError?.(chunk.error.message || JSON.stringify(chunk.error));
        return;
      }

      if (chunk.id) generationId = chunk.id;
      if (chunk.usage) usage = chunk.usage;

      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        fullText += delta;
        onDelta?.(delta);
      }
    }
  }

  onContent?.(fullText);
  onUsage?.({ generationId, usage });
  onDone?.();
}

// --- Server-proxied SSE format (our custom format) ---

async function readSSE(body, { onDelta, onContent, onError, onDone, onUsage }) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      let chunk;
      try { chunk = JSON.parse(line.slice(6)); } catch { continue; }

      switch (chunk.type) {
        case 'text_delta':
          onDelta?.(chunk.delta);
          break;
        case 'content':
          onContent?.(chunk.content);
          break;
        case 'usage':
          onUsage?.(chunk);
          break;
        case 'error':
          onError?.(chunk.error);
          break;
        case 'done':
          onDone?.();
          break;
      }
    }
  }

  // If stream ends without explicit done event
  onDone?.();
}
