import { describe, expect, it } from "vitest";
import {
  applyOp,
  textOfRuns,
  type Block,
  type CharStyle,
  type Document,
  type DocPosition,
  type DocSelection,
  type Paragraph,
  type ParaStyle,
  type SectionProps,
} from "@cw/shared";
import { captureAnchor, trackAnchor, type TrackedAnchor } from "../context/selectionAnchor";
import type { AiHost } from "../host";
import { applyAllReplacements, applyInsertBelow, applyReplacement } from "./apply";

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
const BOLD: CharStyle = { ...CHAR, bold: true };
const PARA: ParaStyle = {
  align: "left",
  lineHeight: 1.2,
  spaceBeforePx: 0,
  spaceAfterPx: 0,
  indentFirstLinePx: 0,
  indentLeftPx: 0,
};
const para = (id: string, text: string, style: CharStyle = CHAR): Paragraph => ({
  kind: "paragraph",
  id,
  revision: 0,
  runs: [{ text, style }],
  style: PARA,
});
const docOf = (...blocks: Block[]): Document => ({ section: section(), blocks });

interface Fake {
  host: AiHost;
  doc: () => Document;
  dispatches: () => number;
}

function fakeHost(doc: Document, selection: DocSelection): Fake {
  let currentDoc = doc;
  let currentSelection: DocSelection | null = selection;
  let dispatchCount = 0;
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
    hasRangeSelection: () => true,
    getMode: () => "edit" as const,
    isReadonly: () => false,
    getChangeHead: () => 0,
    dispatch: (command: Parameters<AiHost["dispatch"]>[0]) => {
      const trn = command({ doc: currentDoc, selection: currentSelection });
      if (!trn) return;
      dispatchCount++;
      for (const op of trn.ops) {
        const result = applyOp(currentDoc, op);
        currentDoc = result.doc;
        for (const fn of trackers) fn(result.mapPosition);
      }
      currentSelection = trn.selectionAfter;
    },
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
    doc: () => currentDoc,
    dispatches: () => dispatchCount,
  };
}

function trackedFor(fake: Fake, start: number, end: number): TrackedAnchor {
  fake.host.setSelection({
    anchor: { blockId: "p", offset: start },
    focus: { blockId: "p", offset: end },
  });
  return trackAnchor(fake.host, captureAnchor(fake.host)!);
}

const textOf = (doc: Document): string =>
  doc.blocks.map((block) => (block.kind === "paragraph" ? textOfRuns(block.runs) : "")).join("\n");

describe("applyReplacement", () => {
  it("replaces the range in one transaction, inheriting the start run style", () => {
    // "Hello world" with a bold "world" — replacing it keeps bold.
    const doc = docOf({
      kind: "paragraph",
      id: "p",
      revision: 0,
      runs: [
        { text: "Hello ", style: CHAR },
        { text: "world", style: BOLD },
      ],
      style: PARA,
    });
    const fake = fakeHost(doc, { anchor: { blockId: "p", offset: 6 }, focus: { blockId: "p", offset: 11 } });
    const tracked = trackedFor(fake, 6, 11);
    expect(applyReplacement(fake.host, tracked, "there")).toEqual({ ok: true });
    expect(fake.dispatches()).toBe(1);
    expect(textOf(fake.doc())).toBe("Hello there");
    const block = fake.doc().blocks[0] as Paragraph;
    expect(block.runs.find((run) => run.text.includes("there"))?.style.bold).toBe(true);
  });

  it("splits blank-line-separated replacements into paragraphs", () => {
    const fake = fakeHost(docOf(para("p", "One")), { anchor: { blockId: "p", offset: 0 }, focus: { blockId: "p", offset: 3 } });
    const tracked = trackedFor(fake, 0, 3);
    expect(applyReplacement(fake.host, tracked, "First\n\nSecond")).toEqual({ ok: true });
    expect(fake.dispatches()).toBe(1);
    expect(fake.doc().blocks.filter((block) => block.kind === "paragraph").map((block) => textOfRuns(block.runs))).toEqual([
      "First",
      "Second",
    ]);
  });

  it("routes a multi-paragraph replacement through one transaction", () => {
    const fake = fakeHost(docOf(para("p", "A"), para("q", "B")), {
      anchor: { blockId: "p", offset: 0 },
      focus: { blockId: "q", offset: 1 },
    });
    const tracked = trackAnchor(fake.host, captureAnchor(fake.host)!);
    expect(applyReplacement(fake.host, tracked, "New\n\nText")).toEqual({ ok: true });
    expect(fake.dispatches()).toBe(1);
    expect(fake.doc().blocks.length).toBe(2);
  });

  it("refuses a stale anchor", () => {
    const fake = fakeHost(docOf(para("p", "Hello")), { anchor: { blockId: "p", offset: 0 }, focus: { blockId: "p", offset: 5 } });
    const tracked = trackedFor(fake, 0, 5);
    fake.host.dispatch(() => ({
      ops: [{ type: "insertText", at: { blockId: "p", offset: 2 }, text: "!" }],
      selectionAfter: null,
      origin: "command",
    }));
    expect(applyReplacement(fake.host, tracked, "x")).toEqual({ ok: false, reason: "stale" });
  });
});

describe("applyInsertBelow", () => {
  it("inserts a new paragraph below the range in one transaction", () => {
    const fake = fakeHost(docOf(para("p", "Hello")), { anchor: { blockId: "p", offset: 0 }, focus: { blockId: "p", offset: 5 } });
    const tracked = trackedFor(fake, 0, 5);
    expect(applyInsertBelow(fake.host, tracked, "Extra")).toEqual({ ok: true });
    expect(fake.dispatches()).toBe(1);
    expect(fake.doc().blocks.map((block) => (block.kind === "paragraph" ? textOfRuns(block.runs) : ""))).toEqual([
      "Hello",
      "Extra",
    ]);
  });
});

describe("applyAllReplacements", () => {
  it("applies several replacements in ONE transaction", () => {
    const fake = fakeHost(docOf(para("p", "AAA"), para("q", "BBB")), {
      anchor: { blockId: "p", offset: 0 },
      focus: { blockId: "p", offset: 3 },
    });
    const first = trackedFor(fake, 0, 3);
    fake.host.setSelection({ anchor: { blockId: "q", offset: 0 }, focus: { blockId: "q", offset: 3 } });
    const second = trackAnchor(fake.host, captureAnchor(fake.host)!);
    const outcome = applyAllReplacements(fake.host, [
      { tracked: first, replacement: "111" },
      { tracked: second, replacement: "222" },
    ]);
    expect(outcome).toEqual({ applied: 2, skipped: 0 });
    expect(fake.dispatches()).toBe(1);
    expect(fake.doc().blocks.map((block) => (block.kind === "paragraph" ? textOfRuns(block.runs) : ""))).toEqual([
      "111",
      "222",
    ]);
  });
});
