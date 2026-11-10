// Selection anchors for Ask AI. An anchor snapshots the range + its text at
// capture time and then rides EVERY op's position mapper (the same mechanism
// bookmarks/review anchors use) until it is disposed. Apply refuses a stale
// anchor — a mapped range whose text no longer matches the snapshot.

import { textOfRange, type DocPosition } from "@cw/shared";
import type { AiHost } from "../host";
import { selectionContext } from "./promptBuilder";

export interface SelectionAnchor {
  id: string;
  start: DocPosition;
  end: DocPosition;
  /** Snapshot of the selected text; never updated by rebasing. */
  text: string;
  before: string;
  after: string;
  /** Change counter at capture (diagnostics/debugging). */
  revision: number;
}

export interface TrackedAnchor {
  /** The anchor as captured. */
  readonly anchor: SelectionAnchor;
  /** The anchor rebased to the current document. */
  current(): SelectionAnchor;
  /** True when the mapped range is gone or its text no longer matches. */
  isStale(): boolean;
  dispose(): void;
}

let seq = 0;
export const nextAnchorId = (): string => `ai-anchor-${++seq}-${Date.now().toString(36)}`;

/** Capture the current range selection, or null for a caret/object selection. */
export function captureAnchor(host: AiHost): SelectionAnchor | null {
  const selection = host.getSelection();
  if (!selection) return null;
  const collapsed =
    selection.anchor.blockId === selection.focus.blockId && selection.anchor.offset === selection.focus.offset;
  if (collapsed) return null;
  const doc = host.getDocument();
  const context = selectionContext(doc, selection.anchor, selection.focus);
  const text = textOfRange(doc, selection.anchor, selection.focus);
  if (!context || text === null || text.length === 0) return null;
  return {
    id: nextAnchorId(),
    start: selection.anchor,
    end: selection.focus,
    text,
    before: context.before,
    after: context.after,
    revision: host.getChangeHead(),
  };
}

/** Follow an anchor through subsequent local/remote edits. */
export function trackAnchor(host: AiHost, anchor: SelectionAnchor): TrackedAnchor {
  let current = anchor;
  const dispose = host.trackPositions((map) => {
    current = { ...current, start: map(current.start), end: map(current.end) };
  });
  return {
    anchor,
    current: () => current,
    isStale: () => {
      const text = textOfRange(host.getDocument(), current.start, current.end);
      return text === null || text !== current.text;
    },
    dispose,
  };
}
