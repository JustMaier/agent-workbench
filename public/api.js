// api.js — API communication module

export async function fetchConfig() {
  const res = await fetch('/api/config');
  return res.json();
}

export function generate(model, systemPrompt, messages, apiKey, { onDelta, onContent, onError, onDone, signal }) {
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
      return readSSE(res.body, { onDelta, onContent, onError, onDone });
    })
    .catch(err => {
      if (err.name === 'AbortError') return;
      onError?.(err.message);
    });
}

async function readSSE(body, { onDelta, onContent, onError, onDone }) {
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
