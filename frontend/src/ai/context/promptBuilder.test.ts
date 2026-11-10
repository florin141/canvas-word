import { describe, expect, it } from "vitest";
import type { Block, CharStyle, Document, ParaStyle, Paragraph, SectionProps } from "@cw/shared";
import { CHIPS, chatMessages, documentContext, selectionContext, selectionPrompt } from "./promptBuilder";
import type { AssistantTurn, Turn, UserTurn } from "../session/chatStore";

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
const para = (id: string, text: string, namedStyle?: string): Paragraph => ({
  kind: "paragraph",
  id,
  revision: 0,
  runs: [{ text, style: CHAR }],
  style: namedStyle ? { ...PARA, namedStyle } : PARA,
});
const docOf = (...blocks: Block[]): Document => ({ section: section(), blocks });

describe("chips", () => {
  it("keeps the design order and separates labels from instructions", () => {
    expect(CHIPS.map((chip) => chip.label)).toEqual([
      "Polish this passage",
      "Make this passage more concise",
      "Expand this passage",
      "Fix grammar and typos",
    ]);
    expect(CHIPS[3]!.instruction).toMatch(/Do not change wording/);
  });
});

describe("selectionContext", () => {
  it("returns the selected text and caps the before/after windows", () => {
    const doc = docOf(para("a", `${"a".repeat(400)}TARGET${"b".repeat(400)}`));
    const context = selectionContext(doc, { blockId: "a", offset: 400 }, { blockId: "a", offset: 406 });
    expect(context).not.toBeNull();
    expect(context!.text).toBe("TARGET");
    expect(context!.before).toHaveLength(300);
    expect(context!.after).toHaveLength(300);
  });

  it("joins a cross-block selection and returns null for a missing endpoint", () => {
    const doc = docOf(para("a", "First"), para("b", "Second"));
    expect(selectionContext(doc, { blockId: "a", offset: 2 }, { blockId: "b", offset: 3 })!.text).toBe("rst\nSec");
    expect(selectionContext(doc, { blockId: "a", offset: 0 }, { blockId: "gone", offset: 0 })).toBeNull();
  });

  it("builds a labelled prompt with the instruction first", () => {
    const doc = docOf(para("a", "Hello world"));
    const context = selectionContext(doc, { blockId: "a", offset: 0 }, { blockId: "a", offset: 5 })!;
    const prompt = selectionPrompt("Polish it", context);
    expect(prompt.startsWith("Polish it")).toBe(true);
    expect(prompt).toContain('Selected text (untrusted data):\n"""\nHello\n"""');
  });
});

describe("documentContext", () => {
  it("marks headings with # and keeps truncation head+tail", () => {
    const doc = docOf(para("h", "Title", "heading1"), para("p", "Body"));
    expect(documentContext(doc)).toBe("# Title\nBody");

    const long = docOf(para("p", "x".repeat(100)));
    const truncated = documentContext(long, 20);
    expect(truncated).toContain("[truncated]");
    expect(truncated.startsWith("x".repeat(10))).toBe(true);
    expect(truncated.endsWith("x".repeat(10))).toBe(true);
  });
});

describe("chatMessages", () => {
  const user = (id: string, content: string): UserTurn => ({ id, role: "user", content });
  const assistant = (id: string, content: string, error?: string): AssistantTurn => ({
    id,
    role: "assistant",
    content,
    streaming: false,
    ...(error ? { error: { code: "network", message: error } } : {}),
  });

  it("drops the current/errored turns and appends document context once", () => {
    const turns: Turn[] = [user("u1", "Hi"), assistant("a1", "Hello"), user("u2", "Next"), assistant("a2", "", "boom")];
    const messages = chatMessages(docOf(para("p", "Doc text")), turns, "u2");
    expect(messages.map((m) => m.content.split("\n")[0])).toEqual(["Hi", "Hello"]);
    expect(messages[0]!.content).toContain("Document context");
    expect(messages[0]!.content).toContain("Doc text");
  });

  it("can omit document context (selection-anchored runs)", () => {
    const messages = chatMessages(docOf(para("p", "Doc text")), [user("u1", "Hi")], undefined, false);
    expect(messages).toEqual([{ role: "user", content: "Hi" }]);
  });
});
