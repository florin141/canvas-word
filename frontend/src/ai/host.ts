// Narrow bridge between the lazy AI module and the live editor. The editor app
// implements this object; the AI feature never reaches into editor internals
// directly, so its session/apply logic stays testable with a fake host.

import type { DocPosition, DocSelection, Document } from "@cw/shared";
import type { Command } from "../editor/state";

/** Client-viewport (CSS px) rectangle. */
export interface AiRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface AiHost {
  /** Aborted on editor teardown — the feature removes its DOM/listeners on it. */
  readonly signal: AbortSignal;
  /** Right-docked aside created by the editor shell; the panel renders inside. */
  readonly panelEl: HTMLElement;
  /** Editor root, for scoping lookups/classes. */
  readonly rootEl: HTMLElement;

  getDocument(): Document;
  getSelection(): DocSelection | null;
  setSelection(sel: DocSelection | null): void;
  /** Client rect of the current selection's first line, or null. */
  getSelectionRect(): AiRect | null;
  /** True for a non-empty text range (not a caret/object/cell selection). */
  hasRangeSelection(): boolean;
  getMode(): "edit" | "suggest" | "view";
  isReadonly(): boolean;
  /** Monotonic change counter used as an anchor revision. */
  getChangeHead(): number;

  /** Apply a command as ONE transaction (one undo entry). */
  dispatch(command: Command): void;
  /** Return keyboard focus to the hidden IME proxy. */
  focusEditor(): void;

  /** Rebase a stored position through every subsequent local/remote op. */
  trackPositions(fn: (map: (p: DocPosition) => DocPosition) => void): () => void;
  /** Paint the live selection in the inactive (gray) style while the popover owns
   *  focus, then restore it on close. */
  setSelectionInactive(inactive: boolean): void;

  /** Non-modal toast (errors/warnings that must not block the editor). */
  notify(message: string, kind?: "info" | "warning"): void;

  /** Toggle the in-flow panel aside (the feature owns everything inside it). */
  setPanelOpen(open: boolean): void;
  /** Re-evaluate floating context toolbars after a programmatic selection. */
  refreshToolbars(): void;
}
