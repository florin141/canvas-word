// Lazy AI feature entry. `editorApp` dynamic-imports this module only when the
// embedder enabled AI AND the user first uses an AI surface, so an AI-disabled
// (or AI-unused) editor never downloads this chunk.

import type { AiHost } from "./host";
import type { AiOptions } from "./types";
import { CHIPS, chatMessages, selectionContext, selectionPrompt, SYSTEM_PROMPT } from "./context/promptBuilder";
import { captureAnchor, trackAnchor, type TrackedAnchor } from "./context/selectionAnchor";
import { applyAllReplacements, applyInsertBelow, applyReplacement, copyResult } from "./session/apply";
import { createChatStore, type AssistantTurn } from "./session/chatStore";
import { buildQueueRepairRequest, buildQueueRequest, parseQueueResults, type QueueTask } from "./session/queue";
import { runRequest } from "./session/runner";
import {
  isConfigured,
  loadAiSettings,
  loadPanelPrefs,
  mergeWithPreset,
  saveAiSettings,
  savePanelPrefs,
  showSettingsFor,
  testConnection,
} from "./settings/aiSettings";
import { createAiPanel, type AiPanelHandle, type ApplyMode } from "./ui/aiPanel";
import { openAiSettingsDialog } from "./ui/aiSettingsDialog";
import { openAskAiPopover, type AskAiPopoverHandle } from "./ui/askAiPopover";

export type { AiHost } from "./host";

export interface AiFeature {
  openPanel(): void;
  closePanel(): void;
  togglePanel(): void;
  isPanelOpen(): boolean;
  /** Provider settings surface (no-op when the host owns configuration). */
  openSettings(): void;
  /** Ask AI popover on the current selection (implemented in the anchoring phase). */
  openAskAiPopover(): void;
  destroy(): void;
}

export function mountAiFeature(host: AiHost, options: AiOptions): AiFeature {
  const hasTransport = options.transport !== undefined;
  const settingsEditable = showSettingsFor(options);
  let settings = mergeWithPreset(loadAiSettings(), options.provider);
  const panelPrefs = loadPanelPrefs();
  let panelOpen = options.panel?.defaultOpen ?? panelPrefs.open;

  const store = createChatStore();
  /** Live anchors for Ask AI answers, keyed by anchor id. */
  const anchors = new Map<string, TrackedAnchor>();
  let popover: AskAiPopoverHandle | null = null;
  let abort: AbortController | null = null;
  let streamingId: string | null = null;
  let renderQueued = false;
  let destroyed = false;

  const configured = (): boolean => isConfigured(settings, hasTransport);
  const isStreaming = (): boolean => streamingId !== null || queueRunning;

  const scheduleRender = (): void => {
    if (renderQueued || destroyed) return;
    renderQueued = true;
    const flush = (): void => {
      renderQueued = false;
      panel.render();
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(flush);
    else setTimeout(flush, 0);
  };

  const setPanel = (open: boolean): void => {
    panelOpen = open;
    host.setPanelOpen(open);
    // The panel owns width changes (resize grip); re-read rather than clobber them.
    savePanelPrefs({ open, width: loadPanelPrefs().width });
    if (open) {
      panel.mount();
      panel.render();
      setTimeout(() => panel.focusComposer(), 0);
    }
  };

  const stop = (): void => {
    abort?.abort();
    abort = null;
    if (streamingId) store.stop(streamingId);
    streamingId = null;
    queueRunning = false;
    scheduleRender();
  };

  const send = (text: string, opts: { addUser?: boolean; quote?: string; anchorId?: string; prompt?: string } = {}): void => {
    const value = text.trim();
    if (!value || abort || destroyed) return;
    if (!configured()) {
      setPanel(true);
      openSettings();
      return;
    }
    if (opts.addUser !== false) {
      store.addUser(value, {
        ...(opts.prompt ? { prompt: opts.prompt } : {}),
        ...(opts.quote ? { quote: opts.quote } : {}),
        ...(opts.anchorId ? { anchorId: opts.anchorId } : {}),
      });
    }
    const assistant = store.startAssistant(opts.anchorId ? { anchorId: opts.anchorId } : undefined);
    const controller = new AbortController();
    abort = controller;
    streamingId = assistant.id;
    const request = {
      system: SYSTEM_PROMPT,
      messages: chatMessages(host.getDocument(), store.turns(), assistant.id, !opts.anchorId),
    };
    scheduleRender();
    void runRequest(
      { settings, ...(options.transport ? { transport: options.transport } : {}) },
      request,
      controller.signal,
      {
        onDelta: (delta) => {
          store.appendDelta(assistant.id, delta);
          scheduleRender();
        },
        onDone: () => {
          store.finish(assistant.id);
          if (abort === controller) abort = null;
          if (streamingId === assistant.id) streamingId = null;
          scheduleRender();
        },
        onError: (code, message) => {
          store.fail(assistant.id, code, message);
          if (abort === controller) abort = null;
          if (streamingId === assistant.id) streamingId = null;
          scheduleRender();
        },
      },
    );
  };

  const retry = (assistantId: string): void => {
    const user = store.lastUserBefore(assistantId);
    if (!user) return;
    store.remove(assistantId);
    send(user.content, {
      addUser: false,
      ...(user.prompt ? { prompt: user.prompt } : {}),
      ...(user.quote ? { quote: user.quote } : {}),
      ...(user.anchorId ? { anchorId: user.anchorId } : {}),
    });
  };

  const newChat = (): void => {
    stop();
    for (const tracked of anchors.values()) tracked.dispose();
    anchors.clear();
    for (const item of queued) item.tracked.dispose();
    queued.length = 0;
    for (const result of queueResults) result.tracked.dispose();
    queueResults = [];
    store.clear();
    scheduleRender();
    panel.focusComposer();
  };

  const openSettings = (): void => {
    if (!settingsEditable) {
      host.notify("AI settings are managed by the host application.", "info");
      return;
    }
    openAiSettingsDialog({
      settings,
      showSidebar: panelOpen,
      editable: !hasTransport,
      ...(options.transport ? { transport: options.transport } : {}),
      testConnection: (config) => testConnection(config, options.transport),
      onSave: (next, showSidebar) => {
        settings = next;
        saveAiSettings(next);
        setPanel(showSidebar);
        panel.render();
        host.notify("AI provider settings saved.", "info");
      },
    });
  };

  // ---- Ask AI on a selection ------------------------------------------------
  interface QueueItem {
    id: string;
    instruction: string;
    quote: string;
    tracked: TrackedAnchor;
  }
  interface QueueResultItem {
    id: string;
    instruction: string;
    quote: string;
    replacement: string;
    tracked: TrackedAnchor;
  }
  const queued: QueueItem[] = [];
  let queueResults: QueueResultItem[] = [];
  let queueRunning = false;

  const queueItem = (instruction: string, tracked: TrackedAnchor, quote: string): void => {
    queued.push({ id: tracked.anchor.id, instruction, quote, tracked });
    host.notify(`Added to queue (${queued.length}).`, "info");
    setPanel(true);
    scheduleRender();
  };

  const clearQueue = (): void => {
    for (const item of queued) item.tracked.dispose();
    queued.length = 0;
    scheduleRender();
  };

  const removeQueueItem = (id: string): void => {
    const index = queued.findIndex((item) => item.id === id);
    if (index < 0) return;
    queued[index]!.tracked.dispose();
    queued.splice(index, 1);
    scheduleRender();
  };

  const dismissQueueResults = (): void => {
    for (const result of queueResults) result.tracked.dispose();
    queueResults = [];
    scheduleRender();
  };

  const applyQueueResult = (id: string): void => {
    if (host.isReadonly()) {
      host.notify("The editor is read-only.", "info");
      return;
    }
    const index = queueResults.findIndex((result) => result.id === id);
    if (index < 0) return;
    const result = queueResults[index]!;
    const outcome = applyReplacement(host, result.tracked, result.replacement);
    if (!outcome.ok) {
      host.notify(
        outcome.reason === "stale"
          ? "Selection changed. Ask again."
          : outcome.reason === "unsupported"
            ? "This selection cannot be replaced. Try a smaller range."
            : "Nothing to apply.",
        outcome.reason === "stale" ? "warning" : "info",
      );
      return;
    }
    result.tracked.dispose();
    queueResults.splice(index, 1);
    scheduleRender();
  };

  const applyAllQueueResults = (): void => {
    if (host.isReadonly()) {
      host.notify("The editor is read-only.", "info");
      return;
    }
    if (queueResults.length === 0) return;
    const outcome = applyAllReplacements(
      host,
      queueResults.map((result) => ({ tracked: result.tracked, replacement: result.replacement })),
    );
    if (outcome.applied === 0) {
      host.notify("No queued edits could be applied. Ask again.", "warning");
      return;
    }
    for (const result of queueResults) result.tracked.dispose();
    queueResults = [];
    host.notify(`Applied ${outcome.applied} edit${outcome.applied === 1 ? "" : "s"}.`, "info");
    scheduleRender();
  };

  const runQueue = (): void => {
    if (abort || queueRunning || queued.length === 0 || destroyed) return;
    if (!configured()) {
      setPanel(true);
      openSettings();
      return;
    }
    const tasks: QueueTask[] = [];
    const runIds = new Set<string>();
    for (const item of queued) {
      if (item.tracked.isStale()) continue;
      const current = item.tracked.current();
      const context = selectionContext(host.getDocument(), current.start, current.end);
      if (!context) continue;
      tasks.push({
        id: item.id,
        instruction: item.instruction,
        text: context.text,
        before: context.before,
        after: context.after,
      });
      runIds.add(item.id);
    }
    if (tasks.length === 0) {
      host.notify("Every queued selection has changed. Ask again.", "warning");
      return;
    }
    const controller = new AbortController();
    abort = controller;
    queueRunning = true;
    scheduleRender();
    let raw = "";

    const finish = (results: Array<{ id: string; replacement: string }> | null): void => {
      queueRunning = false;
      if (abort === controller) abort = null;
      if (!results) {
        host.notify("The model's queue response was not valid. Try again.", "warning");
        scheduleRender();
        return;
      }
      const byId = new Map(queued.map((item) => [item.id, item]));
      const answered = new Set(results.map((result) => result.id));
      const next: QueueResultItem[] = [];
      for (const result of results) {
        const item = byId.get(result.id);
        if (!item) continue;
        next.push({
          id: result.id,
          instruction: item.instruction,
          quote: item.quote,
          replacement: result.replacement,
          tracked: item.tracked,
        });
      }
      for (let i = queued.length - 1; i >= 0; i--) {
        if (answered.has(queued[i]!.id)) queued.splice(i, 1);
      }
      queueResults = next;
      scheduleRender();
    };

    const exec = (request: ReturnType<typeof buildQueueRequest>, allowRepair: boolean): void => {
      raw = "";
      void runRequest(
        { settings, ...(options.transport ? { transport: options.transport } : {}) },
        request,
        controller.signal,
        {
          onDelta: (delta) => {
            raw += delta;
          },
          onDone: () => {
            if (controller.signal.aborted) return;
            const parsed = parseQueueResults(raw, runIds);
            if (parsed) finish(parsed);
            else if (allowRepair) exec(buildQueueRepairRequest(raw, tasks), false);
            else finish(null);
          },
          onError: (_code, message) => {
            if (controller.signal.aborted) return;
            queueRunning = false;
            if (abort === controller) abort = null;
            host.notify(message, "warning");
            scheduleRender();
          },
        },
      );
    };
    exec(buildQueueRequest(tasks), true);
  };

  const applyTurn = (turnId: string, mode: ApplyMode): void => {
    const turn = store.turns().find((candidate) => candidate.id === turnId);
    if (!turn || turn.role !== "assistant") return;
    if (mode !== "copy" && host.isReadonly()) {
      host.notify("The editor is read-only.", "info");
      return;
    }
    if (mode === "copy") {
      void copyResult(turn.content).then((ok) => {
        host.notify(ok ? "Copied to the clipboard." : "Could not copy.", ok ? "info" : "warning");
      });
      return;
    }
    const tracked = turn.anchorId ? anchors.get(turn.anchorId) : undefined;
    if (!tracked) {
      host.notify("Selection changed. Ask again.", "warning");
      return;
    }
    const outcome =
      mode === "replace" ? applyReplacement(host, tracked, turn.content) : applyInsertBelow(host, tracked, turn.content);
    if (!outcome.ok) {
      host.notify(
        outcome.reason === "stale"
          ? "Selection changed. Ask again."
          : outcome.reason === "unsupported"
            ? "This selection cannot be replaced. Try a smaller range."
            : "There is nothing to insert.",
        outcome.reason === "stale" ? "warning" : "info",
      );
      return;
    }
    host.notify(mode === "replace" ? "Selection replaced." : "Inserted below the selection.", "info");
    scheduleRender();
  };

  const canApply = (turn: AssistantTurn): boolean => {
    const tracked = turn.anchorId ? anchors.get(turn.anchorId) : undefined;
    return !!tracked && !tracked.isStale() && !host.isReadonly();
  };

  const showAskAiPopover = (): void => {
    if (!configured()) {
      setPanel(true);
      openSettings();
      return;
    }
    const anchor = captureAnchor(host);
    const rect = host.getSelectionRect();
    if (!anchor || !rect) {
      host.notify("Select some text first.", "info");
      return;
    }
    popover?.close("dismiss");
    const tracked = trackAnchor(host, anchor);
    anchors.set(anchor.id, tracked);
    host.setSelectionInactive(true);
    popover = openAskAiPopover({
      anchor: rect,
      text: anchor.text,
      chips: CHIPS,
      onSend: (instruction) => {
        popover = null;
        host.setSelectionInactive(false);
        const current = tracked.current();
        const context = selectionContext(host.getDocument(), current.start, current.end);
        if (!context) {
          tracked.dispose();
          anchors.delete(anchor.id);
          host.notify("Selection changed. Ask again.", "warning");
          return;
        }
        setPanel(true);
        send(instruction, {
          quote: anchor.text,
          anchorId: anchor.id,
          prompt: selectionPrompt(instruction, context),
        });
      },
      onQueue: (instruction) => {
        popover = null;
        host.setSelectionInactive(false);
        queueItem(instruction, tracked, anchor.text);
      },
      onClose: (reason) => {
        popover = null;
        host.setSelectionInactive(false);
        if (reason === "dismiss") host.focusEditor();
        // Action closes keep the anchor (the resulting turn will use it); a
        // dismissed/canvas-clicked popover has no turn to apply.
        if (reason !== "action") {
          tracked.dispose();
          anchors.delete(anchor.id);
        }
      },
    });
  };

  const panel: AiPanelHandle = createAiPanel({
    host,
    getSettings: () => settings,
    isConfigured: configured,
    openSettings,
    onSend: (text) => {
      setPanel(true);
      send(text);
    },
    onStop: stop,
    onNewChat: newChat,
    onRetry: retry,
    getTurns: () => store.turns(),
    isStreaming,
    onClose: () => setPanel(false),
    canApply,
    onApply: applyTurn,
    getQueue: () => queued.map(({ id, instruction, quote }) => ({ id, instruction, quote })),
    getQueueResults: () => queueResults,
    onRunQueue: runQueue,
    onClearQueue: clearQueue,
    onRemoveQueueItem: removeQueueItem,
    onApplyQueueResult: applyQueueResult,
    onApplyAllQueueResults: applyAllQueueResults,
    onDismissQueueResults: dismissQueueResults,
    isQueueRunning: () => queueRunning,
  });

  panel.mount();
  host.setPanelOpen(panelOpen);

  const onTeardown = (): void => {
    destroyed = true;
    abort?.abort();
    abort = null;
    popover?.close("outside");
    popover = null;
    for (const tracked of anchors.values()) tracked.dispose();
    anchors.clear();
    for (const item of queued) item.tracked.dispose();
    queued.length = 0;
    for (const result of queueResults) result.tracked.dispose();
    queueResults = [];
    panel.destroy();
  };
  host.signal.addEventListener("abort", onTeardown, { once: true });

  return {
    openPanel: () => setPanel(true),
    closePanel: () => setPanel(false),
    togglePanel: () => setPanel(!panelOpen),
    isPanelOpen: () => panelOpen,
    openSettings,
    openAskAiPopover: showAskAiPopover,
    destroy: () => {
      host.signal.removeEventListener("abort", onTeardown);
      onTeardown();
    },
  };
}
