# AI assistant

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/Forevka/canvas-word/tree/main/examples/ai)

Demonstrates the opt-in **`ai`** assistant: a docked chat panel, **✦ Ask AI** on
a text selection, and the **Settings → AI Model Provider** surface — with no
build step (browser import map), like [`embed-offline`](../embed-offline).

## Run it

Build the library once from the **repo root**:

```sh
npm install            # once, links the workspace packages
npm run build:lib      # produces frontend/dist-lib that the import map points at
```

Then serve this folder and open `http://localhost:3000/` (port depends on your
static server):

```sh
cd examples/ai
npm start              # `serve .`; a prestart step links the workspace build
```

npm workspaces hoist `@forevka/wordcanvas` to the repo-root `node_modules`, so
the prestart step creates `node_modules/@forevka/wordcanvas` here as a link to
`frontend/` — the import map then resolves both locally and on StackBlitz, where
the published package is installed in this folder and the step is a no-op.

Alternatively, serve the repo root (`npx serve .`) and open
`http://localhost:3000/examples/ai/`.

The demo preconfigures a **local OpenAI-compatible endpoint**
(`http://localhost:11434/v1`, model `llama3.2`). If you have
[Ollama](https://ollama.com) running, it works immediately. Otherwise:

1. Open the panel gear (or the setup card) → **AI Model Provider**.
2. Pick a provider, paste a key, choose a model, and click **Test connection**.
3. Ask a question in the panel, or select text and use **✦ Ask AI**.

## What to try

- **Panel chat**: ask “Summarize this document.”
- **Ask AI**: select a paragraph, click **✦ Ask AI**, pick a chip, **Send now**;
  then **Replace selection** and press Ctrl+Z (one step).
- **Queue**: select two passages, **Add to queue** each, then **Run queue** →
  **Apply all** (one Ctrl+Z).
- **Suggesting mode**: switch the mode picker to *Suggesting*; Replace now creates
  a tracked change instead of editing directly.

## Notes

- The key (if any) is stored only in this browser's `localStorage`.
- For a hosted product, pass an `ai.transport` so keys stay on your backend; the
  provider settings surface hides automatically.
- See [`docs/AI.md`](../../docs/AI.md) for the full option reference and privacy
  posture.
