# Specification: AI Assistant for canvas-word --- Version 2

  ----------------------------------- -----------------------------------
  **Status**                          Proposed --- V2

  **Supersedes**                      AI Assistant Spec v1

  **Baseline**                        V1 is implemented

  **Target repo**                     `Forevka/canvas-word`
                                      (`@forevka/wordcanvas`, MIT)

  **Reference**                       GenOffice-style document AI
                                      workspace

  **Scope**                           Evolve the existing AI chat and
                                      selection actions into a
                                      document-aware assistant with
                                      controlled tools, structured edits,
                                      review workflows, persistent
                                      sessions, richer context and
                                      extensible capabilities
  ----------------------------------- -----------------------------------

> **Implementation assumption:** V1 is shipped. Existing provider
> adapters, settings, panel, Ask AI popover, selection anchors, queue,
> streaming and apply flows are existing capabilities. V2 should extend
> these in place, preserve public API compatibility where practical, and
> provide migrations for any persisted data changes. Before
> implementation, inspect the actual V1 code and record the implemented
> behavior in a V1 baseline checklist.

------------------------------------------------------------------------

# 1. Executive summary

V2 turns the existing AI panel into a **document-aware workspace** that
can answer questions, navigate and search the current document, propose
structured edits, work across multiple selected regions, analyze tables,
interpret inserted files, and execute bounded multi-step tasks through
an explicit tool system.

The assistant must distinguish between three levels of capability:

1.  **Ask** --- answer questions using document context without changing
    the document.
2.  **Suggest** --- generate proposed changes that the user reviews and
    explicitly applies.
3.  **Act** --- execute a bounded sequence of approved document
    operations using editor commands and transactions.

The assistant must never silently modify document content. Read-only
analysis may run immediately. Any operation that changes document
content must be previewed or explicitly authorized through a clearly
scoped action. Destructive, broad, or ambiguous operations require
confirmation.

V2 is not intended to be an unrestricted autonomous agent. It is a
controlled document agent with a typed tool registry, permission policy,
execution limits, audit trail and reliable undo behavior.

## 1.1 Product outcomes

-   The user can ask questions about the whole document, a section, a
    selection, a table or a supported attachment.
-   The assistant can find relevant content and cite where an answer
    came from.
-   The user can request edits in natural language and review them as
    diffs or tracked suggestions.
-   The assistant can perform multi-step tasks such as finding repeated
    terminology, proposing consistent replacements, summarizing
    sections, or restructuring selected content.
-   Chat sessions can be restored and associated with a document.
-   Providers and models can be selected per session, subject to the
    configured policy.
-   Embedders can expose custom tools and secure server-side model
    transport without coupling the core library to a framework or
    backend.
-   All editor changes continue to use normal commands, transactions,
    inverse operations, undo and collaboration mechanisms.

## 1.2 What remains from V1

V1 capabilities remain supported:

-   Opt-in, lazy-loaded AI feature.
-   Right-side resizable AI panel.
-   Streaming chat, Stop and Retry.
-   Starter prompts.
-   Ask AI on text selection.
-   Selection popover and prompt chips.
-   Send now and queued selection tasks.
-   Selection anchors and stale-anchor protection.
-   Replace selection, Insert below and Copy.
-   Apply all in one transaction where supported.
-   Provider settings and connection tests.
-   OpenAI-compatible, Anthropic and Gemini adapters.
-   Embedder-provided transport.
-   Suggesting-mode integration.
-   No new mandatory runtime dependencies.

------------------------------------------------------------------------

# 2. V2 scope and feature matrix

  -----------------------------------------------------------------------
  Capability              V1                      V2 target
  ----------------------- ----------------------- -----------------------
  Chat side panel         Implemented             Multi-session
                                                  workspace, conversation
                                                  history, context
                                                  controls

  Streaming               Implemented             Stream status, tool
                                                  events, resumable UI
                                                  state, cancellation

  Selection actions       Implemented             Multi-range, section,
                                                  table and object
                                                  context

  Selection queue         Implemented             Typed tasks,
                                                  dependencies, batch
                                                  preview and partial
                                                  retry

  Document Q&A            Basic full-text context Search-backed
                                                  retrieval, source
                                                  references and grounded
                                                  answers

  Document search         ---                     Search, locate,
                                                  navigate and collect
                                                  references

  Structured edits        Plain text replacement  Diff-based edits,
                                                  formatting-aware
                                                  operations and review

  Agent tools             ---                     Typed, permissioned
                                                  document tool registry

  Multi-step tasks        ---                     Plan → approval →
                                                  execute → review

  Tables                  ---                     Analyze, summarize,
                                                  transform and edit
                                                  selected table regions

  Images                  ---                     Describe and analyze
                                                  supported image content
                                                  where provider supports
                                                  vision

  Attachments             ---                     Optional import and
                                                  contextual analysis for
                                                  supported file types

  Chat persistence        ---                     Per-document and
                                                  standalone sessions

  Context management      Basic truncation        Context sources, token
                                                  budget, retrieval and
                                                  exclusions

  Citations               ---                     Document citations with
                                                  navigation to source
                                                  ranges

  Templates and workflows ---                     Reusable prompts, task
                                                  presets and optional
                                                  embedder skills

  Provider management     Basic                   Model capabilities,
                                                  limits, routing and
                                                  policy controls

  Observability           Basic errors            Redacted run events,
                                                  usage metadata and
                                                  diagnostics

  Collaboration           Existing OT             Conflict-aware review
                                                  and stale operation
                                                  handling
  -----------------------------------------------------------------------

## 2.1 Explicit non-goals for V2

-   Arbitrary computer use or browser automation.
-   General-purpose internet search unless an embedder explicitly
    supplies a web-search tool.
-   Running arbitrary JavaScript, SQL, shell commands or remote code.
-   Autonomous sending, publishing, exporting or sharing documents.
-   Automatic acceptance of tracked changes.
-   Silent edits to the document.
-   Provider-specific SDK dependencies in the core package.
-   Mandatory cloud account, vendor login or hosted AI service.
-   Replacing the editor's document model, command system, transaction
    model or collaboration protocol.
-   Guaranteeing identical output across different models or providers.

------------------------------------------------------------------------

# 3. Core interaction model

## 3.1 Three operating modes

### Ask mode

Purpose: explain, summarize, compare, extract or answer questions.

-   Uses document context and read-only tools.
-   May search the document and navigate to sources.
-   Does not create document mutations.
-   Answers should identify relevant source locations where possible.
-   If evidence is insufficient, the assistant says so instead of
    inventing content.

Examples: - "Summarize the main argument." - "What deadlines are
mentioned?" - "Find every reference to the renewal date." - "Compare the
requirements in sections 2 and 5."

### Suggest mode

Purpose: prepare a proposed document change.

-   Produces a structured proposal.
-   Displays a preview, diff or suggestion card.
-   User can accept, reject or edit the proposal.
-   Supports one or multiple anchored changes.
-   Does not apply until the user explicitly chooses an Apply action.

Examples: - "Make this section more concise." - "Rewrite the
introduction in a more formal tone." - "Standardize all occurrences of
this term." - "Convert these notes into a table."

### Act mode

Purpose: carry out a bounded multi-step task.

-   Assistant first creates a plan with explicit steps and affected
    ranges.
-   The user reviews and approves the plan or individual steps.
-   Tools execute only within the approved scope.
-   Mutations are staged as proposals and committed through a
    transaction.
-   The user can cancel before commit.
-   The execution summary lists completed, skipped, failed and stale
    operations.

Examples: - "Find all inconsistent date formats and standardize them." -
"Create an executive summary from sections 1--4 and insert it after the
title." - "Identify duplicated paragraphs and propose which ones to
remove."

The UI must make the current mode visible. Mode changes must not
silently expand permissions.

## 3.2 Interaction surfaces

V2 uses the existing panel and selection popover as the primary entry
points.

Additional entry points:

-   **Document command bar:** Ask AI, Summarize, Find in document,
    Review document.
-   **Section menu:** Ask about this section, Summarize section, Improve
    section.
-   **Table toolbar/menu:** Explain table, summarize rows, transform
    table.
-   **Context menu:** Explain, rewrite, translate, extract action items.
-   **AI panel context selector:** Current selection, current section,
    whole document, selected sources.
-   **Inline result cards:** citations, edit proposals, plans, tool
    activity and errors.

All entry points must use the same session, runner, permission and tool
infrastructure.

------------------------------------------------------------------------

# 4. Detailed functional requirements

## 4.1 AI workspace and chat sessions

### Workspace layout

The existing side panel becomes a workspace with:

-   Header: AI title, current model, context indicator, New chat,
    session history and settings.
-   Conversation area: user and assistant messages, citations, tool
    activity, proposal cards and status.
-   Optional context strip: active selection, section, document or
    attached sources.
-   Composer: multiline prompt, mode selector, context selector,
    attachment control (if enabled), Send and Stop.
-   Optional task panel: plan steps, queued operations and pending
    approvals.

The panel remains resizable and collapsible. The editor viewport must
relayout only when the panel geometry changes, not on every streamed
token or tool event.

### Session lifecycle

Support:

-   New session.
-   Rename session.
-   Delete session.
-   Archive session.
-   Restore recent session.
-   Duplicate session as a starting point.
-   Clear conversation while retaining session settings.
-   Export conversation as Markdown or JSON.
-   Search session titles and message text where local persistence is
    enabled.

A session has a stable ID and may be associated with a `docId`. A
session without a document association is a general assistant session
and must not receive document content by default.

### Session state

Persist only what is required to restore the conversation:

-   Session ID and document ID.
-   Title and timestamps.
-   Messages and their structured metadata.
-   Model/provider identifier (not necessarily API key).
-   Mode and context configuration.
-   References to proposals and execution summaries.
-   Optional usage metadata.

Do not persist live editor objects, DOM nodes, provider clients,
AbortControllers or raw document snapshots by default.

### Conversation history

-   User messages and assistant responses are immutable historical
    records.
-   Retry creates a new attempt associated with the original user
    message; it must not silently overwrite a response that may have
    informed a later action.
-   Regenerate creates a new assistant response version.
-   Editing a prior user message creates a branch or a new message
    revision. It must not rewrite the meaning of an already executed
    action.
-   Tool calls and tool results are visible as expandable activity
    entries.
-   Failed and cancelled runs remain visible with their status.

### Acceptance criteria

-   A user can close and reopen the editor and restore a persisted
    session when persistence is enabled.
-   Switching documents never silently reuses the previous document's
    context.
-   A session clearly indicates which document it belongs to.
-   Deleting a session does not delete or modify the document.
-   Session persistence can be disabled by the embedder.

## 4.2 Context management

The assistant must expose what information is being sent to the model.

### Context sources

Support the following context types:

1.  Current selection.
2.  Surrounding text.
3.  Current paragraph.
4.  Current section or heading subtree.
5.  Whole document.
6.  Search results from the document.
7.  Explicitly selected document ranges.
8.  Selected table or table cells.
9.  User-attached files, when attachment support is enabled.
10. Embedder-supplied context sources.

Each context source should carry a type, label, source ID, revision and
retrieval metadata.

### Context selector

The composer should display a compact context selector, for example:

-   `Selection`
-   `This section`
-   `Entire document`
-   `Selected sources`

The user can inspect the active context before sending. The UI should
show a warning when context is truncated or when only retrieved excerpts
are included.

### Context budget

Replace the V1 fixed character-only approach with a token-aware budget.

Configuration:

``` ts
interface ContextBudget {
  maxInputTokens?: number;
  reservedOutputTokens?: number;
  systemPromptReserve?: number;
  historyStrategy?: 'recent' | 'summary' | 'hybrid';
  documentStrategy?: 'full' | 'retrieval' | 'hybrid';
  maxRetrievedChunks?: number;
}
```

Rules:

-   Respect the provider/model context limit when known.
-   Reserve output tokens before allocating document context.
-   Prefer the current selection and explicitly selected sources.
-   Include relevant nearby context for selection-based edits.
-   Use document retrieval for large documents.
-   Preserve headings and structural boundaries when chunking.
-   Never silently imply that the model saw the entire document if it
    received only excerpts.
-   Include a context manifest in run metadata for diagnostics and
    citation validation.

### Context privacy controls

-   User can exclude the current document from a session.
-   User can clear attached sources.
-   User can inspect the context summary before sending.
-   Embedders can disable whole-document context.
-   Context is not sent until the user initiates a request.
-   Do not include hidden comments, metadata or unrelated documents
    unless explicitly enabled.

## 4.3 Document search and navigation

Introduce a read-only document search service.

Capabilities:

-   Exact phrase search.
-   Case-sensitive and case-insensitive search.
-   Whole-word search.
-   Fuzzy/semantic search where an embedder provides an index.
-   Search within headings, paragraphs, tables and supported metadata.
-   Return multiple matching ranges.
-   Navigate to a result and highlight it.
-   Collect result ranges as context for a follow-up request.

Search results must include stable source identifiers and positions that
can be mapped through document operations.

Example user requests:

-   "Find every mention of the vendor."
-   "Where is the termination clause?"
-   "Show all paragraphs that mention payment."
-   "Find wording that conflicts with the introduction."

### Search result contract

``` ts
interface DocumentSearchQuery {
  query: string;
  scope?: 'document' | 'section' | 'selection' | 'table';
  match?: 'exact' | 'fuzzy' | 'semantic';
  caseSensitive?: boolean;
  limit?: number;
}

interface DocumentSearchResult {
  id: string;
  range: DocumentRange;
  excerpt: string;
  headingPath?: string[];
  score?: number;
  revision: number;
}
```

The core library should provide exact and basic fuzzy search if the
document model supports it. Semantic search is an optional capability
supplied by an embedder or separate package.

## 4.4 Grounded answers and citations

When answering questions about document content, the assistant should
cite the source ranges used.

A citation should contain:

-   Citation ID.
-   Document ID.
-   Stable range or anchor.
-   Excerpt.
-   Heading path or structural label.
-   Revision at retrieval time.
-   Optional page number if the editor has reliable pagination data.

UI behavior:

-   Render citations inline or in a Sources section.
-   Clicking a citation navigates to the relevant range.
-   Hovering a citation previews the excerpt.
-   Stale citations show that the source has changed.
-   A citation must never point to a range that cannot be resolved.
-   The assistant must distinguish direct evidence from inference.

Citation validation:

-   The runner validates that citation IDs refer to context sources
    returned to the model.
-   Unknown citation IDs are discarded and flagged.
-   The model cannot fabricate a source range by returning arbitrary
    offsets.
-   The client resolves positions from trusted context metadata, not
    model-supplied positions.

Example:

``` ts
interface DocumentCitation {
  id: string;
  sourceId: string;
  range: DocumentRange;
  excerpt: string;
  headingPath?: string[];
  revision: number;
}
```

## 4.5 Structured edit proposals

V2 introduces a canonical proposal format rather than relying
exclusively on plain-text replacement.

Supported operation types should initially include:

-   Replace text range.
-   Insert text at position.
-   Delete text range.
-   Insert paragraph(s).
-   Replace paragraph content.
-   Apply basic text formatting.
-   Create heading.
-   Create bullet or numbered list.
-   Insert a table from structured rows.
-   Update table cell text.
-   Move a supported block, if the editor command layer safely supports
    it.

The proposal layer must not mutate editor state directly.

### Proposal model

``` ts
type EditOperation =
  | { type: 'replaceText'; range: DocumentRange; text: string }
  | { type: 'insertText'; at: Position; text: string }
  | { type: 'deleteRange'; range: DocumentRange }
  | { type: 'insertBlocks'; at: Position; blocks: ProposedBlock[] }
  | { type: 'formatRange'; range: DocumentRange; format: TextFormat }
  | { type: 'replaceTableCells'; tableId: string; cells: ProposedCellChange[] };

interface EditProposal {
  id: string;
  sessionId: string;
  runId: string;
  title: string;
  summary?: string;
  operations: EditOperation[];
  sourceAnchors: SelectionAnchor[];
  createdAt: number;
  status: 'draft' | 'ready' | 'partially-applied' | 'applied' | 'rejected' | 'stale' | 'failed';
}
```

### Proposal review UI

Each proposal should show:

-   Short title and explanation.
-   Affected section/range.
-   Before and after content.
-   Added, removed and unchanged text.
-   Formatting changes where supported.
-   Warnings for stale or unsupported operations.
-   Accept, Reject and Edit controls.
-   Apply selected and Apply all where safe.

For large changes, show a summary first and allow the user to expand
individual changes.

### Apply semantics

-   Validate all anchors immediately before applying.
-   Apply only through editor commands and transactions.
-   Use a single transaction for a logically atomic proposal where
    feasible.
-   Apply multiple non-overlapping operations in safe document order.
-   Reject overlapping or ambiguous operations unless the command layer
    has a deterministic resolution.
-   If part of a proposal is stale, offer valid operations separately;
    do not silently skip them.
-   Preserve undo and collaboration semantics.
-   Never apply a proposal automatically after model output.

## 4.6 Review and tracked changes

V2 should provide a unified review experience.

-   If the editor's Suggesting mode is active, route edits through its
    existing suggestion mechanism.
-   If Suggesting mode is not active, show a preview before applying.
-   Optional setting: "Prefer tracked changes for AI edits."
-   Each AI proposal should be identifiable in the review UI.
-   Rejecting a proposal must leave the document unchanged.
-   Accepting a suggestion must use the editor's normal acceptance
    command.
-   Undo behavior must be consistent with existing editor transactions.

The assistant must not create a parallel change-tracking system if the
editor already provides one.

## 4.7 Multi-range and multi-selection tasks

Extend V1's queue into a general task collection.

Examples:

-   Rewrite three selected paragraphs independently.
-   Apply consistent terminology to multiple matches.
-   Summarize each selected section.
-   Translate multiple ranges while preserving their order.

Requirements:

-   Each task has a stable ID, anchor, instruction and status.
-   Tasks can be reordered, removed or edited before execution.
-   Tasks can optionally depend on another task.
-   The user can run all tasks or selected tasks.
-   Each result is associated with its original task.
-   Partial failures do not discard successful results.
-   Apply all is allowed only when operations are validated and
    non-conflicting.
-   Conflicts are surfaced for manual resolution.

Queue statuses:

`queued`, `running`, `ready`, `stale`, `failed`, `cancelled`, `applied`,
`rejected`.

## 4.8 Tables

V2 adds table-aware context and operations, subject to the editor's
table command capabilities.

Read operations:

-   Read table dimensions and cell values.
-   Summarize a table.
-   Explain columns and relationships.
-   Identify missing or inconsistent values.
-   Extract key facts.
-   Compare rows.
-   Answer questions about a selected range of cells.

Proposed operations:

-   Rewrite selected cells.
-   Normalize terminology or date formats.
-   Add a row or column.
-   Create a table from selected text or notes.
-   Convert a simple list into a table.
-   Generate a summary paragraph from a table.

Safety rules:

-   Never infer that a table is a spreadsheet with formulas unless the
    editor model supports formulas.
-   Preserve headers and table structure.
-   Validate row and column counts.
-   Do not overwrite cells outside the selected scope.
-   Preview all table mutations.
-   Large table operations should be split into reviewable batches.

## 4.9 Images and other non-text objects

If the editor and provider support it, allow users to ask about a
selected image.

Possible actions:

-   Describe image.
-   Extract visible text (OCR capability may be provider-dependent).
-   Explain a diagram.
-   Generate alt text.
-   Suggest a caption.

Requirements:

-   Image bytes or a supported image URL are sent only after explicit
    user action.
-   Respect size, MIME type and provider limits.
-   Do not send unrelated images in the document.
-   Clearly indicate when an image cannot be accessed or analyzed.
-   Image analysis is read-only in the first V2 release.
-   Do not generate or replace images as part of the initial V2 scope
    unless an image-generation adapter is separately implemented.

Other objects such as equations, charts, shapes and hyperlinks may
expose contextual read-only actions where the editor model provides
reliable data. Editing these objects is a later capability unless their
command APIs are already stable.

## 4.10 Attachments and external context

Optional attachment support for common formats:

-   `.txt`
-   `.md`
-   `.pdf`
-   `.docx`
-   `.csv`

Attachment processing should be provided by an embedder or optional
adapter package. The core editor should not gain mandatory parsing
dependencies.

User experience:

-   Add attachment from the composer.
-   Show filename, type, size and processing state.
-   Remove attachment before sending.
-   Choose whether to use the attachment as context.
-   Cite attachment excerpts separately from document citations.
-   Show parsing failures clearly.

Security:

-   Validate MIME type and file size.
-   Treat attachment contents as untrusted data.
-   Do not execute embedded content.
-   Do not upload files until the user sends a request that includes
    them.
-   Do not persist file bytes in chat history by default.
-   Provide configurable retention and cleanup.

------------------------------------------------------------------------

# 5. Agent architecture and tool system

## 5.1 Design principles

-   Tool calling is separate from provider adapters.
-   The model proposes tool calls; the client validates and authorizes
    them.
-   Tools have typed input and output schemas.
-   Each tool declares whether it is read-only or mutating.
-   The core tool set is small and document-specific.
-   Embedders can register additional tools.
-   No arbitrary code execution.
-   No tool can bypass editor commands or transactions.
-   All tool execution is cancellable and bounded.

## 5.2 Initial built-in tools

### Read-only tools

  -----------------------------------------------------------------------
  Tool                                Purpose
  ----------------------------------- -----------------------------------
  `get_document_info`                 Document title, revision, word
                                      count and structural summary

  `get_document_outline`              Heading hierarchy and section
                                      identifiers

  `get_document_text`                 Read a bounded document or section
                                      excerpt

  `search_document`                   Search for text and return anchored
                                      matches

  `get_selection`                     Read current selection or a
                                      captured anchor

  `get_block`                         Read a supported paragraph,
                                      heading, table or object

  `get_table`                         Read table structure and values

  `get_context_sources`               Return the active context manifest

  `get_document_metadata`             Read explicitly permitted metadata
  -----------------------------------------------------------------------

### Proposal tools

These create proposals, not direct mutations.

  -----------------------------------------------------------------------
  Tool                                Purpose
  ----------------------------------- -----------------------------------
  `propose_replace_range`             Propose replacement of an anchored
                                      range

  `propose_insert_blocks`             Propose insertion of structured
                                      blocks

  `propose_format_range`              Propose supported formatting
                                      changes

  `propose_table_update`              Propose changes to selected table
                                      cells

  `propose_document_changes`          Create a grouped proposal from
                                      multiple operations
  -----------------------------------------------------------------------

### Execution tools

Execution tools should normally be invoked by the runner after user
approval rather than exposed as unrestricted model tools.

  Tool                     Purpose
  ------------------------ -----------------------------------------
  `apply_proposal`         Apply a validated proposal
  `apply_proposal_items`   Apply selected valid operations
  `reject_proposal`        Reject a proposal
  `navigate_to_source`     Navigate to a trusted citation or range

## 5.3 Tool contract

``` ts
type ToolRisk = 'read' | 'proposal' | 'write' | 'external';

interface AiToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  risk: ToolRisk;
  requiresApproval: boolean;
  execute(
    input: TInput,
    context: ToolExecutionContext,
    signal: AbortSignal
  ): Promise<TOutput>;
}

interface ToolExecutionContext {
  documentId?: string;
  sessionId: string;
  runId: string;
  revision: number;
  permissions: AiPermissionSet;
  editor: AiEditorBridge;
  emit(event: AiRunEvent): void;
}
```

Use runtime validation for tool inputs and outputs. The schema
implementation must not require a new mandatory runtime dependency; a
small internal validator or optional schema adapter is acceptable.

## 5.4 Tool permissions

``` ts
interface AiPermissionSet {
  readDocument: boolean;
  searchDocument: boolean;
  readSelection: boolean;
  readTables: boolean;
  readImages: boolean;
  createProposals: boolean;
  applyProposals: boolean;
  accessAttachments: boolean;
  externalTools: boolean;
}
```

Defaults:

-   Read document: enabled when AI is enabled and user requests document
    context.
-   Search document: enabled.
-   Read selection: enabled after explicit selection-based action.
-   Read tables: enabled only when table context is selected or
    requested.
-   Read images: disabled unless explicitly enabled and selected.
-   Create proposals: enabled.
-   Apply proposals: requires explicit user action.
-   Attachments: disabled unless enabled by embedder.
-   External tools: disabled by default.

## 5.5 Approval policy

  -----------------------------------------------------------------------
  Operation                           Default policy
  ----------------------------------- -----------------------------------
  Read selected text                  No additional approval after user
                                      request

  Search document                     No additional approval after user
                                      request

  Read whole document                 User context choice or explicit
                                      request

  Create proposal                     Allowed; no document mutation

  Apply a single proposal             Explicit user click

  Apply multiple proposals            Explicit confirmation with
                                      affected-item count

  External tool                       Explicit permission and
                                      tool-specific approval

  Delete or move large content        Explicit confirmation and detailed
                                      preview

  Export, publish, send or share      Out of scope by default; embedder
                                      policy required
  -----------------------------------------------------------------------

Approval must be bound to the exact proposal version and affected
ranges. If the proposal changes after approval, approval is invalidated.

## 5.6 Agent loop

The agent runner manages the following lifecycle:

1.  Validate the user request and active session.
2.  Resolve the selected mode and permissions.
3.  Build a bounded context manifest.
4.  Send the request to the configured provider.
5.  Parse text and tool-call events.
6.  Validate each proposed tool call against the registry.
7.  Enforce permission and execution limits.
8.  Execute approved read-only tools.
9.  Return tool results to the model.
10. Repeat until the model responds, the run is cancelled, or a limit is
    reached.
11. Convert any requested mutations into edit proposals.
12. Present the answer, citations, plan or proposals.
13. Wait for user approval before applying document changes.
14. Record a run summary.

The agent loop must have configurable limits:

``` ts
interface AgentLimits {
  maxToolCalls?: number;        // default 12
  maxIterations?: number;       // default 6
  maxRunDurationMs?: number;    // default 120_000
  maxToolOutputChars?: number;  // default 20_000
  maxParallelTools?: number;    // default 3
}
```

Defaults are safety ceilings, not targets. Tool calls should run
sequentially when ordering or document revision matters. Parallel
execution is permitted only for independent read-only operations.

## 5.7 Tool-call security

-   Tool names must be looked up in the registered tool catalog; never
    dynamically import a model-provided name.
-   Validate arguments before execution.
-   Reject unknown tools and unsupported fields.
-   Enforce permissions on every call, not only at prompt construction.
-   Tool output is untrusted data when returned to the model.
-   Apply output size limits and redact sensitive fields.
-   Do not allow model-supplied document IDs to override the active
    session's scope.
-   Revalidate document revision and anchors before mutations.
-   Abort all active tools when the user stops a run.
-   Record a redacted audit event for each tool invocation.

------------------------------------------------------------------------

# 6. Planning and multi-step workflows

## 6.1 Plan-first execution

For tasks that require multiple operations, the assistant should produce
a plan before execution.

A plan includes:

-   Goal.
-   Ordered steps.
-   Tools required.
-   Document areas affected.
-   Read-only versus proposal steps.
-   Estimated scope.
-   Risks and assumptions.
-   Approval requirements.

Example:

**User:** "Review this document for inconsistent terminology and propose
corrections."

**Plan:** 1. Read the document outline. 2. Search for terminology
variants. 3. Group likely equivalent terms. 4. Show the occurrences and
evidence. 5. Create replacement proposals. 6. Ask the user to review and
apply the changes.

The user may approve the entire plan, approve selected steps or cancel.

## 6.2 Plan model

``` ts
interface AgentPlan {
  id: string;
  runId: string;
  goal: string;
  steps: AgentPlanStep[];
  status: 'draft' | 'awaiting-approval' | 'approved' | 'running' |
          'completed' | 'partially-completed' | 'cancelled' | 'failed';
}

interface AgentPlanStep {
  id: string;
  title: string;
  description: string;
  toolNames: string[];
  risk: ToolRisk;
  requiresApproval: boolean;
  status: 'pending' | 'running' | 'completed' | 'skipped' |
          'failed' | 'cancelled';
  resultSummary?: string;
}
```

## 6.3 Execution behavior

-   The plan is immutable once execution starts; changes create a new
    plan revision.
-   A failed step blocks dependent steps.
-   Independent read-only steps may run in parallel within limits.
-   The user can pause or cancel execution.
-   The runner reports progress and the current step.
-   Partial completion is retained.
-   Mutating steps produce proposals for review.
-   A plan cannot silently gain new permissions during execution.
-   If new scope is needed, pause and ask the user.

## 6.4 Reusable task presets

Provide built-in presets:

-   Summarize document.
-   Create executive summary.
-   Improve clarity and readability.
-   Proofread selected section.
-   Check consistency.
-   Extract action items.
-   Extract dates and deadlines.
-   Identify risks and open questions.
-   Compare two sections.
-   Convert notes into structured content.
-   Create FAQ from document.
-   Translate selected content.
-   Review table data.

Presets should be defined as data/configuration, not hard-coded UI
branches. Embedders can add their own presets and localized labels.

------------------------------------------------------------------------

# 7. Provider and model layer V2

## 7.1 Preserve the provider abstraction

Provider adapters remain responsible for protocol details only:

-   Authentication.
-   Request serialization.
-   Streaming.
-   Tool-call serialization and parsing.
-   Usage metadata.
-   Provider-specific error mapping.
-   Capability reporting.

The agent runner, tool registry, permissions and proposal system must
remain provider-independent.

## 7.2 Capability discovery

``` ts
interface ModelCapabilities {
  streaming: boolean;
  toolCalling: boolean;
  jsonMode: boolean;
  vision: boolean;
  maxContextTokens?: number;
  maxOutputTokens?: number;
}
```

If capabilities are unknown, treat them as unsupported until configured
or confirmed. Do not assume every model behind an OpenAI-compatible
endpoint implements the same tool-call or JSON behavior.

## 7.3 Model profiles

Allow users or embedders to define model profiles:

-   Fast chat model.
-   High-quality writing model.
-   Long-context model.
-   Vision-capable model.
-   Tool-capable model.

A profile can specify a provider/model pair and capability overrides.
Automatic routing is optional and must be transparent.

## 7.4 Model routing

Optional routing policy:

-   Simple Q&A → fast model.
-   Long-document synthesis → long-context model.
-   Structured tool execution → tool-capable model.
-   Image analysis → vision-capable model.
-   Final polish → high-quality writing model.

Rules:

-   Never switch providers without showing the user the active model.
-   Do not silently send document content to a different provider.
-   Allow users to disable automatic routing.
-   Respect embedder allowlists and privacy policy.
-   Keep credentials separate per provider.

## 7.5 Structured output

Use structured output where supported, with a validation and repair
strategy.

-   Prefer provider-native JSON mode or schema-constrained output when
    reliable.
-   Validate all output locally.
-   Allow one bounded repair attempt for malformed output.
-   Never treat unvalidated model JSON as an editor command.
-   On repeated failure, show the raw response as an error detail only
    when safe and useful.

## 7.6 Usage and cost metadata

Where provided, capture:

-   Input tokens.
-   Output tokens.
-   Cached tokens.
-   Provider request ID.
-   Model ID.
-   Duration.
-   Tool-call count.
-   Estimated cost only if a trusted pricing configuration is supplied.

Usage data is informational. Never invent cost values or infer provider
billing from token counts alone.

------------------------------------------------------------------------

# 8. Public API and integration contracts

## 8.1 Backward-compatible configuration

Extend the existing `AiOptions` without changing the meaning of existing
fields.

``` ts
interface AiOptions {
  enabled: boolean;
  panel?: {
    defaultOpen?: boolean;
    minWidth?: number;
    maxWidthRatio?: number;
  };
  provider?: Partial<ProviderConfig>;
  transport?: AiTransport;
  showSettings?: boolean;

  sessions?: {
    enabled?: boolean;
    storage?: AiSessionStorage;
    maxSessions?: number;
    persistMessages?: boolean;
  };

  context?: {
    maxInputTokens?: number;
    maxDocumentChars?: number;
    allowWholeDocument?: boolean;
    retrieval?: 'off' | 'local' | 'embedder';
  };

  agent?: {
    enabled?: boolean;
    defaultMode?: 'ask' | 'suggest' | 'act';
    permissions?: Partial<AiPermissionSet>;
    limits?: Partial<AgentLimits>;
    requirePlanForMultiStep?: boolean;
  };

  attachments?: {
    enabled?: boolean;
    maxFileSizeBytes?: number;
    acceptedTypes?: string[];
    processor?: AttachmentProcessor;
  };

  tools?: AiToolDefinition[];
  prompts?: AiPromptPreset[];
  strings?: Partial<AiStrings>;
  onEvent?: (event: AiRunEvent) => void;
}
```

`agent.enabled` should default to `false` for existing V1 integrations.
Enabling V2 capabilities must be an explicit opt-in until the embedder
has configured permissions and reviewed the new behavior.

## 8.2 Editor bridge

Keep the AI layer independent from internal editor implementation
details through a narrow bridge.

``` ts
interface AiEditorBridge {
  getDocumentInfo(): DocumentInfo;
  getOutline(): DocumentOutline;
  getText(range?: DocumentRange): string;
  getSelection(): SelectionSnapshot | null;
  search(query: DocumentSearchQuery): DocumentSearchResult[];

  resolveAnchor(anchor: SelectionAnchor): ResolvedAnchor;
  createProposal(proposal: EditProposal): Promise<ProposalValidation>;
  applyProposal(proposalId: string, options?: ApplyOptions): Promise<ApplyResult>;
  navigateTo(range: DocumentRange): void;
}
```

The actual API should reuse existing editor commands, position mapping,
transactions and document model types. Do not duplicate those
abstractions inside `ai/`.

## 8.3 Transport contract

Transport must support tool-capable requests without coupling the client
to a specific backend protocol.

``` ts
interface AiRequest {
  requestId: string;
  sessionId: string;
  runId: string;
  provider?: ProviderConfig;
  model: string;
  messages: ChatMessage[];
  tools?: AiToolDescriptor[];
  responseFormat?: 'text' | 'json';
  metadata?: Record<string, string>;
}

type AiTransport = (
  request: AiRequest,
  signal: AbortSignal
) => AsyncIterable<StreamEvent>;
```

The embedder transport must be able to authenticate the current user on
its own backend. Do not send browser-held provider secrets when
transport mode is enabled.

## 8.4 Extension points

Expose registration for:

-   Tools.
-   Prompt presets.
-   Context providers.
-   Attachment processors.
-   Model profiles.
-   Localization strings.
-   Event observers.
-   Optional retrieval providers.

Extensions must declare capabilities and permissions. Extension failure
must not crash the editor.

------------------------------------------------------------------------

# 9. Persistence and data lifecycle

## 9.1 Storage abstraction

Do not couple session storage to `localStorage` only.

``` ts
interface AiSessionStorage {
  list(query?: SessionQuery): Promise<AiSessionSummary[]>;
  load(sessionId: string): Promise<AiSession | null>;
  save(session: AiSession): Promise<void>;
  delete(sessionId: string): Promise<void>;
}
```

Provide a small local storage implementation for simple deployments.
Embedders may provide IndexedDB or server-backed storage.

## 9.2 Versioned schema

Use explicit schema versions for settings, sessions, messages and
proposals.

-   Migrate V1 settings without losing provider keys.
-   Preserve existing session data if its format is compatible.
-   Unknown fields should be ignored safely.
-   Invalid records should be quarantined or skipped with a diagnostic.
-   Migration must not modify document content.

## 9.3 Retention and cleanup

-   Configurable maximum session count.
-   Configurable message retention.
-   Delete attachment bytes after processing unless retention is
    explicitly enabled.
-   Clear temporary context and tool output after the run when not
    needed.
-   Provide a clear-session and clear-all-AI-data action.
-   Do not delete user documents when clearing AI data.

## 9.4 Persistence security

-   Treat browser storage as accessible to scripts running on the same
    origin.
-   Never store provider secrets in session records.
-   Allow embedders to disable local key storage.
-   Avoid persisting raw document context by default.
-   Provide a server-backed storage option for hosted deployments.
-   Redact keys, tokens, attachment contents and sensitive excerpts from
    diagnostics.

------------------------------------------------------------------------

# 10. Security, privacy and trust

## 10.1 Threat model

V2 introduces tools and persistent sessions, so the threat model must
expand beyond V1 prompt injection.

Threats include:

-   Prompt injection in document text or attachments.
-   Malicious tool-call arguments.
-   Cross-document context leakage.
-   Stale or malicious anchors.
-   Unauthorized mutation attempts.
-   XSS exposure of local API keys.
-   Oversized or malformed provider responses.
-   Tool loops and excessive provider usage.
-   Sensitive data leaking through logs or telemetry.
-   Malicious custom tools registered by an embedder.

## 10.2 Trust boundaries

Treat each source as untrusted unless validated:

-   Document text.
-   Comments and metadata.
-   Attachments.
-   Provider output.
-   Tool output.
-   Custom tool results.
-   Persisted session records.

The system prompt is not a security boundary. Enforcement must happen in
code.

## 10.3 Required controls

-   Permission checks in the runner and each tool.
-   Strict schema validation.
-   Tool allowlist.
-   Active document/session scope checks.
-   Bounded loops and output sizes.
-   Abort support.
-   Anchor and revision validation.
-   Explicit apply confirmation.
-   Redacted logging.
-   Attachment validation.
-   No arbitrary code execution.
-   No hidden external network calls.
-   Clear indication of the provider receiving context.

## 10.4 Privacy disclosure

Settings and context UI must explain:

-   Which provider receives requests.
-   Which document context is included.
-   Whether attachments are included.
-   Whether the session is persisted locally or remotely.
-   Whether the embedder uses a server-side transport.
-   Whether the provider may retain data according to its own terms.

Do not promise that a provider does not retain data unless that claim is
backed by the provider's current terms and the embedder's configuration.

------------------------------------------------------------------------

# 11. UI and accessibility requirements

## 11.1 Workspace navigation

-   Session history is keyboard accessible.
-   Current document association is visible.
-   Context selector is accessible and announces changes.
-   Mode selector communicates Ask, Suggest and Act.
-   Tool activity can be expanded and collapsed.
-   Plans and proposals expose progress and status.

## 11.2 Streaming and run status

Show distinct states:

-   Preparing context.
-   Thinking.
-   Searching document.
-   Calling a tool.
-   Waiting for approval.
-   Preparing proposal.
-   Applying changes.
-   Completed.
-   Cancelled.
-   Failed.

Avoid presenting every internal model token or implementation detail as
user-facing activity.

## 11.3 Accessibility

-   Maintain labeled regions and live regions.
-   Announce meaningful status changes, not every token.
-   Keep keyboard focus stable when tool cards appear.
-   Provide keyboard access to citation navigation and proposal review.
-   Ensure color is not the only signal for status or diff changes.
-   Respect reduced-motion preferences.
-   Support focus restoration to the editor and selection.
-   Preserve the IME proxy protections from V1.

## 11.4 Responsive behavior

-   Desktop: docked panel.
-   Narrow viewport: full-width panel or bottom sheet.
-   Mobile: context and proposal cards use stacked layouts.
-   Popovers must remain within the viewport.
-   Long plans and tool output must be scrollable without affecting the
    canvas.
-   Touch targets must meet accessible sizing guidance.

## 11.5 Localization and theming

-   All new strings use the existing `aiStrings` mechanism.
-   Prompt presets and tool labels can be localized.
-   Tool names remain stable identifiers; descriptions are localizable.
-   Support editor light and dark themes.
-   Diff states must remain distinguishable in both themes.

------------------------------------------------------------------------

# 12. Error handling and recovery

## 12.1 Error categories

Extend V1 errors with:

-   `auth`
-   `rate_limit`
-   `network`
-   `cors`
-   `model`
-   `context_limit`
-   `invalid_response`
-   `tool_not_found`
-   `tool_invalid_input`
-   `tool_permission_denied`
-   `tool_timeout`
-   `anchor_stale`
-   `revision_conflict`
-   `proposal_invalid`
-   `storage`
-   `attachment`
-   `cancelled`
-   `unknown`

## 12.2 Recovery behavior

-   Provider network errors: Retry.
-   Rate limit: Show provider message and optional retry guidance.
-   Context too large: Offer a narrower context or retrieval-based
    retry.
-   Tool failure: Show failed step and allow retry if safe.
-   Invalid model output: One bounded repair attempt, then fail
    gracefully.
-   Stale anchor: Do not apply; offer regenerate against current
    content.
-   Revision conflict: Revalidate and present a new preview.
-   Storage failure: Keep the current session in memory and explain that
    it could not be persisted.
-   Cancelled run: Preserve completed read-only results; discard
    incomplete proposal output unless it is safe to retain as a draft.

## 12.3 No false success

A proposal is not applied until the editor confirms the transaction
succeeded. A tool is not completed until its execution promise resolves
successfully. The UI must distinguish generated, validated, approved and
applied states.

------------------------------------------------------------------------

# 13. Observability and diagnostics

Provide optional event hooks with redacted metadata.

``` ts
type AiRunEvent =
  | { type: 'run.started'; runId: string; sessionId: string }
  | { type: 'context.ready'; runId: string; sourceCount: number; tokenEstimate?: number }
  | { type: 'tool.started'; runId: string; toolName: string; callId: string }
  | { type: 'tool.completed'; runId: string; toolName: string; callId: string; durationMs: number }
  | { type: 'tool.failed'; runId: string; toolName: string; callId: string; code: string }
  | { type: 'plan.created'; runId: string; planId: string; stepCount: number }
  | { type: 'proposal.created'; runId: string; proposalId: string; operationCount: number }
  | { type: 'proposal.applied'; runId: string; proposalId: string }
  | { type: 'run.completed'; runId: string; durationMs: number }
  | { type: 'run.cancelled'; runId: string }
  | { type: 'run.failed'; runId: string; code: string };
```

Do not include raw prompts, document text, API keys, attachment bytes or
unredacted provider payloads in default events.

Diagnostics view (optional, developer mode):

-   Provider and model.
-   Run ID.
-   Context source types and sizes.
-   Tool names and durations.
-   Iteration count.
-   Token usage when available.
-   Error category.
-   Proposal status.

The diagnostics view must not reveal secrets.

------------------------------------------------------------------------

# 14. Performance requirements

-   V2 remains lazy-loaded and opt-in.
-   No provider calls or listeners when AI is disabled.
-   No full-document serialization on every keystroke.
-   Cache document outline and text indexes by document revision.
-   Invalidate only affected cache regions where the editor's change
    model permits.
-   Retrieval should operate on indexed/chunked content for large
    documents.
-   Streaming updates must not trigger canvas paint or document
    relayout.
-   Tool outputs are bounded.
-   Large proposals are virtualized or paginated in the UI.
-   Search and context preparation should be cancellable.
-   A 1,000-page stress document must remain responsive while the AI
    panel streams or displays tool activity.

Performance targets should be measured against the existing stress
harness rather than assumed from implementation estimates.

------------------------------------------------------------------------

# 15. Testing strategy

## 15.1 Unit tests

### Context and retrieval

-   Selection precedence.
-   Section extraction.
-   Heading hierarchy.
-   Whole-document truncation.
-   Token budget allocation.
-   Retrieval ranking and chunk boundaries.
-   Context manifest generation.
-   Cross-document isolation.

### Search and citations

-   Exact and fuzzy search.
-   Multiple matches.
-   Position mapping after edits.
-   Citation validation.
-   Unknown citation rejection.
-   Stale citation behavior.

### Tools and agent loop

-   Tool registration and duplicate names.
-   Input/output schema validation.
-   Permission enforcement.
-   Unknown tool rejection.
-   Tool iteration limit.
-   Timeout and cancellation.
-   Tool output size limit.
-   Sequential versus parallel execution.
-   Prompt-injection content treated as data.
-   Active document scope enforcement.

### Proposals

-   Proposal validation.
-   Stale anchor detection.
-   Overlap detection.
-   Reverse-order range application where needed.
-   Single transaction behavior.
-   Partial application.
-   Undo restores the exact prior state.
-   Suggesting-mode routing.
-   Table cell boundary validation.

### Sessions

-   Create, rename, archive, restore and delete.
-   Storage adapter failure.
-   Migration from V1 settings.
-   Corrupt record handling.
-   Session/document association.
-   No secrets in persisted session data.

### Providers

-   Streaming and tool-call parsing.
-   JSON mode behavior.
-   Malformed tool-call payload.
-   Unsupported capability fallback.
-   Usage metadata.
-   Abort and error mapping.

## 15.2 Browser tests

1.  Open existing V1 chat and verify no regression.
2.  Create, rename, close and restore a session.
3.  Switch documents and verify context isolation.
4.  Ask a question about a section and navigate through a citation.
5.  Search document and open a matching result.
6.  Ask for a rewrite and review the diff before applying.
7.  Reject a proposal and verify document unchanged.
8.  Apply a proposal and verify one undo restores content.
9.  Run a multi-step read-only plan.
10. Run a plan that creates proposals and approve only selected changes.
11. Trigger a tool permission denial.
12. Trigger a tool timeout and cancel a run.
13. Edit the document while a proposal is pending and verify stale
    handling.
14. Analyze a selected table and preview a cell update.
15. Attach a supported file and cite an excerpt.
16. Verify no attachment bytes are persisted when retention is disabled.
17. Verify provider/model capability fallback.
18. Verify keyboard navigation, focus restoration and IME safety.
19. Verify responsive panel and proposal cards.
20. Run the 1,000-page stress test during streaming and retrieval.

## 15.3 Security tests

-   Prompt injection in document body.
-   Prompt injection in attachment.
-   Tool name spoofing.
-   Invalid schema payloads.
-   Cross-document session replay.
-   Model-supplied arbitrary offsets.
-   Stale anchor mutation.
-   Oversized tool result.
-   Infinite tool loop attempt.
-   API key redaction.
-   Malicious custom tool failure isolation.
-   Unauthorized proposal application.
-   Changed proposal after approval.
-   Storage record tampering.

## 15.4 Provider integration tests

Use mocked provider tests in CI. Maintain an optional manual integration
suite for at least:

-   One OpenAI-compatible hosted endpoint.
-   One Anthropic endpoint.
-   One Gemini endpoint.
-   One local OpenAI-compatible server.

Never require live provider credentials in the default CI pipeline.

------------------------------------------------------------------------

# 16. Phased delivery plan

V2 should be delivered incrementally. Do not implement all advanced
capabilities in one release.

  -----------------------------------------------------------------------
  Phase                   Scope                   Exit criteria
  ----------------------- ----------------------- -----------------------
  **V2.0 --- Foundation** Session storage         Existing V1 flows pass;
                          abstraction, versioned  sessions can be
                          schemas, context        restored; settings
                          manifest, capability    migrate
                          model, event types      

  **V2.1 --- Document     Document outline,       Grounded Q&A returns
  intelligence**          search, section         validated citations
                          context, citations and  
                          navigation              

  **V2.2 --- Review       Structured proposals,   Proposals can be
  experience**            diff UI, conflict       accepted/rejected; undo
                          detection, review and   and Suggesting mode
                          apply                   work

  **V2.3 --- Tool         Tool registry,          Read-only tools work
  system**                permission policy,      under policy; invalid
                          agent loop, limits and  calls are rejected
                          cancellation            

  **V2.4 --- Plans and    Plan-first multi-step   User can approve a plan
  workflows**             tasks, progress,        and review generated
                          partial retry and       proposals
                          presets                 

  **V2.5 --- Rich         Table analysis and      Table operations are
  document content**      operations; selected    previewed and safe;
                          image analysis if       image capability is
                          supported               explicit

  **V2.6 --- Attachments  Optional file           Attachments are opt-in,
  and integrations**      processors, embedder    bounded and correctly
                          context providers and   cited
                          custom tools            

  **V2.7 --- Hardening**  Security,               Definition of Done met
                          accessibility,          
                          performance, docs,      
                          examples and migration  
                          validation              
  -----------------------------------------------------------------------

## 16.1 Recommended release boundaries

-   V2.0--V2.2 should deliver value without enabling autonomous tool
    execution.
-   V2.3 introduces the tool system but keeps write execution behind
    proposal approval.
-   V2.4 introduces multi-step orchestration.
-   V2.5 and V2.6 depend on editor model support and optional adapters.
-   Do not block core V2 on vision, semantic search or file parsing.

------------------------------------------------------------------------

# 17. Definition of Done

## Compatibility

-   [ ] All V1 acceptance criteria continue to pass.
-   [ ] Existing public API usage remains valid or has a documented
    migration.
-   [ ] `agent.enabled` is opt-in for existing integrations.
-   [ ] Existing provider settings and keys are migrated safely.

## Architecture

-   [ ] Provider, runner, tools, context, proposals and UI remain
    separate modules.
-   [ ] Tool calls cannot bypass the permission policy.
-   [ ] All mutations use editor commands and transactions.
-   [ ] No mandatory runtime dependency is added.
-   [ ] AI remains lazy-loaded and disabled by default.

## User experience

-   [ ] Sessions can be managed and restored when enabled.
-   [ ] Context is visible and inspectable.
-   [ ] Document answers can cite trusted source ranges.
-   [ ] Proposed edits show a reviewable diff.
-   [ ] Multi-step plans show scope, progress and approval state.
-   [ ] Cancellation and partial failure are understandable.

## Safety and privacy

-   [ ] No document mutation occurs without explicit approval.
-   [ ] Approval is invalidated if the proposal changes.
-   [ ] Stale anchors and revision conflicts are handled safely.
-   [ ] Cross-document context leakage tests pass.
-   [ ] No secrets or raw document contents appear in default logs.
-   [ ] Attachments and external tools are opt-in.
-   [ ] Prompt injection cannot grant permissions or bypass validation.

## Quality

-   [ ] Typecheck and test suites pass across workspaces.
-   [ ] Browser scenarios pass.
-   [ ] Security tests pass.
-   [ ] 1,000-page stress test has no unacceptable regression.
-   [ ] Keyboard, screen-reader and responsive checks pass.
-   [ ] Documentation and examples are updated.
-   [ ] Changelog records the V2 feature set and migration notes.

------------------------------------------------------------------------

# 18. Proposed module structure

The exact folder layout should follow the current V1 implementation
rather than force a disruptive reorganization. A possible target
structure:

``` text
frontend/src/ai/
├── index.ts
├── api/
│   ├── options.ts
│   ├── editorBridge.ts
│   └── events.ts
├── providers/
│   ├── types.ts
│   ├── registry.ts
│   ├── capabilities.ts
│   └── adapters/
├── sessions/
│   ├── types.ts
│   ├── store.ts
│   ├── storage.ts
│   └── migrations/
├── context/
│   ├── types.ts
│   ├── builder.ts
│   ├── budget.ts
│   ├── retrieval.ts
│   └── manifest.ts
├── document/
│   ├── search.ts
│   ├── outline.ts
│   ├── citations.ts
│   └── anchors.ts
├── agent/
│   ├── runner.ts
│   ├── planner.ts
│   ├── limits.ts
│   ├── permissions.ts
│   └── events.ts
├── tools/
│   ├── types.ts
│   ├── registry.ts
│   ├── validation.ts
│   └── builtins/
├── proposals/
│   ├── types.ts
│   ├── builder.ts
│   ├── validator.ts
│   ├── diff.ts
│   └── apply.ts
├── attachments/
│   ├── types.ts
│   └── processor.ts
└── ui/
    ├── workspace.ts
    ├── sessionHistory.ts
    ├── contextSelector.ts
    ├── modeSelector.ts
    ├── planView.ts
    ├── toolActivity.ts
    ├── proposalReview.ts
    ├── citationView.ts
    └── ...
```

Do not split modules prematurely. Keep the implementation aligned with
existing package boundaries and avoid circular dependencies.

------------------------------------------------------------------------

# 19. V1-to-V2 migration and implementation audit

Because V1 is already implemented, the first engineering task is not to
rebuild the feature. It is to audit the implementation against this
specification.

Create a baseline report with these columns:

  -----------------------------------------------------------------------------------
  Area           V1 implementation     V2 extension   Compatibility   Verification
                                                      risk            
  -------------- --------------------- -------------- --------------- ---------------
  Provider       Record actual         Capability     Medium          Adapter tests
  adapters       adapters              reporting and                  
                                       tool calls                     

  Chat panel     Record current        Sessions,      Medium          Browser tests
                 UI/state              modes and                      
                                       activity                       

  Selection      Record mapping        Multi-range    High            Mapping tests
  anchors        implementation        and citation                   
                                       anchors                        

  Queue          Record queue behavior Typed task     Medium          Runner tests
                                       collection and                 
                                       partial retry                  

  Apply flow     Record                Structured     High            Undo/conflict
                 command/transaction   proposal                       tests
                 integration           operations                     

  Settings       Record schema/storage Versioned      Medium          Migration tests
                                       migration and                  
                                       model profiles                 

  Transport      Record current        Tool-capable   High            Contract tests
                 contract              request events                 

  Persistence    Record current        Session        Medium          Storage tests
                 behavior              storage                        
                                       abstraction                    
  -----------------------------------------------------------------------------------

### Required audit outputs

1.  Actual V1 public API and defaults.
2.  Actual module and dependency map.
3.  Existing editor commands that support each proposed operation.
4.  Position mapper and selection-anchor guarantees.
5.  Existing transaction and Suggesting-mode behavior.
6.  Current provider protocol coverage.
7.  Current persistence and migration behavior.
8.  Missing tests and known limitations.
9.  A prioritized implementation backlog with dependencies.

Do not assume the V1 module map or type signatures in the original spec
match the shipped code.

------------------------------------------------------------------------

# 20. Open product and engineering decisions

Resolve these during the V2.0 audit, not by guessing in implementation:

1.  **Session storage default:** localStorage, IndexedDB or in-memory by
    default?
2.  **Session association:** one session per document, multiple sessions
    per document, or both?
3.  **Chat retention:** should messages persist by default in a
    standalone library?
4.  **Agent default:** should V2 ship with Ask mode only, or Ask and
    Suggest enabled?
5.  **Plan approval:** require approval for every multi-step plan or
    only plans containing mutating work?
6.  **Diff representation:** reuse existing Suggesting overlay, build a
    proposal preview, or combine both?
7.  **Citation stability:** can existing bookmarks/anchors provide
    stable citations across all supported operations?
8.  **Semantic retrieval:** built-in local retrieval, embedder adapter,
    or defer semantic retrieval?
9.  **Table support:** which table commands and structural operations
    are already implemented?
10. **Image access:** can the editor expose image bytes safely without
    changing the document model?
11. **Attachment parsing:** which formats should the hosted demo
    support, and where should parsing occur?
12. **Provider routing:** user-selected model only, or optional model
    profiles and routing?
13. **Hosted deployment:** require server-side transport for hosted
    demos, or allow personal browser keys with a clear warning?
14. **Telemetry:** should usage events be entirely embedder-owned?
15. **Localization:** should prompt presets and tool descriptions be
    fully overrideable?

------------------------------------------------------------------------

# 21. Recommended V2 MVP

The complete V2 roadmap is intentionally broad. The recommended first V2
release should focus on the highest-value improvements with the lowest
architectural risk:

1.  Persistent document-associated chat sessions.
2.  Context selector for selection, section and whole document.
3.  Document outline and search tools.
4.  Grounded answers with clickable citations.
5.  Structured edit proposals with diff preview.
6.  Safe accept/reject and undo.
7.  A typed read-only tool registry.
8.  Run events and diagnostics.

Defer autonomous multi-step execution, attachments, image analysis,
semantic retrieval and broad table mutation until the foundational
capabilities are stable.

**V2 MVP acceptance scenario:**

A user opens a large document, starts an AI session, asks "What are the
main risks in this agreement?", receives a concise answer with
citations, clicks a citation to navigate to the source, asks "Make the
risk section clearer", reviews a structured diff, applies the proposal,
and uses one undo action to restore the original content. The session is
restored after reopening the editor, and no content is sent to a
provider until the user explicitly submits a request.

------------------------------------------------------------------------

# 22. Final architectural principle

V2 should make the assistant more capable without making the editor less
predictable.

The model is responsible for understanding language and proposing
intent. The AI runtime is responsible for context, planning, validation,
permissions and orchestration. The editor remains the sole authority for
document state and mutations.

**The model proposes. The runtime validates. The user approves. The
editor commits.**


---

# 23. Professional UI and product-quality design system

A professional interface is a product requirement, not a final visual polish task. V2 must feel like a cohesive, production-grade writing application rather than a collection of AI demo widgets. The AI workspace should visually belong to canvas-word and respect its existing editor design language, while establishing consistent patterns for every new AI surface.

## 23.1 Design goals

The UI must be:

- **Calm and focused:** document editing remains the primary activity; AI controls should not compete with the page.
- **Precise and trustworthy:** clearly distinguish suggestions, confirmed actions, tool activity, errors and applied changes.
- **Consistent:** the panel, popovers, dialogs, menus, cards and settings use the same spacing, typography, borders, radii and interaction patterns.
- **Information-dense without clutter:** advanced capabilities are discoverable but do not overwhelm the default experience.
- **Responsive:** layouts adapt intentionally to desktop, narrow windows, tablets and touch devices.
- **Accessible:** keyboard, screen-reader, contrast, focus and reduced-motion behavior are designed in, not retrofitted.
- **Native to the editor:** reuse existing tokens and primitives wherever possible; do not introduce a visually unrelated mini-application.

## 23.2 Visual language and design tokens

Before implementing new screens, audit the editor's existing design tokens and component conventions. Extend them rather than hard-coding a second design system.

Define or reuse semantic tokens for:

- Typography: font family, scale, weight, line height and letter spacing.
- Spacing: a consistent base spacing scale.
- Surfaces: editor, panel, elevated card, popover, modal and muted surface.
- Borders: default, subtle, strong, focus and destructive.
- Text: primary, secondary, muted, inverse and disabled.
- Status: success, warning, error, information and neutral.
- Interactive states: hover, pressed, selected, focused and disabled.
- Elevation: restrained shadows for popovers, menus and dialogs.
- Motion: short transitions for hover, open/close and status changes.

Requirements:

- Use semantic CSS variables/tokens, not repeated literal color values.
- Support light and dark themes.
- Meet WCAG 2.2 AA contrast targets for text and meaningful UI elements.
- Never communicate state using color alone.
- Use a restrained accent color consistent with canvas-word branding.
- Avoid excessive gradients, glowing borders, decorative animations and oversized empty cards.
- Use consistent iconography from one icon set; icons must have accessible names when they convey meaning.
- Avoid emoji as substitutes for functional icons in the product UI.

## 23.3 Layout and hierarchy

### AI workspace

Use a clear hierarchy:

1. **Workspace header:** AI identity, model indicator, session actions and close.
2. **Session/context identity:** current document and active context, visible without dominating the header.
3. **Conversation:** readable message rhythm, restrained message styling and clear separation of user content, assistant content and system activity.
4. **Activity and results:** tool calls, citations, plans and proposals appear as structured, collapsible elements.
5. **Composer:** persistent, visually distinct input area with mode and context controls.
6. **Optional history navigation:** searchable session list that does not consume the conversation's usable width unnecessarily.

The conversation should use readable line lengths and predictable vertical spacing. Long answers, code, tables and citations must remain legible inside the panel.

### Selection popover

- Keep the existing selection anchored interaction compact and task-focused.
- Use consistent alignment, spacing and button hierarchy.
- Make the selected text preview readable and clearly secondary to the instruction.
- Avoid chip overflow; wrap or scroll predictably.
- Keep primary and secondary actions visually distinct.
- Do not cover the selected text more than necessary.

### Plans and proposals

- Plans should read as a concise task checklist with step status and progress.
- Proposals should have a strong title, short rationale, affected-range label and clear review actions.
- Diff presentation must distinguish additions, removals and unchanged context using both color and labels.
- Large proposals should collapse by section and allow individual operations to be reviewed.
- Stale, conflicting and partially applicable changes must have explicit explanations and next actions.

### Settings

Organize settings into clear groups or tabs:

- Provider and credentials.
- Model and model capabilities.
- Thinking effort / reasoning controls.
- Connection and advanced endpoint options.
- Privacy and context.
- Session storage and retention.
- Agent permissions and limits.

Do not place every advanced option in the initial visible form. Use progressive disclosure with concise explanations and sensible defaults.

## 23.4 Component quality requirements

All AI UI components must define and test:

- Default state.
- Hover, focus, pressed and disabled states.
- Loading state.
- Empty state.
- Success state.
- Error state.
- Long-content and overflow behavior.
- Keyboard behavior.
- Dark theme behavior.
- Narrow viewport behavior.

Use shared components for buttons, icon buttons, tooltips, inputs, selects, badges, dialogs, menus, cards, skeletons, alerts and confirmation surfaces. Avoid slightly different one-off implementations across features.

Buttons must use consistent labels and hierarchy:

- Primary: the main action in the current surface.
- Secondary: a safe alternative.
- Tertiary: low-emphasis actions such as Copy or Open.
- Destructive: actions such as Delete session or Clear history, always clearly labeled and confirmed where data loss is possible.

Do not use ambiguous icon-only actions for important or destructive operations. Provide tooltips and accessible labels for compact icon buttons.

## 23.5 Micro-interactions and feedback

- Panel open/close and popover transitions should be subtle and fast.
- Streaming should show a restrained activity indicator without causing layout jumps.
- Tool execution should show what is happening in plain language, not raw protocol payloads.
- Buttons must provide immediate pressed/disabled feedback.
- Long-running operations should show progress where measurable and a clear Stop action.
- Success feedback should confirm what actually happened, such as "3 changes applied", not merely "Done".
- Errors should explain the issue and provide a recovery action where possible.
- Avoid toast-only feedback for important outcomes; retain important results in the conversation or activity history.
- Respect `prefers-reduced-motion`.

## 23.6 Empty, loading and error states

Design intentional states for:

- No provider configured.
- Provider configured but not tested.
- No conversation yet.
- No sessions found.
- No document context selected.
- Document has no searchable text.
- Retrieval is still indexing.
- Assistant is responding.
- Tool is running.
- Waiting for approval.
- Proposal is stale.
- Partial task failure.
- Storage is unavailable.
- Provider/model does not support a requested capability.

Every empty state should explain what the user can do next. Avoid generic blank panels and unexplained disabled controls.

## 23.7 Responsive behavior

Define explicit layout breakpoints based on available editor width, not only device labels.

- Wide desktop: docked panel with optional session history.
- Standard desktop: conversation-first panel; history opens as a drawer or secondary view.
- Narrow editor: full-width overlay or bottom sheet; do not squeeze the document and panel into unusable columns.
- Touch devices: large touch targets, safe-area padding, predictable sheet dismissal and no hover-only functionality.

When the panel becomes an overlay, preserve the editor's scroll position and selection. Opening or closing it must not modify the document.

## 23.8 Accessibility and interaction standards

- Follow WCAG 2.2 AA as the target.
- Maintain visible keyboard focus.
- Ensure logical tab order and focus restoration.
- Use semantic roles and labels for dialogs, complementary regions, lists, status and live updates.
- Announce meaningful status transitions, not every streamed token.
- Ensure all drag, hover and pointer actions have keyboard alternatives.
- Support zoom and text resizing without clipping critical controls.
- Ensure diff changes are understandable without color.
- Test with at least one screen reader and keyboard-only navigation.

## 23.9 Design QA and visual regression

Add a dedicated UI quality gate:

- Capture reference screenshots for the panel, session history, provider settings, model controls, selection popover, citations, plans, proposal review, errors and mobile layouts.
- Test screenshots in light and dark themes.
- Test long document titles, long model names, long prompts, large tool output and many citations.
- Check clipping, alignment, inconsistent spacing, overflow, focus rings and scroll behavior.
- Add visual regression coverage using the repository's existing Playwright/screenshot convention.
- Review the UI at realistic editor sizes, not only isolated component previews.

**Acceptance criterion:** every V2 surface must look like part of one coherent, polished application. No feature is complete merely because its controls work.

---

# 24. Thinking effort and reasoning configuration

V2 must expose a **Thinking effort** setting when configuring a model provider, where the selected provider/model supports reasoning or configurable inference effort. This is a provider/model inference setting, not a global promise that every model can think at the same level.

## 24.1 User-facing setting

Add a **Thinking effort** control to Settings → AI → Model configuration, near the model selector.

Suggested presentation:

- **Auto** — use the model/provider default.
- **Low** — prioritize speed and lower reasoning overhead.
- **Medium** — balance speed and reasoning depth.
- **High** — spend more effort on complex analysis and multi-step tasks.
- **Maximum** — use the highest supported effort for the selected model.

The UI must explain that higher effort may increase latency and token usage, and does not guarantee a more accurate answer.

The exact options shown must be driven by the selected model's capabilities. Do not show unsupported options or imply that all providers expose the same levels.

## 24.2 Configuration model

```ts
type ThinkingEffort =
  | 'auto'
  | 'low'
  | 'medium'
  | 'high'
  | 'maximum';

interface ModelInferenceConfig {
  thinkingEffort?: ThinkingEffort;
  reasoningBudgetTokens?: number;
  providerOptions?: Record<string, unknown>;
}

interface ModelProfile {
  id: string;
  providerId: string;
  model: string;
  capabilities: ModelCapabilities;
  inference: ModelInferenceConfig;
}
```

The public configuration should remain provider-neutral. Provider adapters are responsible for mapping the normalized setting to the provider's actual request format.

## 24.3 Capability discovery

Extend `ModelCapabilities` with reasoning controls:

```ts
interface ReasoningCapabilities {
  supported: boolean;
  supportedEfforts?: ThinkingEffort[];
  supportsBudgetTokens?: boolean;
  minBudgetTokens?: number;
  maxBudgetTokens?: number;
  defaultEffort?: ThinkingEffort;
}

interface ModelCapabilities {
  streaming: boolean;
  toolCalling: boolean;
  jsonMode: boolean;
  vision: boolean;
  maxContextTokens?: number;
  maxOutputTokens?: number;
  reasoning?: ReasoningCapabilities;
}
```

Capability information may come from:

- A maintained provider/model registry.
- An embedder-supplied model profile.
- Provider metadata, where available.
- Explicit user configuration for custom endpoints.

Do not assume that an OpenAI-compatible endpoint supports the same reasoning parameters as OpenAI. Unknown capability means the UI should use Auto and avoid sending unsupported parameters.

## 24.4 Provider adapter mapping

Each adapter must map the normalized configuration to the provider's current API contract.

Requirements:

- Keep provider-specific parameter names inside the adapter.
- Omit unsupported parameters entirely.
- Validate reasoning budget limits before sending.
- Do not send both an effort setting and a budget setting if the provider considers them mutually exclusive.
- Preserve custom endpoint flexibility through an explicit advanced provider-options mechanism.
- Never silently claim that a requested effort was honored when the provider ignored or rejected it.
- Surface a readable error when an explicitly selected setting is unsupported or invalid.

The provider adapter documentation and tests must record the mapping for each supported model family. Avoid hard-coding assumptions based only on provider name; capability can vary by model and API version.

## 24.5 Scope and precedence

Thinking effort should be configurable at three levels:

1. **Provider/model default:** saved in model configuration.
2. **Session override:** optional override for a particular conversation.
3. **Run override:** optional one-off override for a single request.

Precedence:

`run override → session override → model profile default → Auto`

The active effort should be visible in the model/context details for the current run. Changing the default must not retroactively change past runs.

## 24.6 Task-aware recommendations

The UI may recommend an effort level based on the selected task, but must not silently change the user's explicit preference.

Examples:

| Task | Suggested effort |
|---|---|
| Simple grammar correction | Low |
| Short rewrite | Low or Medium |
| Document Q&A | Medium |
| Long-document synthesis | High |
| Complex comparison or risk analysis | High |
| Multi-step planning and tool orchestration | High or Maximum |

These are recommendations only. The model/provider may have different optimal settings.

## 24.7 UX details

- Place Thinking effort in the model configuration section, directly after model selection.
- Show only levels supported by the selected model.
- Default to Auto when capabilities are unknown.
- Provide concise helper text explaining speed/quality trade-offs.
- If the model does not support configurable reasoning, show a subdued "Not configurable for this model" state or omit the control according to the settings layout.
- If the model changes, re-evaluate supported effort values and reset an invalid selection to Auto with a non-disruptive explanation.
- Display the effective effort in run details and optional diagnostics.
- Do not confuse Thinking effort with output length, temperature, verbosity or maximum completion tokens; these are separate settings.

## 24.8 Testing

- Provider/model capability controls the available options.
- Unknown capabilities default to Auto and omit unsupported parameters.
- Every adapter maps supported values correctly.
- Invalid budget values are rejected locally.
- Session and run overrides follow the documented precedence.
- Switching models handles unsupported saved values safely.
- Run diagnostics report the effective configured effort without exposing secrets.
- UI states are tested in light/dark themes and narrow layouts.

---

# 25. Updated V2 Definition of Done additions

Add these checks to the Definition of Done in section 17:

## Professional UI
- [ ] A cohesive design system is used across all AI surfaces.
- [ ] Existing editor tokens are reused or extended rather than duplicated.
- [ ] Light and dark themes are complete.
- [ ] WCAG 2.2 AA checks are completed for new surfaces.
- [ ] Empty, loading, success, error, disabled and overflow states are designed.
- [ ] Desktop, narrow viewport and touch layouts are verified.
- [ ] Keyboard and screen-reader behavior is tested.
- [ ] Visual regression screenshots cover all primary AI surfaces.
- [ ] No raw protocol details, debug payloads or unexplained technical errors appear in normal UI.

## Thinking effort
- [ ] Thinking effort is configurable per supported provider/model.
- [ ] Unsupported levels are not displayed or sent.
- [ ] Auto is the safe fallback when capabilities are unknown.
- [ ] Provider-specific mapping is isolated in adapters and covered by tests.
- [ ] Session and per-run overrides work with documented precedence.
- [ ] The effective setting is visible in run details.
- [ ] UI explains that higher effort can increase latency and token usage.
