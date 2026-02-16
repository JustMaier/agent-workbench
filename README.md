# Agent Workbench

**A multi-turn conversation editor for AI agent development.** Build, test, and iterate on agent prompts and workflows using any model on OpenRouter — right in your browser.

**[Try it now](https://justmaier.github.io/agent-workbench/)** — no install needed, bring your own OpenRouter API key.

---

## Why Agent Workbench?

Building AI agents means crafting multi-turn conversations — system prompts, user messages, assistant responses, tool calls — and testing how they behave across different scenarios. Most AI playgrounds give you a single chat box with no way to edit what came before.

Agent Workbench is a **conversation editor** built for agent developers. You get full control over every message in the thread so you can:

- **Hand-craft multi-turn test cases** for your agents
- **Edit any message** in the conversation — rewrite turns, swap roles, insert messages anywhere
- **Compare model behavior** by switching between any OpenRouter model mid-conversation
- **Build prompt libraries** with multiple agents, each with their own system prompt and conversation history
- **Iterate fast** — generate a completion, edit the result, regenerate, repeat

Whether you're developing a customer support agent, a coding assistant, or a complex multi-step workflow, Agent Workbench gives you the editing tools that chat interfaces don't.

## Features

- **Multi-turn conversation editing** — Full control over every message: edit content, toggle roles, insert anywhere, drag to reorder
- **Any OpenRouter model** — Pick from a curated list or type any OpenRouter-compatible model ID (GPT-4o, Claude, Gemini, Llama, Mistral, and more)
- **Multiple agents** — Create, rename, duplicate, and switch between agents with tabs
- **System prompt editor** — Define agent behavior with system prompts, test variations side by side
- **Image support** — Drag-and-drop, paste, or add image URLs to any message for multimodal testing
- **Import & export** — Paste OpenAI or OpenRouter JSON to import conversations; export in either format
- **Built-in AI assistant** — A chat assistant that can create and edit agents for you
- **Works offline** — Everything saved in localStorage. No accounts, no cloud, no data leaves your machine
- **Zero build step** — Pure HTML, CSS, and ES modules. No framework, no bundler

## Getting Started

### Use it online (no install)

Visit **[justmaier.github.io/agent-workbench](https://justmaier.github.io/agent-workbench/)**, enter your [OpenRouter API key](https://openrouter.ai/keys), and start building agents. Your key stays in your browser and is sent directly to OpenRouter — no server involved.

### Self-host with a shared API key

```bash
git clone https://github.com/JustMaier/agent-workbench.git
cd agent-workbench
cp .env.example .env     # Add your OpenRouter API key
npm install
npm start                # Opens on http://localhost:3000
```

When a server-side API key is configured, requests are proxied through the server so the key isn't exposed to the browser.

## Usage

| Action | How |
|--------|-----|
| Create an agent | Click the `+` tab (double-click to rename) |
| Set a system prompt | Type in the system prompt field at the top |
| Add messages | Use `+ User` / `+ Assistant` buttons, or click insert points between messages |
| Generate a completion | Click `Generate` to stream a response from the selected model |
| Reorder messages | Drag the `⠿` handle to a new position |
| Add images | Click `+ Image`, drag-and-drop, or paste an image/URL |
| Import a conversation | Copy OpenAI or OpenRouter JSON and press `Ctrl+V` |
| Export | Click the `Export` dropdown to copy or download JSON |

## Use Cases

- **Prompt engineering** — Craft and refine system prompts with instant feedback from any model
- **Agent testing** — Build multi-turn test scenarios to verify agent behavior before deployment
- **Training data creation** — Hand-build conversation examples for fine-tuning
- **Model comparison** — Run the same conversation against different models to compare outputs
- **Workflow prototyping** — Sketch out multi-step agent workflows with full conversation control

---

<details>
<summary><strong>Technical Details</strong></summary>

### Stack

- **Server**: Node.js HTTP server with SSE streaming (`server.mjs`)
- **Frontend**: Vanilla ES modules — no framework, no build step
- **API**: Direct fetch to OpenRouter Chat Completions API
- **Persistence**: localStorage (no database)
- **Deployment**: GitHub Pages (static) or self-hosted via Node.js

### Project Structure

```
server.mjs              # HTTP server: static files + /api/config + /api/generate (SSE)
public/
  index.html            # Single-page app with all HTML + CSS
  app.js                # Main entry: wires state, API, rendering, and assistant
  state.js              # Agent state management with localStorage persistence
  api.js                # API client: server-proxied or direct-to-OpenRouter streaming
  render.js             # DOM rendering: agent tabs, messages, markdown, drag-reorder
  assistant.js          # AI assistant widget
cli/
  smoke-test.mjs        # Core smoke tests
```

### API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/config` | Returns `{ defaultModel, models[], hasApiKey }` |
| POST | `/api/generate` | SSE stream: `text_delta`, `content`, `done`, `error` events |

POST body: `{ model, systemPrompt?, messages[] }`. API key via env `OPENROUTER_API_KEY` or `x-api-key` header.

### Configuration

| Environment Variable | Description |
|---------------------|-------------|
| `OPENROUTER_API_KEY` | Your OpenRouter API key (or provide via UI) |
| `PORT` | Server port (default: 3000) |

</details>

## License

MIT
