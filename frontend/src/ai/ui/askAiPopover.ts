// Ask AI popover: the four-chip card from the design. It owns focus while open
// (the editor paints the selection in the inactive gray style) and calls back
// with the final instruction. Keyboard: Esc closes, Enter sends, Tab is trapped.

import { placeSelectionBar, type AnchorRect } from "../../ui/floatingBarPosition";
import { injectCssOnce } from "../../ui/styles";
import type { AiChip } from "../context/promptBuilder";

export type CloseReason = "dismiss" | "outside" | "action";

export interface AskAiPopoverDeps {
  anchor: AnchorRect;
  text: string;
  chips: readonly AiChip[];
  onSend(instruction: string): void;
  onQueue(instruction: string): void;
  onClose(reason: CloseReason): void;
}

export interface AskAiPopoverHandle {
  close(reason?: CloseReason): void;
}

const CSS = `
.cw-ai-pop{position:fixed;z-index:60;width:min(360px,calc(100vw - 24px));background:#fff;border:1px solid #d0d4d9;
  border-radius:12px;box-shadow:0 10px 34px rgba(0,0,0,.20);padding:12px;display:flex;flex-direction:column;gap:9px;
  font:13px/1.45 system-ui,"Segoe UI",Arial,sans-serif;color:#202124;}
.cw-ai-pop-head{display:flex;align-items:flex-start;gap:8px;}
.cw-ai-pop-title{font-weight:600;font-size:13px;flex:1 1 auto;}
.cw-ai-pop-x{border:none;background:transparent;color:#5f6368;font-size:18px;line-height:1;cursor:pointer;width:24px;height:24px;border-radius:6px;}
.cw-ai-pop-x:hover{background:#f1f3f4;color:#202124;}
.cw-ai-pop-preview{color:#5f6368;font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.cw-ai-pop-input{height:34px;border:1px solid #d0d4d9;border-radius:8px;padding:0 9px;font:inherit;font-size:13px;background:#fff;color:inherit;outline:none;}
.cw-ai-pop-input:focus{border-color:#e8643c;box-shadow:0 0 0 2px rgba(232,100,60,.18);}
.cw-ai-pop-chips{display:flex;flex-wrap:wrap;gap:6px;}
.cw-ai-pop-chip{border:1px solid #d0d4d9;background:#f7f8fa;color:#3c4043;border-radius:999px;padding:4px 10px;font:inherit;font-size:11.5px;cursor:pointer;}
.cw-ai-pop-chip:hover{background:#fdeee8;border-color:#e8a68c;color:#a34a2a;}
.cw-ai-pop-foot{display:flex;justify-content:flex-end;gap:8px;padding-top:2px;}
.cw-ai-pop-foot button{height:30px;padding:0 13px;border-radius:7px;font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;}
.cw-ai-pop-send{border:1px solid #d0d4d9;background:#fff;color:#3c4043;}
.cw-ai-pop-send:hover:not(:disabled){background:#f3f4f6;}
.cw-ai-pop-queue{border:1px solid #e8643c;background:#e8643c;color:#fff;}
.cw-ai-pop-queue:hover:not(:disabled){background:#d4552f;}
.cw-ai-pop-foot button:disabled{opacity:.45;cursor:default;}
:root[data-theme="dark"] .cw-ai-pop{background:#26282c;border-color:#4a4a4a;color:#e6e6e6;}
:root[data-theme="dark"] .cw-ai-pop-x:hover{background:#34373c;color:#f0f0f0;}
:root[data-theme="dark"] .cw-ai-pop-preview{color:#9aa0a6;}
:root[data-theme="dark"] .cw-ai-pop-input{background:#1e1f22;border-color:#4a4a4a;color:#e6e6e6;}
:root[data-theme="dark"] .cw-ai-pop-chip{background:#2a2c30;border-color:#4a4a4a;color:#e6e6e6;}
:root[data-theme="dark"] .cw-ai-pop-chip:hover{background:#3a2b26;border-color:#8a4b32;color:#f0b49c;}
:root[data-theme="dark"] .cw-ai-pop-send{background:#2a2c30;border-color:#4a4a4a;color:#e6e6e6;}
`;

export function openAskAiPopover(deps: AskAiPopoverDeps): AskAiPopoverHandle {
  injectCssOnce("cw-ai-pop-styles", CSS);

  const card = document.createElement("div");
  card.className = "cw-ai-pop";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-label", "Ask AI about the selection");

  const head = document.createElement("div");
  head.className = "cw-ai-pop-head";
  const title = document.createElement("span");
  title.className = "cw-ai-pop-title";
  title.textContent = "Ask AI about the selection";
  const closeBtn = document.createElement("button");
  closeBtn.className = "cw-ai-pop-x";
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "×";
  head.append(title, closeBtn);

  const preview = document.createElement("div");
  preview.className = "cw-ai-pop-preview";
  preview.textContent = deps.text;
  preview.title = deps.text.slice(0, 500);

  const input = document.createElement("input");
  input.className = "cw-ai-pop-input";
  input.type = "text";
  input.placeholder = "Ask anything about this selection…";
  input.setAttribute("aria-label", "Instruction for the AI");

  const chips = document.createElement("div");
  chips.className = "cw-ai-pop-chips";
  const chipButtons: HTMLButtonElement[] = [];
  for (const chip of deps.chips) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cw-ai-pop-chip";
    button.textContent = chip.label;
    button.addEventListener("click", () => {
      input.value = chip.label;
      refreshEnabled();
      input.focus();
    });
    chipButtons.push(button);
    chips.append(button);
  }

  const foot = document.createElement("div");
  foot.className = "cw-ai-pop-foot";
  const send = document.createElement("button");
  send.type = "button";
  send.className = "cw-ai-pop-send";
  send.textContent = "Send now";
  const queue = document.createElement("button");
  queue.type = "button";
  queue.className = "cw-ai-pop-queue";
  queue.textContent = "Add to queue";
  foot.append(send, queue);

  const refreshEnabled = (): void => {
    const empty = input.value.trim().length === 0;
    send.disabled = empty;
    queue.disabled = empty;
  };

  let closed = false;
  const close = (reason: CloseReason = "dismiss"): void => {
    if (closed) return;
    closed = true;
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("resize", position);
    window.removeEventListener("scroll", onScroll, true);
    card.remove();
    deps.onClose(reason);
  };

  const act = (kind: "send" | "queue"): void => {
    const instruction = input.value.trim();
    if (!instruction) return;
    close("action");
    if (kind === "send") deps.onSend(instruction);
    else deps.onQueue(instruction);
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (!card.contains(event.target as Node)) close("outside");
  };
  const onScroll = (): void => close("outside");
  const position = (): void => {
    const width = card.offsetWidth || 360;
    const height = card.offsetHeight || 220;
    const { left, top } = placeSelectionBar(
      deps.anchor,
      { width, height },
      { width: window.innerWidth, height: window.innerHeight },
      { mode: "below", margin: 12, gap: 8 },
    );
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  };

  const focusables = (): HTMLElement[] => [input, ...chipButtons, send, queue, closeBtn];
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close("dismiss");
      return;
    }
    if (event.key !== "Tab") return;
    const items = focusables();
    const index = items.indexOf(document.activeElement as HTMLElement);
    const delta = event.shiftKey ? -1 : 1;
    const next = items[(index + delta + items.length) % items.length]!;
    event.preventDefault();
    next.focus();
  };

  input.addEventListener("input", refreshEnabled);
  input.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      act("send");
    }
  });
  send.addEventListener("click", () => act("send"));
  queue.addEventListener("click", () => act("queue"));
  closeBtn.addEventListener("click", () => close("dismiss"));

  card.append(head, preview, input, chips, foot);
  document.body.append(card);
  position();
  refreshEnabled();
  input.focus();

  setTimeout(() => {
    if (closed) return;
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", onScroll, true);
  }, 0);

  return { close };
}
