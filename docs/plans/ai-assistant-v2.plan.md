# Plan: AI Assistant V2 (canvas-word)

**Source spec**: [`docs/specs/AI-ASSISTANT-SPEC-V2.md`](../specs/AI-ASSISTANT-SPEC-V2.md)
**Supersedes (for planning)**: [`docs/plans/ai-assistant.plan.md`](./ai-assistant.plan.md) — that V1 plan is implemented; V2 extends it, it does not rebuild it.
**Branch**: `feat/ai-assistant`
**Status**: Proposed — awaiting approval
**Complexity**: Large — multi-release. Ship the spec's §21 MVP first, then the remaining phases.
**Generated**: 2026-11-10

---

## 1. Requirements restatement

V2 evolves the shipped V1 (panel, streaming, Ask AI popover, queue, three provider adapters, transport hook) into a **document-aware assistant** with three capability levels:

1. **Ask** — read-only Q&A over selection / section / whole document / tables.
2. **Suggest** — structured edit proposals shown as reviewable diffs; never auto-applied.
3. **Act** — bounded multi-step tasks through a typed, permissioned tool registry.

Hard invariants from the spec:

- No silent document mutation; all mutation goes through editor commands and transactions.
- Typed tools, permission checks in code, execution limits, cancellation, audit events.
- Token-aware context with an inspectable manifest; citations map only to trusted source ranges, never model-supplied offsets.
- Persistent per-document sessions, migrations, redacted diagnostics.
- No new mandatory runtime dependencies; AI remains lazy-loaded and opt-in.
- Provider, runner, context, proposals, tools and UI stay separate modules.
- Plus two product tracks: §23 professional design system and §24 Thinking effort configuration.

**Recommended scope split:** V2 MVP = sessions, context selector, outline/search, grounded citations, structured proposals + diff + safe apply/undo, read-only tool registry, run events. Defer plans/workflows, tables/images, attachments/extensions.

---

## 2. V1 baseline audit (from the actual code)

The spec (§19) requires this audit before V2 work. This is the grounded snapshot; Phase 0 turns it into a formal checklist.

| Area | V1 as implemented | V2 gap | Risk |
|---|---|---|---|
| Gating / bundle | `mountAiFeature` is dynamically imported by `ensureAi()` (`frontend/src/editorApp.ts:617`); `AiOptions.enabled` defaults false | Keep; extend option surface incrementally | Low |
| Panel | `frontend/src/ai/ui/aiPanel.ts` — in-flow aside, streaming, Stop, Retry, New chat, starters, no-provider card, queue strip | Sessions, history, modes, context selector, citations, proposals, tool activity | Medium |
| Providers | `openaiCompatible.ts`, `anthropic.ts`, `gemini.ts`; text-only SSE; 6 error codes; no usage, tool calls, JSON mode, capabilities, reasoning | Capability model, tool-call streaming, usage, JSON mode, thinking effort, wider error taxonomy | **High** |
| Settings | `wordcanvas.ai.settings.v1` `{providerId, model, baseUrl, apiKeys}`; dedicated dialog; per-provider keys; test connection | Schema versioning/migration, capability-driven UI, thinking effort, sessions/context settings | Medium |
| Context | `promptBuilder.ts` — ±300-char selection window, 24k-char head+tail document cap, heading markers; no manifest | Token budget, context sources, retrieval, manifest, citations, exclusions | **High** |
| Anchors | `selectionAnchor.ts` — snapshot + `trackPositions` + text-equality stale check | Reusable base; add multi-range/section/table anchors | Low |
| Apply | `session/apply.ts` — plain-text replace / insert below / copy; one transaction; Suggesting mode via normal dispatch; reverse-order apply-all | Structured operations, proposals, diff, per-operation apply, formatting/table ops | **High** |
| Queue | One batch JSON request + one repair retry; strict id filtering | Typed tasks, statuses, dependencies, partial retry, conflict surfacing | Medium |
| Host bridge | `host.ts` — document, selection, dispatch, focus, tracker, notifications | Outline, search, navigate, block/table/document-info getters | **High** |
| Sessions | None — chat is in-memory per mount | Session model, storage abstraction, restore, export, retention | **High** |
| Events | None | Redacted run events, diagnostics, usage | Medium |
| Editor foundation | Commands/transactions, `trackPositions`, Suggesting interceptor, table commands (`insertTableRowCmd`, `insertTableColumnCmd`, `mergeCellsCmd`), TOC/heading machinery, `Document.docId` | Reuse all of it; no find/search UI exists | Good foundation |
| UI system | Literal CSS colors per module with dark overrides; no semantic token layer | Tokens, shared primitives, WCAG 2.2 AA, visual QA | **High** |

**Conclusion:** the anchor tracker, command/transaction apply path, provider adapter shape and queue batching are reusable. The concentrated risk is context/citations, provider tool-call plumbing, proposals and the UI token layer.

---

## 3. Decisions locked for planning (spec §20)

| # | Decision | Default chosen |
|---|---|---|
| 1 | Session storage | Async `AiSessionStorage`; localStorage adapter + in-memory fallback; embedder override |
| 2 | Session association | Multiple sessions per document **and** standalone sessions; `docId` from `Document.docId`/host |
| 3 | Chat retention | Persist only when `sessions.enabled`; `maxSessions` configurable; never persist keys |
| 4 | Agent default | `agent.enabled: false`; when enabled, Ask + Suggest, read-only tools only |
| 5 | Plan approval | Any plan containing mutating steps requires approval; read-only plans may run |
| 6 | Diff representation | Proposal preview is primary; route through existing Suggesting mode when active |
| 7 | Citation stability | Source-ID citations validated against the manifest; tracked ranges; stale is shown, never guessed |
| 8 | Semantic retrieval | Local lexical retrieval in V2.1; embedder adapter interface; semantic deferred |
| 9 | Table support | Reuse existing commands/ops; read + cell-text proposals first; no formulas |
| 10 | Image access | Defer to V2.5; read-only; explicit user action |
| 11 | Attachment parsing | V2.6; optional processor; core ships interfaces only |
| 12 | Provider routing | User-selected model only; profiles optional; no silent routing |
| 13 | Hosted deployment | Transport recommended; browser keys allowed with a clear warning (current behavior) |
| 14 | Telemetry | Embedder-owned via `onEvent`; no built-in network calls |
| 15 | Localization | All AI strings centralized in `ai/strings.ts` with embedder overrides; presets are data |

These are planning defaults, not irreversible choices.

---

## 4. Patterns to mirror

| Category | Source | Pattern |
|---|---|---|
| Pure document queries | `shared/src/model/query.ts` (`walk`, `findParagraphs`), `shared/src/model/text.ts` (`paragraphsOf`, `textOfRange`) | Pure, DOM-free, memoized by document identity |
| Commands / transactions | `frontend/src/editor/commands.ts` | `(state) => Transaction \| null`; one transaction = one undo entry |
| Anchor tracking | `frontend/src/ai/context/selectionAnchor.ts:58` | Rebasing through `trackPositions`; stale by text equality |
| Provider adapter | `frontend/src/ai/providers/openaiCompatible.ts:13` | Small fetch+SSE wrapper; errors yielded as events, never thrown |
| Settings persistence | `frontend/src/ai/settings/aiSettings.ts:37` | Best-effort localStorage, validation, no key logging |
| Dialog | `frontend/src/ai/ui/aiSettingsDialog.ts:72` via `ui/dialogShell.ts` | Dedicated dialog, live Test connection |
| Lazy mounting | `frontend/src/editorApp.ts:617` | Dynamic `import("./ai")` on first use |
| Tests | Colocated `*.test.ts`, Vitest | Mocked `fetch`/SSE/abort; pure helpers exported |
| Smoke harness | `frontend/scripts/ai-smoke.mjs` | Playwright with mocked provider; screenshots under gitignored `shots/` |

---

## 5. Delivery plan

### Phase 0 — Baseline audit + guardrails (1–1.5 days)

1. Write `docs/plans/ai-assistant-v2-baseline.md` using the spec §19 table and required outputs.
2. Extend the smoke harness with V1 regression scenarios (panel, Ask AI, apply, queue, Suggesting, undo) so V2 work cannot silently break V1.
3. Verify the bridge gaps identified above against the running editor (navigate/reveal, table reads, image byte access deferred).

**No production behavior changes.**

---

### Phase 1 — V2.0 Foundation (3–4 days)

1. **Sessions:** `ai/sessions/types.ts`, `storage.ts`, `store.ts`, `migrations.ts` — async `AiSessionStorage`, localStorage adapter, in-memory fallback, list/load/save/delete, `docId` association, `maxSessions`, retention. Extend turns with attempts/status/structured metadata; retry appends an attempt instead of deleting history.
2. **Settings v2:** versioned schema + migration from `wordcanvas.ai.settings.v1` without losing provider keys; new optional fields for context, sessions, thinking effort.
3. **Capabilities:** `ai/providers/capabilities.ts` — streaming, toolCalling, jsonMode, vision, context/output limits, reasoning efforts. Unknown = unsupported, never assumed.
4. **Thinking effort:** normalized `auto/low/medium/high/maximum`; precedence run → session → profile → auto; adapter mapping only when capability says supported; omit otherwise and surface a readable error for explicit unsupported choices. Settings UI control appears after model selection and lists only supported levels.
5. **Run events:** `ai/api/events.ts`, redacted `AiRunEvent` union + `onEvent` option.
6. **UI foundation (cross-cutting):** semantic tokens in `frontend/src/ui/styles.ts` (`--cw-surface`, `--cw-text`, `--cw-border`, `--cw-accent`, status/space/radius/type tokens), shared AI primitives (`ai/ui/primitives.ts`), and `ai/strings.ts` for all AI-visible strings. Refactor Panel/popover/settings CSS to tokens without changing layout behavior.
7. **Public API:** extend `AiOptions` additively in `ai/types.ts` → `runtime.ts` → `wordcanvas.ts` → `types/wordcanvas.d.ts`. Add options only as phases implement them; `agent.enabled` and `sessions.enabled` default false.

**Exit:** with sessions enabled, a session survives reopen; V1 settings/keys migrate; thinking effort persists and maps correctly per adapter; events emit; all V1 flows pass.

---

### Phase 2 — V2.1 Document intelligence (4–5 days)

1. **Search:** `shared/src/model/search.ts` — exact, case-sensitive/insensitive, whole-word, multiple ranges, heading path, stable revision; basic fuzzy optional. Unit-tested on body, table cells and headings.
2. **Outline:** `ai/document/outline.ts` — heading hierarchy with section identifiers and ranges (reuse heading detection from `promptBuilder`/TOC logic).
3. **Bridge:** extend `AiHost` with `getDocumentInfo`, `getOutline`, `search`, `navigateTo`, `getBlock`, `getTable`; implement in `frontend/src/editorApp.ts` using existing editor APIs.
4. **Context builder v2:** `ai/context/{types,builder,budget,manifest,retrieval}.ts` — context sources (selection, surrounding, paragraph, section, whole document, search results, selected ranges, table), token-aware budget with `maxInputTokens`/reserved output, local lexical retrieval with heading-aware chunks, manifest with type/label/source ID/revision/truncation. Keep `maxDocumentChars` compatibility.
5. **Citations:** `ai/document/citations.ts` — label manifest sources, parse model citations (`[S1]`), validate against the manifest, map to trusted ranges, flag stale. UI chips + Sources section + click-to-navigate.
6. **Context selector UI:** composer control (Selection / This section / Entire document / Selected sources) with an inspectable manifest preview and exclusion/privacy controls; warn when truncated or excerpt-only.

**Exit:** grounded Q&A returns validated citations; clicking navigates; cross-document isolation tests pass; no false claim of whole-document context.

---

### Phase 3 — V2.2 Review experience (4–5 days)

1. **Proposals:** `ai/proposals/{types,builder,validator,diff,apply}.ts` — ops `replaceText`, `insertText`, `deleteRange`, `insertBlocks`, `formatRange`, `replaceTableCells` (table apply gated on Phase 7). Model references **source IDs**, never offsets; validator maps IDs → trusted ranges and rejects unknown/stale/overlapping ops.
2. **Proposal protocol:** JSON output + one bounded repair attempt; never execute raw model JSON.
3. **Proposal UI:** title/rationale, affected range, before/after and added/removed labels (not color-only), accept/reject/edit, apply selected/all, stale/conflict explanations, approval bound to proposal version.
4. **Task collection:** upgrade the V1 queue into typed tasks with statuses (`queued/running/ready/stale/failed/cancelled/applied/rejected`), reorder/remove/edit and partial retry; preserve current queue behavior as the simple path.
5. **Apply semantics:** one transaction, reverse document order, revalidate anchors immediately before apply, Suggesting mode via existing dispatch; undo test asserts exact prior state.

**Exit:** reject leaves the document unchanged; apply is exactly one undo; stale handling never silently skips; editing during review invalidates approval.

---

### Phase 4 — V2.3 Tool system, read-only (4–5 days)

1. **Tool core:** `ai/tools/{types,registry,validation}.ts` — typed input/output schemas, internal JSON-schema-subset validator (no new runtime dependency), risk levels, duplicate-name rejection.
2. **Permissions/limits:** `ai/agent/{permissions,limits}.ts` — `AiPermissionSet`, approval policy, `maxToolCalls/iterations/duration/output/parallel`, active document/session scope enforcement.
3. **Built-in read-only tools:** `get_document_info`, `get_document_outline`, `get_document_text`, `search_document`, `get_selection`, `get_block`, `get_table`, `get_context_sources`, `get_document_metadata`.
4. **Agent loop:** `ai/agent/runner.ts` orchestrates provider calls, tool validation/execution, iteration limits, cancellation, events. Keep `session/runner.ts` as the one-shot transport primitive.
5. **Provider tool-call streaming:** extend `AiStreamEvent` and `AiRequest` additively (tool calls, usage, metadata). Implement and verify OpenAI-compatible + Anthropic with mocked SSE fixtures; Gemini stays capability-gated until verified. Existing transports remain valid and simply remain text-only.
6. **UI:** collapsible tool-activity entries and distinct run states (preparing context, searching, calling tool, waiting, completed/cancelled/failed).

**Exit:** read-only tool tasks work under policy; unknown tools, spoofed names, invalid args and permission denials are rejected; Stop aborts every active tool; prompt-injection content is never treated as instructions.

---

### Phase 5 — V2 MVP hardening (2–3 days)

- Security tests (injection in document, cross-document replay, stale anchor mutation, model-supplied offsets, oversized tool output, approval after change, key redaction).
- Accessibility: keyboard navigation for citations/proposals/session history, focus restoration, live-region status, reduced motion, light/dark contrast.
- Responsive panel/overlay behavior; 1,000-page stress run during streaming and retrieval.
- Visual QA screenshots for all primary surfaces; documented manual matrix (baselines stay out of git per existing `shots/` ignore rule).
- Docs: `docs/AI.md` V2 setup/options/privacy; README matrix; CHANGELOG; example update.
- Verify the AI chunk is absent from the initial graph when disabled/unused.

**Exit:** V2 MVP Definition of Done (§21 scenario + applicable §17/§25 checks).

---

### Post-MVP phases (separate confirmations)

| Phase | Scope | Estimate |
|---|---|---|
| 6 — V2.4 | Plans, approval gates, progress, partial retry, prompt presets as data, extra entry points (section/table/context menu) | 4–5 days |
| 7 — V2.5 | Table read/proposals (`replaceTableCells`, row/column ops), optional image analysis behind vision capability | 4–6 days |
| 8 — V2.6 | Attachments interface + optional parsers, custom tools/context providers/model profiles, extension isolation | 4–5 days |
| 9 — V2.7 | Full hardening: visual regression, localization, docs, migration validation, performance | 4–5 days |

---

## 6. Files to change (MVP)

| File | Action | Why |
|---|---|---|
| `frontend/src/ai/types.ts` | UPDATE | Additive V2 options, capabilities, reasoning, tool/usage/event types |
| `frontend/src/ai/host.ts` | UPDATE | Outline/search/navigate/block/table/document-info bridge |
| `frontend/src/ai/index.ts` | UPDATE | Wire sessions, context, citations, proposals, agent, new UI |
| `frontend/src/ai/settings/aiSettings.ts` | UPDATE | Schema v2 + migration, thinking effort, session/context prefs |
| `frontend/src/ai/ui/aiSettingsDialog.ts` | UPDATE | Capability-driven thinking effort; grouped settings |
| `frontend/src/ai/ui/aiPanel.ts` → workspace modules | UPDATE/CREATE | Session header/history, context strip, mode/status, citations, proposal cards |
| `frontend/src/ai/ui/primitives.ts`, `frontend/src/ai/strings.ts` | CREATE | Shared AI components + centralized localizable strings |
| `frontend/src/ai/sessions/{types,storage,store,migrations}.ts` | CREATE | Session lifecycle and persistence |
| `frontend/src/ai/providers/capabilities.ts` | CREATE | Capability registry, unknown = unsupported |
| `frontend/src/ai/providers/{openaiCompatible,anthropic,gemini}.ts` | UPDATE | Usage, reasoning mapping, tool-call streaming (gated) |
| `frontend/src/ai/context/{types,builder,budget,manifest,retrieval}.ts` | CREATE | Context sources, token budget, retrieval, manifest |
| `frontend/src/ai/document/{outline,search,citations}.ts` | CREATE | Outline/search/citation mapping |
| `frontend/src/ai/proposals/{types,builder,validator,diff,apply}.ts` | CREATE | Structured proposals and safe apply |
| `frontend/src/ai/tools/{types,registry,validation}.ts`, `frontend/src/ai/tools/builtins/*` | CREATE | Typed read-only tool system |
| `frontend/src/ai/agent/{runner,permissions,limits}.ts` | CREATE | Agent loop and policy |
| `frontend/src/ai/api/events.ts` | CREATE | Redacted run events |
| `shared/src/model/search.ts` (+ test, export) | CREATE | Pure multi-range document search |
| `frontend/src/editorApp.ts` | UPDATE | Implement bridge additions; entry points |
| `frontend/src/wordcanvas.ts`, `frontend/src/app/runtime.ts`, `frontend/types/wordcanvas.d.ts` | UPDATE | Public option pass-through |
| `frontend/src/ui/styles.ts` | UPDATE | Semantic tokens for AI surfaces |
| `frontend/scripts/ai-smoke.mjs` | UPDATE | V1 regression + V2 mocked-provider scenarios |
| `docs/AI.md`, `README.md`, `CHANGELOG.md`, `examples/ai/` | UPDATE | V2 documentation and example |

Tests are colocated `*.test.ts` per V1 convention for every new pure module; provider tests use mocked SSE fixtures.

---

## 7. Validation

```bash
npm run typecheck
npm run test
npm run build
npm run build:lib
npm run ai:smoke -w @forevka/wordcanvas
```

Manual: one real Anthropic key, one OpenAI-compatible key, one local OpenAI-compatible server (CORS), and the 1,000-page stress document during streaming and retrieval.

---

## 8. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| V2 scope overwhelms one release | High | Ship §21 MVP first; post-MVP phases gated separately |
| Provider tool-call streaming differs per API | High | Capability-gated activation; mocked fixtures first; text-only fallback; Gemini deferred until verified |
| Citations/proposals mis-map to wrong ranges | High | Models reference source IDs only; runtime maps trusted ranges; tracker + revision validation; stale never applied |
| Proposal apply produces partial/overlapping edits | Medium | Validator rejects overlap; reverse-order single transaction; undo and conflict tests |
| Session migration loses provider keys | Medium | New versioned schema, read-only migration from v1, quarantine invalid records |
| localStorage quota/private mode | Medium | Async storage abstraction, in-memory fallback, visible non-persistence warning |
| UI token refactor regresses V1 surfaces | Medium | Tokens established in Phase 1, apply incrementally, smoke screenshots each phase |
| Bundle grows when AI is off | Medium | Keep dynamic import seam; verify production build graph each release |
| 1,000-page performance | Medium | Cache outline/index by document revision; chunked retrieval; streaming never triggers relayout |
| Prompt injection via document/tool output | High | Data-labelled prompts, code-level permissions, allowlist, output limits, security tests |
| Thinking-effort mapping wrong per model | Medium | Conservative capability table; omit unknown; adapter mapping tests; never claim ignored effort was honored |

---

## 9. Complexity / estimate

- **V2 MVP (Phases 0–5):** ~18–24 engineering days.
- **Full V2 (through Phase 9):** ~34–45 engineering days.
- Highest technical risk: provider tool-call layer and proposal validation. Highest product risk: retaining V1 performance and visual coherence while adding surfaces.

---

## 10. Acceptance (V2 MVP)

- [ ] The §21 scenario passes end to end: grounded answer with citations → navigate → request edit → review diff → apply → one undo restores → session restored after reopen; no provider call before submit.
- [ ] All V1 acceptance criteria still pass; V1 settings/keys migrate.
- [ ] Sessions, context manifest, citations, proposals and read-only tools work only when their options are enabled.
- [ ] All mutations use editor commands/transactions; Suggesting mode works; stale anchors/approvals never apply.
- [ ] Tool calls cannot bypass permissions; unknown tools/invalid args are rejected; Stop aborts active work.
- [ ] No new runtime dependencies; AI remains lazy-loaded; no keys or raw document text in events/logs.
- [ ] Light/dark, keyboard, screen-reader, responsive checks pass; 1,000-page stress shows no unacceptable regression.
- [ ] Docs, README, example and CHANGELOG updated.

---

**Waiting for confirmation.** Reply `proceed` to start Phase 0 (audit artifact + V1 regression harness), or `modify: …` to change scope, sequencing or any of the 15 decisions above.
