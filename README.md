# Agent Workbench

A lightweight, browser-based conversation editor for building and testing AI agent prompts. Craft multi-turn conversations with system prompts, generate completions via OpenRouter, and iterate fast — all without leaving your browser.

## Why Agent Workbench?

Most AI playgrounds give you a single chat box. Agent Workbench gives you a **conversation editor** — full control over every message in the thread so you can hand-craft training examples, test edge cases, and fine-tune agent behavior.

- **Edit any message** — Rewrite user or assistant turns, toggle roles, insert messages anywhere in the conversation
- **Drag to reorder** — Rearrange messages by dragging the handle
- **Multiple agents** — Create, rename, duplicate, and switch between agents with tabs (right-click for options)
- **Any model** — Pick from a curated list or type in any OpenRouter-compatible model ID
- **Image support** — Drag-and-drop, paste, or add image URLs to any message (auto-converted to base64)
- **Paste to import** — Paste OpenAI/OpenRouter JSON to instantly create an agent from an existing conversation
- **Export** — Copy as OpenAI or OpenRouter JSON, or download as a file
- **AI Assistant** — Built-in chat assistant that can create and edit agents for you
- **Zero build step** — Pure HTML, CSS, and ES modules. No framework, no bundler, no complexity
- **Local persistence** — Everything saved in localStorage. No accounts, no cloud sync, no data leaving your machine

## Getting Started

```bash
git clone https://github.com/JustMaier/agent-workbench.git
cd agent-workbench
cp .env.example .env     # Add your OpenRouter API key
npm install
npm start                # Opens on http://localhost:3000
```

Get an API key at [openrouter.ai](https://openrouter.ai). You can also enter a key directly in the UI if you prefer not to configure one on the server.

## Usage

- **Create an agent** — Click the `+` tab. Double-click a tab to rename it.
- **Set a system prompt** — Type in the system prompt field at the top.
- **Build a conversation** — Use `+ User` and `+ Assistant` to add messages, or click the insert points between existing messages.
- **Generate a response** — Click `Generate` to stream a completion from the selected model.
- **Reorder messages** — Grab the `⠿` handle and drag to a new position.
- **Add images** — Click `+ Image`, drag-and-drop onto a message, or paste an image/URL.
- **Import a conversation** — Copy OpenAI or OpenRouter JSON and press `Ctrl+V` anywhere.
- **Export** — Click the `Export` dropdown to copy JSON or download a file.

## Project Structure

```
server.mjs              # Node HTTP server: static files + /api/config + /api/generate (SSE)
public/
  index.html            # Single-page app with all HTML + CSS
  app.js                # Main entry: wires state, API, rendering, and assistant
  state.js              # Agent state management with localStorage persistence
  api.js                # API client: config fetch + SSE streaming
  render.js             # DOM rendering: agent tabs, messages, markdown, drag-reorder
  assistant.js          # AI assistant widget
cli/
  config.mjs            # CLI: fetch /api/config
  generate.mjs          # CLI: generate with SSE streaming
  smoke-test.mjs        # Core smoke tests
```

## Configuration

| Environment Variable | Description |
|---------------------|-------------|
| `OPENROUTER_API_KEY` | Your OpenRouter API key (or pass via UI) |
| `PORT` | Server port (default: 3000) |

## License

MIT
