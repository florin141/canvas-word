// The docked AI chat panel. Presentational: it renders the chat store and calls
// back into the feature for runs, settings, retry and apply. The host aside is
// created by the editor shell; this module owns everything inside it.

import { injectCssOnce } from "../../ui/styles";
import type { AiHost } from "../host";
import { providerEntry } from "../providers/registry";
import { loadPanelPrefs, savePanelPrefs, type SavedAiSettings } from "../settings/aiSettings";
import type { AssistantTurn, Turn } from "../session/chatStore";

export type ApplyMode = "replace" | "insert" | "copy";

export interface QueueView {
  id: string;
  instruction: string;
  quote: string;
}

export interface QueueResultView {
  id: string;
  instruction: string;
  quote: string;
  replacement: string;
}

export interface AiPanelDeps {
  host: AiHost;
  getSettings(): SavedAiSettings;
  isConfigured(): boolean;
  openSettings(): void;
  onSend(text: string): void;
  onStop(): void;
  onNewChat(): void;
  onRetry(assistantId: string): void;
  getTurns(): readonly Turn[];
  isStreaming(): boolean;
  onClose(): void;
  /** Ask AI / queue results; absent until the anchoring phase is wired. */
  onApply?(turnId: string, mode: ApplyMode): void;
  canApply?(turn: AssistantTurn): boolean;
  // ---- queue ---------------------------------------------------------------
  getQueue(): readonly QueueView[];
  getQueueResults(): readonly QueueResultView[];
  onRunQueue(): void;
  onClearQueue(): void;
  onRemoveQueueItem(id: string): void;
  onApplyQueueResult(id: string): void;
  onApplyAllQueueResults(): void;
  onDismissQueueResults(): void;
  isQueueRunning(): boolean;
}

export interface AiPanelHandle {
  mount(): void;
  render(): void;
  focusComposer(): void;
  destroy(): void;
}

const STARTERS = ["Summarize this document", "Suggest a better title", "Find inconsistencies", "Draft an outline"];

const CSS = `
.cw-ai-panel{font:13px/1.5 system-ui,"Segoe UI",Arial,sans-serif;}
.cw-ai-grip{position:absolute;left:0;top:0;bottom:0;width:5px;cursor:col-resize;z-index:2;}
.cw-ai-grip:hover{background:rgba(43,87,154,.18);}
.cw-ai-head{display:flex;align-items:center;gap:6px;padding:10px 10px 10px 14px;background:#fff;border-bottom:1px solid #e8eaed;flex:0 0 auto;}
.cw-ai-title{font-size:14px;font-weight:600;color:#202124;}
.cw-ai-badge{font-size:11px;color:#5f6368;background:#f1f3f4;border-radius:10px;padding:2px 8px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.cw-ai-spacer{flex:1 1 auto;}
.cw-ai-hbtn{border:none;background:transparent;cursor:pointer;color:#5f6368;height:28px;min-width:28px;padding:0 6px;border-radius:6px;font:inherit;font-size:12px;}
.cw-ai-hbtn:hover{background:#f1f3f4;color:#202124;}
.cw-ai-close{font-size:18px;line-height:1;}
.cw-ai-msgs{flex:1 1 auto;min-height:0;overflow:auto;padding:14px 12px;display:flex;flex-direction:column;gap:12px;background:#f7f8fa;}
.cw-ai-turn{display:flex;flex-direction:column;gap:4px;max-width:100%;}
.cw-ai-turn.user{align-items:flex-end;}
.cw-ai-turn.assistant{align-items:flex-start;}
.cw-ai-bubble{border-radius:10px;padding:8px 11px;white-space:pre-wrap;word-break:break-word;max-width:100%;}
.cw-ai-turn.user .cw-ai-bubble{background:#2b579a;color:#fff;border-bottom-right-radius:3px;}
.cw-ai-turn.assistant .cw-ai-bubble{background:#fff;border:1px solid #e1e3e6;color:#202124;border-bottom-left-radius:3px;}
.cw-ai-quote{border-left:3px solid #c8c6c4;padding:2px 8px;margin-bottom:4px;color:#5f6368;font-size:11.5px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:rgba(255,255,255,.10);border-radius:2px;}
.cw-ai-empty{display:flex;flex-direction:column;gap:8px;padding-top:8px;}
.cw-ai-empty h3{margin:0 0 2px;font-size:13px;color:#3c4043;}
.cw-ai-starter{text-align:left;border:1px solid #d0d4d9;background:#fff;color:#3c4043;border-radius:8px;padding:8px 10px;font:inherit;font-size:12.5px;cursor:pointer;}
.cw-ai-starter:hover{background:#eef3fb;border-color:#9ac2ff;}
.cw-ai-noprov{border:1px solid #e1e3e6;background:#fff;border-radius:10px;padding:14px;display:flex;flex-direction:column;gap:8px;}
.cw-ai-noprov p{margin:0;color:#5f6368;font-size:12.5px;line-height:1.5;}
.cw-ai-noprov button{align-self:flex-start;height:30px;padding:0 12px;border-radius:6px;border:1px solid #2b579a;background:#2b579a;color:#fff;font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;}
.cw-ai-error{border:1px solid #f1b8bc;background:#fde7e9;color:#a4262c;border-radius:8px;padding:8px 10px;font-size:12px;display:flex;flex-direction:column;gap:6px;}
.cw-ai-error button{align-self:flex-start;border:1px solid #a4262c;background:#fff;color:#a4262c;border-radius:6px;height:26px;padding:0 10px;font:inherit;font-size:12px;font-weight:600;cursor:pointer;}
.cw-ai-cursor{display:inline-block;width:7px;height:14px;margin-left:2px;vertical-align:-2px;background:#2b579a;animation:cw-ai-blink 1s steps(1) infinite;}
@keyframes cw-ai-blink{50%{opacity:0}}
.cw-ai-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:2px;}
.cw-ai-actions button{height:26px;padding:0 10px;border-radius:6px;border:1px solid #d0d4d9;background:#fff;color:#3c4043;font:inherit;font-size:11.5px;font-weight:600;cursor:pointer;}
.cw-ai-actions button.primary{border-color:#e8643c;background:#e8643c;color:#fff;}
.cw-ai-actions button:disabled{opacity:.5;cursor:default;}
.cw-ai-queue{flex:0 0 auto;border-top:1px solid #e8eaed;background:#fff;padding:8px 10px;display:flex;flex-direction:column;gap:6px;max-height:38%;overflow:auto;}
.cw-ai-qhead{display:flex;align-items:center;gap:6px;}
.cw-ai-qtitle{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#80868b;}
.cw-ai-qspacer{flex:1 1 auto;}
.cw-ai-qbtn{height:26px;padding:0 9px;border-radius:6px;border:1px solid #d0d4d9;background:#fff;color:#3c4043;font:inherit;font-size:11.5px;font-weight:600;cursor:pointer;}
.cw-ai-qbtn.primary{border-color:#e8643c;background:#e8643c;color:#fff;}
.cw-ai-qbtn:disabled{opacity:.5;cursor:default;}
.cw-ai-qitem{display:flex;align-items:flex-start;gap:8px;border:1px solid #e1e3e6;border-radius:8px;padding:6px 8px;background:#fafbfc;}
.cw-ai-qtext{flex:1 1 auto;min-width:0;}
.cw-ai-qquote{font-size:11px;color:#80868b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.cw-ai-qinstr{font-size:12px;color:#202124;margin-top:1px;}
.cw-ai-qx{border:none;background:transparent;color:#80868b;cursor:pointer;font-size:16px;line-height:1;width:22px;height:22px;border-radius:5px;flex:0 0 auto;}
.cw-ai-qx:hover{background:#f1f3f4;color:#202124;}
.cw-ai-composer{flex:0 0 auto;border-top:1px solid #e8eaed;background:#fff;padding:8px 10px;display:flex;gap:8px;align-items:flex-end;}
.cw-ai-input{flex:1 1 auto;resize:none;min-height:34px;max-height:120px;border:1px solid #d0d4d9;border-radius:8px;padding:7px 9px;font:inherit;font-size:13px;line-height:1.4;background:#fff;color:inherit;outline:none;}
.cw-ai-input:focus{border-color:#2b579a;box-shadow:0 0 0 2px rgba(43,87,154,.18);}
.cw-ai-send,.cw-ai-stop{height:34px;padding:0 12px;border-radius:8px;border:1px solid #2b579a;background:#2b579a;color:#fff;font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap;}
.cw-ai-stop{border-color:#a4262c;background:#a4262c;}
:root[data-theme="dark"] .cw-ai-head{background:#26282c;border-color:#34373c;}
:root[data-theme="dark"] .cw-ai-title{color:#f0f0f0;}
:root[data-theme="dark"] .cw-ai-badge{background:#34373c;color:#9aa0a6;}
:root[data-theme="dark"] .cw-ai-hbtn{color:#9aa0a6;}
:root[data-theme="dark"] .cw-ai-hbtn:hover{background:#34373c;color:#f0f0f0;}
:root[data-theme="dark"] .cw-ai-msgs{background:#202124;}
:root[data-theme="dark"] .cw-ai-turn.assistant .cw-ai-bubble{background:#26282c;border-color:#4a4a4a;color:#e6e6e6;}
:root[data-theme="dark"] .cw-ai-noprov,:root[data-theme="dark"] .cw-ai-starter{background:#26282c;border-color:#4a4a4a;color:#e6e6e6;}
:root[data-theme="dark"] .cw-ai-starter:hover{background:#2c3340;}
:root[data-theme="dark"] .cw-ai-queue{background:#26282c;border-color:#34373c;}
:root[data-theme="dark"] .cw-ai-qitem{background:#202124;border-color:#4a4a4a;}
:root[data-theme="dark"] .cw-ai-qinstr{color:#e6e6e6;}
:root[data-theme="dark"] .cw-ai-qbtn{background:#2a2c30;border-color:#4a4a4a;color:#e6e6e6;}
:root[data-theme="dark"] .cw-ai-qx:hover{background:#34373c;color:#f0f0f0;}
:root[data-theme="dark"] .cw-ai-composer{background:#26282c;border-color:#34373c;}
:root[data-theme="dark"] .cw-ai-input{background:#1e1f22;color:#e6e6e6;border-color:#4a4a4a;}
`;

export function createAiPanel(deps: AiPanelDeps): AiPanelHandle {
  injectCssOnce("cw-ai-panel-styles", CSS);
  const panel = deps.host.panelEl;
  let mounted = false;
  let msgs: HTMLDivElement | null = null;
  let input: HTMLTextAreaElement | null = null;
  let sendBtn: HTMLButtonElement | null = null;
  let stopBtn: HTMLButtonElement | null = null;
  let badgeEl: HTMLSpanElement | null = null;
  let composer: HTMLDivElement | null = null;
  let queueEl: HTMLDivElement | null = null;
  let pinned = true;

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const modelBadge = (): string => {
    const settings = deps.getSettings();
    if (!settings.providerId) return "No provider";
    const entry = providerEntry(settings.providerId);
    const model = settings.model || entry?.defaultModel || "model";
    return `${entry?.label ?? settings.providerId} · ${model}`;
  };

  const autosize = (): void => {
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(120, Math.max(34, input.scrollHeight))}px`;
  };

  const submit = (): void => {
    if (!input || deps.isStreaming()) return;
    const text = input.value.trim();
    if (!text) return;
    if (!deps.isConfigured()) {
      deps.openSettings();
      return;
    }
    input.value = "";
    autosize();
    deps.onSend(text);
  };

  const turnEl = (turn: Turn): HTMLElement => {
    const wrap = el("div", `cw-ai-turn ${turn.role}`);
    if (turn.role === "user") {
      if (turn.quote) wrap.append(el("div", "cw-ai-quote", turn.quote));
      wrap.append(el("div", "cw-ai-bubble", turn.content));
      return wrap;
    }
    const bubble = el("div", "cw-ai-bubble");
    if (turn.content) bubble.append(document.createTextNode(turn.content));
    if (turn.streaming) bubble.append(el("span", "cw-ai-cursor"));
    wrap.append(bubble);
    if (turn.error) {
      const error = el("div", "cw-ai-error");
      error.append(el("div", "", turn.error.message));
      const retry = el("button", "", "Retry");
      retry.type = "button";
      retry.addEventListener("click", () => deps.onRetry(turn.id));
      error.append(retry);
      wrap.append(error);
    } else if (!turn.streaming && turn.content && turn.anchorId && deps.onApply) {
      const actions = el("div", "cw-ai-actions");
      const allowed = deps.canApply ? deps.canApply(turn) : true;
      const applyBtn = (label: string, mode: ApplyMode, primary = false): void => {
        const btn = el("button", primary ? "primary" : "", label);
        btn.type = "button";
        btn.disabled = !allowed;
        btn.title = allowed ? label : "Selection changed. Ask again.";
        btn.addEventListener("click", () => deps.onApply?.(turn.id, mode));
        actions.append(btn);
      };
      applyBtn("Replace selection", "replace", true);
      applyBtn("Insert below", "insert");
      applyBtn("Copy", "copy");
      wrap.append(actions);
    }
    return wrap;
  };

  const emptyState = (): HTMLElement => {
    const box = el("div", "cw-ai-empty");
    box.append(el("h3", "", "Ask about this document"));
    for (const starter of STARTERS) {
      const button = el("button", "cw-ai-starter", starter);
      button.type = "button";
      button.addEventListener("click", () => deps.onSend(starter));
      box.append(button);
    }
    return box;
  };

  const setupCard = (): HTMLElement => {
    const card = el("div", "cw-ai-noprov");
    card.append(
      el("h3", "", "Set up an AI provider"),
      el("p", "", "Choose a provider and model to start using the assistant. Nothing is sent until you do."),
    );
    const button = el("button", "", "Open settings");
    button.type = "button";
    button.addEventListener("click", () => deps.openSettings());
    card.append(button);
    return card;
  };

  const wireResize = (grip: HTMLElement): void => {
    const maxWidth = (): number => Math.max(280, Math.floor(window.innerWidth * 0.5));
    const apply = (width: number): number => {
      const next = Math.min(maxWidth(), Math.max(280, Math.round(width)));
      panel.style.setProperty("--cw-ai-width", `${next}px`);
      return next;
    };
    let width = apply(loadPanelPrefs().width);
    grip.addEventListener("pointerdown", (event: PointerEvent) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = width;
      const move = (ev: PointerEvent): void => {
        width = apply(startWidth + (startX - ev.clientX));
      };
      const up = (): void => {
        grip.removeEventListener("pointermove", move);
        savePanelPrefs({ open: true, width });
      };
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", up, { once: true });
    });
  };

  const mount = (): void => {
    if (mounted) return;
    mounted = true;
    panel.replaceChildren();
    panel.setAttribute("role", "complementary");
    panel.setAttribute("aria-label", "AI assistant");

    const grip = el("div", "cw-ai-grip");
    grip.title = "Resize";
    panel.append(grip);
    wireResize(grip);

    const head = el("div", "cw-ai-head");
    head.append(el("span", "cw-ai-title", "AI"));
    badgeEl = el("span", "cw-ai-badge");
    head.append(badgeEl, el("span", "cw-ai-spacer"));
    const newChat = el("button", "cw-ai-hbtn", "New chat");
    newChat.type = "button";
    newChat.title = "Start a new chat";
    newChat.addEventListener("click", () => deps.onNewChat());
    const settingsBtn = el("button", "cw-ai-hbtn", "⚙");
    settingsBtn.type = "button";
    settingsBtn.title = "AI provider settings";
    settingsBtn.setAttribute("aria-label", "AI provider settings");
    settingsBtn.addEventListener("click", () => deps.openSettings());
    const close = el("button", "cw-ai-hbtn cw-ai-close", "×");
    close.type = "button";
    close.title = "Close the AI panel";
    close.setAttribute("aria-label", "Close the AI panel");
    close.addEventListener("click", () => deps.onClose());
    head.append(newChat, settingsBtn, close);
    panel.append(head);

    msgs = el("div", "cw-ai-msgs");
    msgs.setAttribute("role", "log");
    msgs.setAttribute("aria-live", "polite");
    msgs.setAttribute("aria-relevant", "additions text");
    msgs.addEventListener("scroll", () => {
      if (!msgs) return;
      pinned = msgs.scrollTop + msgs.clientHeight >= msgs.scrollHeight - 24;
    });
    panel.append(msgs);

    queueEl = el("div", "cw-ai-queue");
    queueEl.style.display = "none";
    panel.append(queueEl);

    composer = el("div", "cw-ai-composer");
    input = el("textarea", "cw-ai-input");
    input.rows = 1;
    input.placeholder = "Ask about this document…";
    input.setAttribute("aria-label", "Message the AI assistant");
    input.addEventListener("input", autosize);
    input.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        submit();
      }
    });
    sendBtn = el("button", "cw-ai-send", "Send");
    sendBtn.type = "button";
    sendBtn.addEventListener("click", submit);
    stopBtn = el("button", "cw-ai-stop", "Stop");
    stopBtn.type = "button";
    stopBtn.style.display = "none";
    stopBtn.addEventListener("click", () => deps.onStop());
    composer.append(input, sendBtn, stopBtn);
    panel.append(composer);

    render();
  };

  const renderQueue = (): void => {
    if (!queueEl) return;
    const queue = deps.getQueue();
    const results = deps.getQueueResults();
    const busy = deps.isStreaming() || deps.isQueueRunning();
    queueEl.replaceChildren();
    if (queue.length > 0) {
      const head = el("div", "cw-ai-qhead");
      head.append(el("span", "cw-ai-qtitle", `Queue (${queue.length})`), el("span", "cw-ai-qspacer"));
      const run = el("button", "cw-ai-qbtn primary", "Run queue");
      run.type = "button";
      run.disabled = busy;
      run.addEventListener("click", () => deps.onRunQueue());
      const clear = el("button", "cw-ai-qbtn", "Clear");
      clear.type = "button";
      clear.addEventListener("click", () => deps.onClearQueue());
      head.append(run, clear);
      queueEl.append(head);
      for (const item of queue) {
        const itemEl = el("div", "cw-ai-qitem");
        const text = el("div", "cw-ai-qtext");
        text.append(el("div", "cw-ai-qquote", item.quote), el("div", "cw-ai-qinstr", item.instruction));
        const remove = el("button", "cw-ai-qx", "×");
        remove.type = "button";
        remove.title = "Remove queued edit";
        remove.setAttribute("aria-label", "Remove queued edit");
        remove.addEventListener("click", () => deps.onRemoveQueueItem(item.id));
        itemEl.append(text, remove);
        queueEl.append(itemEl);
      }
    }
    if (results.length > 0) {
      const head = el("div", "cw-ai-qhead");
      head.append(el("span", "cw-ai-qtitle", `Results (${results.length})`), el("span", "cw-ai-qspacer"));
      const all = el("button", "cw-ai-qbtn primary", "Apply all");
      all.type = "button";
      all.disabled = busy;
      all.addEventListener("click", () => deps.onApplyAllQueueResults());
      const dismiss = el("button", "cw-ai-qbtn", "Dismiss");
      dismiss.type = "button";
      dismiss.addEventListener("click", () => deps.onDismissQueueResults());
      head.append(all, dismiss);
      queueEl.append(head);
      for (const result of results) {
        const itemEl = el("div", "cw-ai-qitem");
        const text = el("div", "cw-ai-qtext");
        text.append(el("div", "cw-ai-qquote", result.quote), el("div", "cw-ai-qinstr", result.instruction));
        const apply = el("button", "cw-ai-qbtn primary", "Replace selection");
        apply.type = "button";
        apply.addEventListener("click", () => deps.onApplyQueueResult(result.id));
        itemEl.append(text, apply);
        queueEl.append(itemEl);
      }
    }
    queueEl.style.display = queue.length > 0 || results.length > 0 ? "" : "none";
  };

  const render = (): void => {
    if (!mounted || !msgs) return;
    if (badgeEl) badgeEl.textContent = modelBadge();
    renderQueue();
    const configured = deps.isConfigured();
    const turns = deps.getTurns();
    msgs.replaceChildren();
    if (!configured) msgs.append(setupCard());
    else if (turns.length === 0) msgs.append(emptyState());
    else for (const turn of turns) msgs.append(turnEl(turn));

    const streaming = deps.isStreaming();
    if (sendBtn) sendBtn.style.display = streaming ? "none" : "";
    if (stopBtn) stopBtn.style.display = streaming ? "" : "none";
    if (input) input.disabled = streaming || !configured;
    if (composer) composer.style.display = configured ? "" : "none";
    if (pinned) msgs.scrollTop = msgs.scrollHeight;
  };

  return {
    mount,
    render,
    focusComposer: () => input?.focus(),
    destroy: () => {
      panel.replaceChildren();
      mounted = false;
      msgs = null;
      input = null;
      sendBtn = null;
      stopBtn = null;
      badgeEl = null;
      composer = null;
      queueEl = null;
    },
  };
}
