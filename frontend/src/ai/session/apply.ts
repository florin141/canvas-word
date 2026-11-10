// Applying an assistant result to the document. Everything goes through normal
// editor commands and ONE transaction, so undo and the Suggesting-mode
// interceptor behave exactly as they do for typing.
//
// v1 formatting rule: the replacement inherits the run style at the start of
// the selection. Mixed formatting inside the old selection is flattened.

import {
  applyOp,
  blockById,
  blockIndexOf,
  DEFAULT_CHAR_STYLE,
  isInCell,
  styleAtRuns,
  styleOfCharAt,
  textOfRuns,
  type CharStyle,
  type Document,
  type DocPosition,
  type Op,
  type ParaStyle,
} from "@cw/shared";
import { deleteBackward, insertFragment, splitParagraph } from "../../editor/commands";
import type { Command, EditorState } from "../../editor/state";
import type { DocFragment } from "../../input/clipboard";
import type { AiHost } from "../host";
import type { TrackedAnchor } from "../context/selectionAnchor";

export type ApplyReason = "stale" | "empty" | "unsupported";
export type ApplyOutcome = { ok: true } | { ok: false; reason: ApplyReason };

/** Strip a markdown fence the model may have wrapped the answer in. */
export function normalizeReplacement(text: string): string {
  const trimmed = text.trim();
  const fence = /^```[a-zA-Z]*\n([\s\S]*?)\n```$/.exec(trimmed);
  return (fence ? fence[1]!.trim() : trimmed).replace(/\r\n/g, "\n");
}

/** Blank lines separate paragraphs; single newlines become soft line breaks. */
export function toParagraphs(text: string): string[] {
  const parts = text.split(/\n{2,}/).map((part) => part.replace(/\n/g, "\v"));
  const kept = parts.filter((part) => part.length > 0);
  return kept.length > 0 ? kept : [""];
}

function styleAt(doc: Document, position: DocPosition): { char: CharStyle; para: ParaStyle } | null {
  const block = blockById(doc, position.blockId);
  if (!block) return null;
  return {
    // The character AT the selection start (a boundary must pick the run that
    // starts there, not the one before it); the end-of-block case falls back.
    char:
      styleOfCharAt(block.runs, position.offset) ??
      styleAtRuns(block.runs, position.offset) ??
      DEFAULT_CHAR_STYLE,
    para: { ...block.style },
  };
}

const selectionOf = (start: DocPosition, end: DocPosition) => ({ anchor: start, focus: end });

/** Replace the anchored range with plain text (one undoable transaction). */
export function applyReplacement(host: AiHost, tracked: TrackedAnchor, replacement: string): ApplyOutcome {
  if (tracked.isStale()) return { ok: false, reason: "stale" };
  const current = tracked.current();
  const doc = host.getDocument();
  const style = styleAt(doc, current.start);
  if (!style) return { ok: false, reason: "stale" };

  const text = normalizeReplacement(replacement);
  const selection = selectionOf(current.start, current.end);
  const command =
    text.length === 0
      ? deleteBackward()
      : (() => {
          const paragraphs = toParagraphs(text);
          // Always insert RICH runs with the captured style: insertText inherits
          // the style AFTER the selection is deleted, which would lose the start
          // run's formatting (v1 rule: inherit the style at the selection start).
          const fragment: DocFragment = {
            blocks: paragraphs.map((paragraph) => ({
              runs: [{ text: paragraph, style: style.char }],
              style: style.para,
            })),
            inline: paragraphs.length === 1,
          };
          return insertFragment(fragment);
        })();
  // Probe first: a cross-block selection that crosses a table-cell boundary
  // cannot be structurally merged, and must NOT silently no-op.
  if (!command({ doc, selection })) return { ok: false, reason: "unsupported" };
  host.setSelection(selection);
  host.dispatch(command);
  host.focusEditor();
  host.refreshToolbars();
  return { ok: true };
}

/** Insert the result as new paragraph(s) directly below the anchored range.
 *  Split + insert are combined into ONE transaction (one Ctrl+Z). */
export function applyInsertBelow(host: AiHost, tracked: TrackedAnchor, replacement: string): ApplyOutcome {
  if (tracked.isStale()) return { ok: false, reason: "stale" };
  const current = tracked.current();
  const doc = host.getDocument();
  const endBlock = blockById(doc, current.end.blockId);
  if (!endBlock) return { ok: false, reason: "stale" };
  const text = normalizeReplacement(replacement);
  if (text.length === 0) return { ok: false, reason: "empty" };
  const paragraphs = toParagraphs(text);
  const style = styleAt(doc, current.end);
  if (!style) return { ok: false, reason: "stale" };
  const endOffset = textOfRuns(endBlock.runs).length;
  const caret = { blockId: current.end.blockId, offset: endOffset };
  // Inside a cell, multi-paragraph insertion is not supported; use soft breaks.
  const inline = paragraphs.length === 1 || isInCell(doc, current.end.blockId);
  const paragraphTexts = inline ? [paragraphs.join("\v")] : paragraphs;

  const command: Command = (state) => {
    const seeded: EditorState = { ...state, selection: { anchor: caret, focus: { ...caret } } };
    const split = splitParagraph()(seeded);
    if (!split) return null;
    let scratchDoc = state.doc;
    for (const op of split.ops) scratchDoc = applyOp(scratchDoc, op).doc;
    const insertState: EditorState = { ...state, doc: scratchDoc, selection: split.selectionAfter };
    const insert = insertFragment({
      blocks: paragraphTexts.map((paragraph) => ({
        runs: [{ text: paragraph, style: style.char }],
        style: style.para,
      })),
      inline: paragraphTexts.length === 1,
    })(insertState);
    if (!insert) return { ...split, origin: "command" };
    return { ops: [...split.ops, ...insert.ops], selectionAfter: insert.selectionAfter, origin: "command" };
  };

  if (!command({ doc: host.getDocument(), selection: host.getSelection() })) {
    return { ok: false, reason: "unsupported" };
  }
  host.dispatch(command);
  host.focusEditor();
  host.refreshToolbars();
  return { ok: true };
}

export interface BatchEntry {
  tracked: TrackedAnchor;
  replacement: string;
}

export interface BatchOutcome {
  applied: number;
  skipped: number;
}

/** Do two same-block ranges overlap? (Cross-block overlap is left to the caller —
 *  anchored edits from one Ask AI session are disjoint in practice.) */
function sameBlockOverlap(
  a: { start: DocPosition; end: DocPosition },
  b: { start: DocPosition; end: DocPosition },
): boolean {
  if (a.start.blockId !== b.start.blockId) return false;
  const a0 = Math.min(a.start.offset, a.end.offset);
  const a1 = Math.max(a.start.offset, a.end.offset);
  const b0 = Math.min(b.start.offset, b.end.offset);
  const b1 = Math.max(b.start.offset, b.end.offset);
  return a0 < b1 && b0 < a1;
}

/** Apply several anchored replacements as ONE transaction (one Ctrl+Z). Ranges
 *  are processed in reverse document order so earlier offsets stay valid.
 *  Stale entries and same-block overlaps are skipped. */
export function applyAllReplacements(host: AiHost, entries: readonly BatchEntry[]): BatchOutcome {
  const doc = host.getDocument();
  const valid = entries.filter(
    (entry) => !entry.tracked.isStale() && normalizeReplacement(entry.replacement).length > 0,
  );
  const ordered = [...valid].sort((a, b) => {
    const left = a.tracked.current();
    const right = b.tracked.current();
    const leftIndex = blockIndexOf(doc, left.start.blockId);
    const rightIndex = blockIndexOf(doc, right.start.blockId);
    return rightIndex - leftIndex || right.start.offset - left.start.offset;
  });
  const accepted: BatchEntry[] = [];
  for (const entry of ordered) {
    const current = entry.tracked.current();
    if (accepted.some((other) => sameBlockOverlap(other.tracked.current(), current))) continue;
    accepted.push(entry);
  }
  if (accepted.length === 0) return { applied: 0, skipped: entries.length };

  let applied = 0;
  const command: Command = (state) => {
    let scratch: EditorState = state;
    const ops: Op[] = [];
    for (const entry of accepted) {
      const current = entry.tracked.current();
      const style = styleAt(scratch.doc, current.start);
      if (!style) continue;
      const paragraphs = toParagraphs(normalizeReplacement(entry.replacement));
      const seeded: EditorState = { ...scratch, selection: selectionOf(current.start, current.end) };
      const insert = insertFragment({
        blocks: paragraphs.map((paragraph) => ({
          runs: [{ text: paragraph, style: style.char }],
          style: style.para,
        })),
        inline: paragraphs.length === 1,
      })(seeded);
      if (!insert) continue;
      ops.push(...insert.ops);
      let nextDoc = scratch.doc;
      for (const op of insert.ops) nextDoc = applyOp(nextDoc, op).doc;
      scratch = { ...scratch, doc: nextDoc, selection: insert.selectionAfter };
      applied++;
    }
    if (ops.length === 0) return null;
    return { ops, selectionAfter: scratch.selection, origin: "command" };
  };
  host.dispatch(command);
  host.focusEditor();
  host.refreshToolbars();
  return { applied, skipped: entries.length - applied };
}

export async function copyResult(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
