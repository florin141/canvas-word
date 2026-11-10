# AI assistant (opt-in)

canvas-word can host a writing assistant next to the document: a chat side panel,
an **Ask AI** action on the text selection toolbar, and a provider settings
surface. The feature is **off by default**, ships as its own lazy chunk, and
makes no network call until the user configures a provider and asks a question.

```ts
import { WordCanvas } from "@forevka/wordcanvas";

new WordCanvas({
  container,
  ai: { enabled: true },
});
```

That is the whole integration. With `ai` omitted (or `enabled: false`) the AI
module is never imported, no listeners are installed, and no AI request is made.

---

## The three surfaces

### 1. Side panel

The **AI** button on the Home tab toggles a right-docked, resizable panel. It
hosts the chat transcript, streaming replies with **Stop**, starter prompts, a
model badge, **New chat**, the settings gear, and the queue strip. Width and open
state persist in `localStorage`.

### 2. Ask AI on a selection

Selecting a non-empty text range shows the usual floating format bar with
**✦ Ask AI** as its first item. It opens a popover with the selected text, an
instruction field, and four chips:

| Chip | What the model is told |
|---|---|
| Polish this passage | Improve clarity, flow and word choice while preserving meaning and tone. |
| Make this passage more concise | Rewrite to be more concise without losing key information. |
| Expand this passage | Add detail and supporting explanation, keeping the same tone. |
| Fix grammar and typos | Fix grammar, spelling and punctuation only. |

**Send now** posts the request into the panel and starts the answer. **Add to
queue** stacks the edit; **Run queue** asks the model for all replacements in one
request, and **Apply all** applies them as **one transaction** (one Ctrl+Z).

### 3. Settings → AI Model Provider

Reachable from the panel gear, the ribbon's Settings dialog, and the setup card
shown when no provider is configured. Fields: provider, API key (masked, per
provider), base URL (custom endpoints), model (free text with suggestions), a
live **Test connection**, the **Show AI sidebar** switch, and a privacy note.

---

## Providers

| Provider | Adapter | Default endpoint |
|---|---|---|
| Claude (Anthropic) | `anthropic` | `https://api.anthropic.com` |
| OpenAI | `openaiCompatible` | `https://api.openai.com/v1` |
| Gemini (Google) | `gemini` | `https://generativelanguage.googleapis.com/v1beta` |
| OpenRouter | `openaiCompatible` | `https://openrouter.ai/api/v1` |
| DeepSeek | `openaiCompatible` | `https://api.deepseek.com` |
| Custom / local | `openaiCompatible` | user-entered (`Ollama`, `LM Studio`, …) |

Opening the model field always allows free text, so defaults are suggestions, not
constraints. Adding another OpenAI-compatible provider is one registry row in
`frontend/src/ai/providers/registry.ts`.

## Keys, privacy, and the transport hook

By default the browser calls the provider directly. The key is stored **per
provider** in `localStorage` (`wordcanvas.ai.settings.v1`), is never logged, and
is redacted from provider error messages. Only the selected text, nearby context
(±300 chars), and — for document-level questions — a truncated document excerpt
leave the machine, and only to the provider the user chose.

`localStorage` is readable by any script on the origin. For a hosted product,
use an embedder transport so keys stay on your server:

```ts
new WordCanvas({
  container,
  ai: {
    enabled: true,
    transport: async function* (request, signal) {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal,
      });
      // Yield { type: "text", delta }, then { type: "done" }
      // (or { type: "error", code, message }).
      yield* readSse(response.body);
    },
  },
});
```

When `transport` is set, the provider settings surface is hidden by default
(`showSettings` flips to false); the panel and settings explain that the host
manages configuration.

---

## Options

```ts
interface AiOptions {
  enabled: boolean;                       // default false
  panel?: { defaultOpen?: boolean };      // default false
  provider?: Partial<ProviderConfig>;     // preconfigure an embedder-owned setup
  transport?: AiTransport;                // route calls through your backend
  showSettings?: boolean;                 // default true (false when transport is set)
}

interface ProviderConfig {
  providerId: string;
  apiKey?: string;
  baseUrl?: string;   // custom endpoints (also an optional override for built-ins)
  model: string;
}
```

`AiTransport` receives `{ system, messages, maxTokens? }` plus an `AbortSignal`
and returns an `AsyncIterable` of `{ type: "text" | "done" | "error" }` events.
The same events the built-in adapters emit, so an embedder backend can match the
contract exactly.

---

## How edits are applied

- **Replace selection** and **Insert below** dispatch ordinary editor commands:
  one transaction, one undo entry. In **Suggesting** mode the existing
  interceptor turns it into a tracked change automatically.
- The replacement **inherits the run style at the start of the selection** (font,
  size, color, weight, …). Mixed formatting inside the old selection is
  flattened — a known v1 limitation, called out in the UI.
- Blank lines split the answer into paragraphs; single newlines become soft line
  breaks.
- The selection anchor is rebased through every op's position mapper while the
  answer streams. If the text under the anchor changes or the range disappears,
  Apply is disabled with **“Selection changed. Ask again.”** — it never edits the
  wrong place.
- Queue results apply in reverse document order; same-block overlaps are skipped.

## Prompt-injection posture

The system prompt labels document content as untrusted data and forbids following
instructions inside it. v1 gives the model **no tools and no write access**: the
worst injected instruction can only produce text the user must still click to
apply. Re-evaluate before adding tool calling.

## Lazy loading and cost

`editorApp` imports `./ai` only when the embedder enabled AI **and** the user
first opens an AI surface. The production build emits the AI code as its own
chunk; an AI-disabled build and an AI-enabled-but-unused page never fetch it.
There are no new runtime dependencies (raw `fetch` + manual SSE parsing).

## Verification

```bash
npm run typecheck
npm run test
node frontend/scripts/ai-smoke.mjs   # Playwright, mocked provider, screenshots
```

The smoke script starts Vite on :5199, routes a mock OpenAI-compatible endpoint,
and exercises panel chat, Ask AI → Send now → Replace → undo, and queue ×2 →
Run queue → Apply all. Screenshots land in the gitignored `shots/ai/`.

## Limitations (v1)

- No tool calling, web search, image generation, attachments, skills, or MCP.
- Chat is in-memory per mount (no per-document persistence).
- Mixed formatting inside a replaced selection is flattened.
- Images, shapes, equations, and tables keep their own context toolbars (Ask AI
  is a text-selection action); an element-level Ask AI is future work.
- Browser-direct calls depend on the provider allowing CORS. If it does not, use
  `transport`.
