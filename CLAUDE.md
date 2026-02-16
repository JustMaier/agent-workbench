# Agent Workbench

Multi-turn conversation editor for testing agents/prompts via OpenRouter.

## Stack

- **Server**: `server.mjs` — Node HTTP server, static files + API endpoints
- **Frontend**: ES modules in `public/` — no build step, no framework
- **API**: Direct fetch to OpenRouter Chat Completions API (NOT the SDK's `callModel` — it has Zod validation bugs with null `usage`)
- **Persistence**: localStorage (no database)
- **Deployment**: GitHub Pages (static, BYO API key) or self-hosted via Node.js (shared API key)

## Project Structure

```
server.mjs              # HTTP server: static serving, /api/config, /api/generate (SSE streaming)
public/
  index.html            # HTML + all CSS (dark theme)
  app.js                # Main entry: wires state + api + render + assistant
  state.js              # Agent state management, localStorage CRUD
  api.js                # API: server-proxied or direct-to-OpenRouter, SSE streaming
  render.js             # DOM rendering: agent bar, messages, markdown, drag-reorder
  assistant.js           # AI assistant widget: floating panel, JSON extraction, agent create/edit
cli/
  config.mjs            # CLI: fetch /api/config
  generate.mjs          # CLI: POST /api/generate with SSE streaming
  smoke-test.mjs        # 4 core smoke tests (config, generate, system prompt, auth)
  assistant-smoke-test.mjs  # 18 assistant tests (JSON extraction, create, edit, multi-turn)
```

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/config` | Returns `{ defaultModel, models[], hasApiKey }` |
| POST | `/api/generate` | SSE stream: `text_delta`, `content`, `done`, `error` events |

POST body: `{ model, systemPrompt?, messages[] }`. API key: env `OPENROUTER_API_KEY` or `x-api-key` header.

## Key Patterns

- **Agent schema**: `{ id, name, model, systemPrompt, messages: [{ role, content, images? }] }`
- **Images**: Stored as base64 data URLs in localStorage. Remote URLs are downloaded, downscaled (2048px max), and converted to JPEG 85%.
- **SSE streaming**: Server parses OpenRouter's SSE stream and re-emits as `data: {"type":"text_delta","delta":"..."}` events. In direct mode, the browser parses OpenRouter's native SSE format directly.
- **Direct mode**: When no server is available (GitHub Pages) or no server-side API key is set, the frontend calls OpenRouter directly via CORS. User provides their own key, stored in localStorage (`openrouter-api-key`). Detected by: `fetchConfig()` failure → `FALLBACK_CONFIG`, or `hasApiKey: false`.
- **Export formats**: OpenAI JSON and OpenRouter JSON (multimodal content arrays with `image_url` parts).
- **Paste-to-import**: Ctrl+V with OpenAI/OpenRouter JSON auto-creates a new agent.
- **Assistant widget**: Floating button opens chat panel. System prompt instructs AI to output ```json blocks with agent schema + `_action` field. "Apply as New" / "Apply to Current" buttons extract and apply JSON.

## Running

```bash
cp .env.example .env     # Add OPENROUTER_API_KEY
npm install
npm start                # Server on PORT (default 3000)
```

## Testing

```bash
node cli/smoke-test.mjs --port 3000           # 4 core tests
node cli/assistant-smoke-test.mjs --port 3000  # 18 assistant tests
```

## Gotchas

- Do NOT use `@openrouter/sdk` `callModel()` or `getTextStream()` — they throw Zod validation errors when `response.usage` is null. Use direct `fetch()` to `https://openrouter.ai/api/v1/chat/completions` instead.
- The `.env` file contains the API key — never commit it. `.gitignore` excludes it.
- Model list is hardcoded in both `server.mjs` `MODELS` array and `api.js` `FALLBACK_CONFIG`. Update both when changing available models.
- Assistant widget conversation is a single thread (not per-agent). It injects the current agent context into its system prompt on each message.
