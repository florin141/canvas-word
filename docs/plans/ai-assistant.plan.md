# Plan: AI Assistant for canvas-word

**Source spec**: [`docs/specs/AI-ASSISTANT-SPEC.md`](../specs/AI-ASSISTANT-SPEC.md)
**Status**: Implemented on `feat/ai-assistant` — pending review
**Complexity**: Large

## Requirements Restatement

Add a GenOffice-style, **opt-in** AI layer in three parts:

1. **AI side panel** — docked, resizable, collapsible chat panel with streaming, Stop, starter prompts, error/retry states, queue strip, and no-provider setup state. In-flow so it shrinks the page viewport and triggers exactly one relayout.
2. **Ask AI on selection** — first (leftmost) item in the existing floating text toolbar; opens the four-chip popover; **Send now** into chat or **Add to queue**; Apply actions (`Replace selection`, `Insert below`, `Copy`) as ordinary undoable transactions, routed through Suggesting mode when active.
3. **Settings → AI Model Provider** — provider/key/model form, Test connection, Show sidebar switch, per-provider key storage in `localStorage`, and an embedder `transport` hook that keeps keys server-side.

Hard constraints: `ai.enabled` defaults **false**, the `ai/` chunk only downloads on first AI use, no new runtime dependencies, no document-model/OOXML changes, and no provider call unless the user configured one.

## Section 12 Verification — Results From the Code

| # | Question | Finding |
|---|---|---|
| 1 | Floating-toolbar extensibility | **Inside the bar.** `floatingToolbar.buttons` already accepts built-in ids, `"\|"`, and custom buttons (`frontend/src/config.ts:268-299`), rendered by `buildItem` (`frontend/src/ui/floatingFormatBar.ts:272-299`). The priority manager shows exactly one bar (`frontend/src/ui/contextToolbar.ts:135-145`); text bar is priority 20. **Add a new built-in id `"askAi"`** rather than a separate chip. |
| 2 | Selection persistence on blur | **Already safe.** Selection is model-driven and repainted from `selection` in `applySelectionVisuals` (`frontend/src/index.ts:1103-1130`); no blur/focusout handler clears it (only object selection and block deletion do, `index.ts:1435`, `1625`). Missing piece is only the **inactive/gray highlight** for the popover state. |
| 3 | Position-mapper API | `Op` exposes `mapPosition` (`shared/src/model/ops.ts:187`); the editor already rebases bookmarks, peer carets, and review anchors after every local/remote op (`frontend/src/index.ts:1974-1988`, `2109-2128`). No public tracker exists → add a narrow `Editor.trackPositions(fn)` seam. |
| 4 | Replace-text command | No single "replace range" command, but the pattern exists: `deleteRange` + `insertText` in one transaction (`frontend/src/index.ts:2487-2499`). `insertText` inherits the run style at the offset via `fallbackStyle`/`styleAtRuns` (`shared/src/model/ops.ts:300-305`). Suggesting mode intercepts everything at `commit()` (`frontend/src/index.ts:2059-2068` → `review/intercept.ts:271`), so Apply needs no special-casing beyond dispatching normally. |
| 5 | Ribbon and shell seams | Ribbon is built imperatively with stable ids (`editorApp.ts:970`, `1093-1114`, `tab("home")` 1908, `tab("view")` 2634). Shell already has in-flow right-docked asides (`review`, `inspector` — `frontend/src/app/shell.ts:18-24,59`); add a third `aiPanel` aside. Width-driven relayout is already handled by the container `ResizeObserver` (`editorApp.ts:4648`). |
| 6 | WebMCP overlap | Independent and opt-in (`agentTools`). Its `documentText`/`selectionText` helpers (`frontend/src/agent/webmcp.ts:79-113`) are exactly the extraction logic AI needs → move to `shared/src/model/text.ts` and reuse; no feature coupling. |
| 7 | SDLC Definition of Done | Frontend-only. No model/OOXML/builder/C# work. Gates: `typecheck`, `test`, `build`, `build:lib`, Playwright browser pass, CHANGELOG/docs/example (`docs/SDLC.md:52-95`). **Playwright is a devDependency but the repo has no `shots/` tree** (it is gitignored); add a scripted smoke run under `frontend/scripts/`. |

Two spec assumptions are stale and the plan adapts:

- `createAiFeature(wc, options)` cannot live on the public class — `WordCanvas` has no DOM/editor-core access. The feature mounts **inside** `mountEditorApp` via a narrow `AiHost`, while `AiOptions` stays public.
- The existing Settings dialog supports only segmented rows (`frontend/src/ui/settingsDialog.ts:68`). AI needs text/password/select/switch/button controls, so it gets a **dedicated `aiSettingsDialog`** built on `createDialogShell`; Settings gets one small `action` row that opens it.

## Patterns to Mirror

| Category | Source | Pattern |
|---|---|---|
| Floating toolbar item | `frontend/src/ui/floatingFormatBar.ts:258-299` | New built-in id handled in the `buildItem` switch; custom buttons are not the default path |
| Right-docked panel | `frontend/src/app/shell.ts:52-59`, `editorApp.ts:3935-3939` | In-flow `<aside>` inside `.cw-workarea`, toggled by a class |
| Dialog | `frontend/src/ui/settingsDialog.ts`, `ui/dialogShell.ts` | `createDialogShell` + `injectCssOnce`; live-apply controls |
| Pure command | `frontend/src/editor/commands.ts:155-168` | `(state) => Transaction \| null`; one transaction = one undo entry |
| Anchor rebasing | `frontend/src/index.ts:1907-1924` | Ride each op's `mapPosition`; never index into arrays |
| Streaming abstractions | `frontend/src/agent/webmcp.ts` | Opt-in module, narrow host wiring, lazy-loaded |
| Tests | `frontend/src/ui/prefs.test.ts` | Colocated `*.test.ts`, stubbed globals, pure helpers exported for tests |
| Example | `examples/floating-toolbar` | Static HTML + import map + `serve` |
| Lazy loading | `frontend/src/wordcanvas.ts:253` | Dynamic `import()` at the existing mount seam |

## Files to Change

### Shared / editor core (foundation)

| File | Action | Why |
|---|---|---|
| `shared/src/model/text.ts` | UPDATE | Add `textOfRange(doc, start, end)` and `documentText(doc)`; reuse in WebMCP |
| `shared/src/model/text.test.ts` | UPDATE | Cover same-block, cross-block, missing-block, empty range |
| `shared/src/index.ts` | UPDATE | Re-export the helpers |
| `frontend/src/index.ts` | UPDATE | `Editor.trackPositions(fn)` (called from `runOps` + `applyRemoteOps`); `Editor.setSelectionInactive(bool)` |
| `frontend/src/paint/renderer.ts` | UPDATE | `setSelectionRects(rects, inactive?)` — gray active-selection paint |
| `frontend/src/input/keymap.ts` + test | UPDATE | Ignore Ctrl chords whose target is a form control (panel/popover inputs) |
| `frontend/src/input/selectionController.ts` | UPDATE | Same guard for navigation keys |
| `frontend/src/editor/commands.ts` + tests | UPDATE | Extract pure `insertFragmentOps`; add `replaceRangesCmd` (batch, reverse doc order, one transaction) |

### Public surface

| File | Action | Why |
|---|---|---|
| `frontend/src/app/runtime.ts` | UPDATE | `ai?: AiOptions` on `WordCanvasRuntime`; export provider/transport types |
| `frontend/src/wordcanvas.ts` | UPDATE | `ai?: AiOptions` option + pass-through; doc comment |
| `frontend/types/wordcanvas.d.ts` | UPDATE | Hand-written `AiOptions`, `ProviderConfig`, `AiStreamEvent`, `AiTransport` |
| `frontend/src/config.ts` | UPDATE | Add `"askAi"` to `FloatingToolbarBuiltin` |
| `frontend/src/ui/floatingFormatBar.ts` | UPDATE | Render `askAi` (✦ Ask AI) when a dep is provided; hide it (and its separator) for caret-only display |
| `frontend/src/app/shell.ts` | UPDATE | Add `aiPanel` aside to `workarea` |
| `frontend/src/ui/settingsDialog.ts` | UPDATE | New `action` row kind (button that opens a surface) |
| `frontend/src/editorApp.ts` | UPDATE | `ensureAi()` lazy import; ribbon AI toggle; Settings AI entry; panel aside wiring; inject `askAi` config; `AiHost` implementation |
| `frontend/src/main.ts` | UPDATE | `?ai=1` dev harness flag (provider preconfigured to a mock endpoint) |

### New AI module

| File | Action | Why |
|---|---|---|
| `frontend/src/ai/index.ts` | CREATE | `mountAiFeature(host, options)`; exposes panel/popover/settings openers |
| `frontend/src/ai/host.ts` | CREATE | Narrow interface over editor + shell (document, selection, dispatch, focus, tracker, notices, cleanup) |
| `frontend/src/ai/strings.ts` | CREATE | All user-facing strings + four chips + instruction templates in one map |
| `frontend/src/ai/providers/types.ts` | CREATE | `AIProvider`, `ChatMessage`, `StreamEvent`, `ProviderConfig`, `AiRequest`, `AiTransport` |
| `frontend/src/ai/providers/sse.ts` | CREATE | Manual SSE parser (CRLF, `[DONE]`, multi-line data) |
| `frontend/src/ai/providers/openaiCompatible.ts` | CREATE | OpenAI, DeepSeek, Mistral, Grok, OpenRouter, custom/local |
| `frontend/src/ai/providers/anthropic.ts` | CREATE | `/v1/messages`, browser-access header, SSE deltas |
| `frontend/src/ai/providers/gemini.ts` | CREATE | `streamGenerateContent?alt=sse` |
| `frontend/src/ai/providers/registry.ts` | CREATE | Catalog, default URLs, model suggestions, adapter mapping |
| `frontend/src/ai/settings/aiSettings.ts` | CREATE | `localStorage` load/save/validate, per-provider keys, redaction, `testConnection` |
| `frontend/src/ai/context/selectionAnchor.ts` | CREATE | Capture, tracker rebase, text equality → stale detection, ±300-char windows |
| `frontend/src/ai/context/promptBuilder.ts` | CREATE | System prompt, selection/doc context, 24k head+tail truncation, chip templates |
| `frontend/src/ai/session/chatStore.ts` | CREATE | Messages, queue, run state (in-memory) |
| `frontend/src/ai/session/runner.ts` | CREATE | Single run, abort, error mapping/retry, queue-in-one-pass JSON validation + repair retry |
| `frontend/src/ai/session/apply.ts` | CREATE | Build replacement fragment with start-run style; dispatch one transaction; stale refusal |
| `frontend/src/ai/ui/aiPanel.ts` | CREATE | Header/body/composer/queue/empty state/resize/mobile sheet |
| `frontend/src/ai/ui/askAiPopover.ts` | CREATE | Popover per design, focus trap, chips-fill-input, keyboard rules |
| `frontend/src/ai/ui/aiSettingsDialog.ts` | CREATE | Provider form via `createDialogShell` |

### Tests, docs, example

| File | Action |
|---|---|
| `frontend/src/ai/providers/*.test.ts`, `settings/*.test.ts`, `context/*.test.ts`, `session/*.test.ts` | CREATE — mocked `fetch`/SSE/abort, anchor rebase/stale, prompt truncation, queue JSON, apply ordering |
| `frontend/src/editor/commands.test.ts` | UPDATE — `replaceRangesCmd` one-transaction undo |
| `frontend/src/input/keymap.test.ts` | UPDATE — form-control guard |
| `docs/AI.md` | CREATE — setup, provider list, transport, privacy, known limitations |
| `README.md` | UPDATE — feature matrix + AI option |
| `CHANGELOG.md` | UPDATE — `### Added` under `[Unreleased]` |
| `examples/ai/` + `examples/README.md` row | CREATE — static import-map example with a custom/local endpoint |
| `frontend/scripts/ai-smoke.mjs` | CREATE — Playwright mocked-provider flow, screenshots to `shots/ai/` |

## Tasks and Phases

### Phase 0 — Foundation seams (½–1 day)

1. **Position tracker.** Add `trackPositions(fn)` to `Editor`; call each registered fn with `res.mapPosition` in `runOps` and per-op in `applyRemoteOps`; dispose trackers on teardown. Test: insert before / insert inside / delete covering / delete elsewhere.
2. **Text extraction in shared.** Move `documentText` + `selectionText` from `webmcp.ts` into `shared/src/model/text.ts`; add `textOfRange`. Update WebMCP imports. Test cross-block and table-cell paragraphs.
3. **Form-control key guards.** In `keymap.ts` and `selectionController.ts`, bail when `ev.target` is an `INPUT`/`TEXTAREA`/`SELECT` or a contenteditable that is not the IME proxy. Test Ctrl+B/Ctrl+Z typing in a text field does not reach the document.
4. **Public option plumbing.** `AiOptions` in `runtime.ts` → `wordcanvas.ts` → `wordcanvas.d.ts`. `ai` is omitted entirely when undefined (no listeners, no imports).

### Phase 1 — Provider layer + settings (spec P0) (1½–2 days)

5. `providers/types.ts`, `sse.ts`, `openaiCompatible.ts`, `registry.ts`. Errors mapped to `auth | rate_limit | network | cors | model | unknown`; never include the key in messages.
6. `aiSettings.ts`: key `wordcanvas.ai.settings.v1`, `{ providerId, model, baseUrl, apiKeys }`, per-provider keys, try/catch around storage.
7. `aiSettingsDialog.ts`: provider select, masked key + reveal, base URL (custom/override), model combobox with free text, **Test connection**, **Show AI sidebar**, privacy note, Cancel/Save.
8. Settings entry: add `action` row kind to `settingsDialog.ts`; `editorApp` pushes an "AI Model Provider…" row that lazy-loads the AI chunk and opens the dialog. Gear in the panel opens the same dialog.

**Done when** a user can configure a provider and Test connection reports success or a readable error.

### Phase 2 — Side panel (spec P1) (2 days)

9. `aiPanel` aside in shell + width clamp (280 px … 50% window), resize handle, open/width persistence, mobile bottom sheet.
10. `chatStore` + `runner` + `aiPanel` UI: streaming, Stop, error bubble with Retry, starter prompts; Enter sends, Shift+Enter newline; no-provider card (no network call).
11. `promptBuilder` doc-context Q&A; model badge; New chat.
12. Ribbon **AI** group on Home with a toggle button (available in both chrome presets through the command palette, which harvests ribbon buttons).
13. `ensureAi()` in `editorApp`: dynamic `import("./ai")` on first use only.

**Done when** the user can chat about the document with a configured provider and Stop/Retry work.

### Phase 3 — Ask AI on selection (spec P2) (2 days)

14. `"askAi"` built-in; when `ai.enabled` and the embedder did not supply custom `buttons`, effective config is `["askAi", "|", ...DEFAULT]`; respects the embedder's list otherwise. Hidden for caret-only display.
15. `selectionAnchor`: capture `{ id, start, end, text, before, after, revision }` (`revision = getChangeHead()`), rebase via tracker, validate text equality before apply.
16. `askAiPopover`: 340–360 px card, title, ellipsized preview, autofocus input, four chips filling the input, Send now / Add to queue (orange), Enter = Send now, focus trap, Esc/×/canvas-click close, `role="dialog"`.
17. Focus/IME safety: popover input does not reach document key handlers (Phase 0 guard); on close restore proxy focus and selection from the anchor. Inactive gray selection while open via `setSelectionInactive`.
18. Send now: append message with quoted selection, open panel, start run, stream, render Apply actions.
19. `apply.ts` + `replaceRangesCmd`: replacement inherits start-run style; blank lines → paragraphs; one transaction; Suggesting mode through the existing interceptor; stale anchor disables Apply with "Selection changed. Ask again".

**Done when** select → Ask AI → chip → Send now → streaming answer → Replace → one Ctrl+Z restores.

### Phase 4 — Queue (spec P3) (1–1½ days)

20. Queue strip above the composer: count, quoted snippet, instruction, remove, Run queue, Clear.
21. Batch prompt with numbered tasks + anchor ids; strict JSON result validation (unknown ids dropped, one repair retry).
22. One result card per item; **Apply all** applies valid non-stale results in reverse document order in a single transaction (one Ctrl+Z); queue clears on success, failed/stale items remain.

### Phase 5 — Remaining providers + transport (spec P4) (1–1½ days)

23. `anthropic.ts` and `gemini.ts` adapters + registry entries.
24. `AiOptions.transport`: replaces direct browser calls; when set, `showSettings` defaults to false and the panel/settings show a "Managed by your host" state.

### Phase 6 — Hardening, docs, verification (spec P5) (1½ days)

25. Suggesting-mode end-to-end check; a11y (focus trap, live region, labels, focus rings); mobile sheets.
26. Docs (`docs/AI.md`, README matrix), `examples/ai`, CHANGELOG.
27. `frontend/scripts/ai-smoke.mjs`: select → Ask AI first item; popover design/chips/disabled buttons; Send now → stream (mocked) → Replace → undo; queue ×3 → Apply all → one undo; edit while queued → rebase; stale item; Suggesting → tracked change; no provider → no request; Esc/focus restore; IME isolation; `?stress=1000` relayout.
28. Verify the AI chunk is absent until first use in a production build.

## Validation

```bash
npm run typecheck
npm run test
npm run build
npm run build:lib
node frontend/scripts/ai-smoke.mjs
```

Manual: one Anthropic-compatible and one OpenAI-compatible real key, plus a local OpenAI-compatible server (Ollama/LM Studio) to observe CORS behavior.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Panel/popover keystrokes stolen by container-level key handlers | High | Phase 0 form-control guards + keymap tests + browser check #9 |
| Anchors drift to the wrong text | High | Tracker rides `mapPosition`; apply refuses unless `textOfRange` equals the snapshot; no auto-apply |
| `apply all` producing multiple undo entries | Medium | `replaceRangesCmd` computes all ops against a scratch doc in reverse order; test asserts one undo |
| Suggesting mode double-handling | Medium | Apply dispatches ordinary commands; existing `intercept()` at commit is the only path; e2e test |
| Settings dialog refactor regressions | Medium | Keep the base dialog change to one new `action` row; AI form in its own dialog |
| CORS/provider quirks | Medium | Raw fetch + explicit error mapping; transport hook; real-key manual pass |
| Bundle size when AI is off | Medium | First-use dynamic import; verify build output has no AI chunk in the main graph |
| Relayout cost on open/close with huge docs | Medium | In-flow aside + existing `ResizeObserver`; `?stress=1000` check |
| Multi-paragraph replacement flattens mixed formatting | Low (known v1 limit) | Documented in the dialog/help; apply inherits start-run style |

## Complexity / Estimate

**Large** — roughly **9–12 engineering days**: foundation ½–1, providers/settings 1½–2, panel 2, Ask AI 2, queue 1–1½, providers/transport 1–1½, hardening/docs/verification 1½.

## Acceptance

- [ ] All section 3 acceptance criteria met
- [ ] `ai.enabled: false` build: no network, no listeners, no AI chunk loaded
- [ ] `ai/` lazy-loaded; zero new runtime dependencies
- [ ] `typecheck`, `test`, `build`, `build:lib` pass
- [ ] Browser scenarios in section 13 pass (scripted, screenshots in gitignored `shots/ai/`)
- [ ] No keys in logs, errors, or exported documents
- [ ] README matrix, `docs/AI.md`, `examples/ai`, CHANGELOG entry
- [ ] Suggesting mode produces a tracked suggestion on Replace
- [ ] One Ctrl+Z reverts a single Replace and a batch Apply all

## Assumptions (change before implementation if wrong)

1. Ask AI is the **first item inside** the existing text toolbar (not a separate chip) — confirmed feasible by the code.
2. Chip click **fills the input** (per the design); free-typed text is sent verbatim.
3. Browser-direct calls with keys in `localStorage` are the default; `transport` is the hosted-product path.
4. Chat is **in-memory per mount** in v1 (no per-document persistence).
5. AI settings is a dedicated dialog reached from Settings, the panel gear, and the ribbon — not new field rows inside the base Settings dialog.
6. The AI panel is closed by default; `panel.defaultOpen` can open it.
