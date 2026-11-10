import { describe, expect, it } from "vitest";
import {
  applyOp,
  type Block,
  type CharStyle,
  type Document,
  type DocPosition,
  type DocSelection,
  type Op,
  type ParaStyle,
  type Paragraph,
  type SectionProps,
} from "@cw/shared";
import type { AiHost } from "../host";
import { captureAnchor, trackAnchor } from "./selectionAnchor";

const section = (): SectionProps => ({
  pageWidthPx: 816,
  pageHeightPx: 1056,
  marginPx: { top: 96, right: 96, bottom: 96, left: 96 },
});
const CHAR: CharStyle = {
  fontFamily: "Georgia",
  fontSizePx: 16,
  bold: false,
  italic: false,
  underline: false,
  strikethrough: false,
  color: "#000",
};
const PARA: ParaStyle = {
  align: "left",
  lineHeight: 1.2,
  spaceBeforePx: 0,
  spaceAfterPx: 0,
  indentFirstLinePx: 0,
  indentLeftPx: 0,
};
const para = (id: string, text: string): Paragraph => ({
  kind: "paragraph",
  id,
  revision: 0,
  runs: [{ text, style: CHAR }],
  style: PARA,
});
const docOf = (...blocks: Block[]): Document => ({ section: section(), blocks });

function fakeHost(doc: Document, selection: DocSelection): {
  host: AiHost;
  apply(op: Op): void;
} {
  let currentDoc = doc;
  let currentSelection: DocSelection | null = selection;
  const trackers = new Set<(map: (p: DocPosition) => DocPosition) => void>();
  const host = {
    signal: new AbortController().signal,
    panelEl: {} as HTMLElement,
    rootEl: {} as HTMLElement,
    getDocument: () => currentDoc,
    getSelection: () => currentSelection,
    setSelection: (sel: DocSelection | null) => {
      currentSelection = sel;
    },
    getSelectionRect: () => ({ left: 0, top: 0, width: 10, height: 10 }),
    hasRangeSelection: () => {
      const sel = currentSelection;
      return !!sel && !(sel.anchor.blockId === sel.focus.blockId && sel.anchor.offset === sel.focus.offset);
    },
    getMode: () => "edit" as const,
    isReadonly: () => false,
    getChangeHead: () => 0,
    dispatch: () => {},
    focusEditor: () => {},
    trackPositions: (fn: (map: (p: DocPosition) => DocPosition) => void) => {
      trackers.add(fn);
      return () => {
        trackers.delete(fn);
      };
    },
    setSelectionInactive: () => {},
    notify: () => {},
    setPanelOpen: () => {},
    refreshToolbars: () => {},
  } as AiHost;
  return {
    host,
    apply(op) {
      const result = applyOp(currentDoc, op);
      currentDoc = result.doc;
      for (const fn of trackers) fn(result.mapPosition);
    },
  };
}

const range = (start: number, end: number): DocSelection => ({
  anchor: { blockId: "p", offset: start },
  focus: { blockId: "p", offset: end },
});

describe("selection anchors", () => {
  it("captures the selected text and its context windows", () => {
    const { host } = fakeHost(docOf(para("p", "Hello world")), range(6, 11));
    const anchor = captureAnchor(host);
    expect(anchor).not.toBeNull();
    expect(anchor!.text).toBe("world");
    expect(anchor!.before).toBe("Hello ");
    expect(anchor!.after).toBe("");
  });

  it("returns null for a collapsed caret", () => {
    const { host } = fakeHost(docOf(para("p", "Hello")), range(2, 2));
    expect(captureAnchor(host)).toBeNull();
  });

  it("rebases through an insert before the range", () => {
    const { host, apply } = fakeHost(docOf(para("p", "Hello world")), range(6, 11));
    const tracked = trackAnchor(host, captureAnchor(host)!);
    apply({ type: "insertText", at: { blockId: "p", offset: 0 }, text: "X " });
    expect(tracked.current().start).toEqual({ blockId: "p", offset: 8 });
    expect(tracked.current().end).toEqual({ blockId: "p", offset: 13 });
    expect(tracked.isStale()).toBe(false);
  });

  it("goes stale when the range text changes or is deleted", () => {
    const { host, apply } = fakeHost(docOf(para("p", "Hello world")), range(6, 11));
    const tracked = trackAnchor(host, captureAnchor(host)!);
    apply({ type: "insertText", at: { blockId: "p", offset: 11 }, text: "ly" }); // world → worldly
    expect(tracked.isStale()).toBe(true);
  });

  it("goes stale when the range is removed", () => {
    const { host, apply } = fakeHost(docOf(para("p", "Hello world")), range(6, 11));
    const tracked = trackAnchor(host, captureAnchor(host)!);
    apply({ type: "deleteRange", blockId: "p", start: 6, end: 11 });
    expect(tracked.isStale()).toBe(true);
  });
});
