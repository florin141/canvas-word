import { describe, expect, it } from "vitest";
import { createChatStore } from "./chatStore";

describe("chatStore", () => {
  it("adds turns with optional quote/anchor and streams deltas", () => {
    const store = createChatStore();
    const user = store.addUser("Polish", { quote: "Hello", anchorId: "a1" });
    expect(user.quote).toBe("Hello");
    expect(user.anchorId).toBe("a1");

    const assistant = store.startAssistant({ anchorId: "a1" });
    store.appendDelta(assistant.id, "Hel");
    store.appendDelta(assistant.id, "lo");
    store.finish(assistant.id);

    const turns = store.turns();
    expect(turns).toHaveLength(2);
    expect(turns[1]).toMatchObject({ role: "assistant", content: "Hello", streaming: false });
  });

  it("history excludes the current turn and failed answers", () => {
    const store = createChatStore();
    store.addUser("one");
    const a1 = store.startAssistant();
    store.appendDelta(a1.id, "first");
    store.finish(a1.id);
    store.addUser("two");
    const a2 = store.startAssistant();
    store.fail(a2.id, "network", "nope");

    expect(store.history()).toEqual([
      { role: "user", content: "one" },
      { role: "assistant", content: "first" },
      { role: "user", content: "two" },
    ]);
    expect(store.history(a1.id)).toEqual([
      { role: "user", content: "one" },
      { role: "user", content: "two" },
    ]);
  });

  it("finds the user turn before an answer, and supports removal/clear", () => {
    const store = createChatStore();
    const user = store.addUser("question");
    const assistant = store.startAssistant();
    store.fail(assistant.id, "auth", "bad key");
    expect(store.lastUserBefore(assistant.id)).toEqual(user);
    expect(store.lastUserBefore("missing")).toBeNull();

    store.remove(assistant.id);
    expect(store.turns()).toHaveLength(1);
    store.clear();
    expect(store.turns()).toHaveLength(0);
  });

  it("stop keeps the partial answer but ends streaming", () => {
    const store = createChatStore();
    const assistant = store.startAssistant();
    store.appendDelta(assistant.id, "partial");
    store.stop(assistant.id);
    expect(store.turns()[0]).toMatchObject({ content: "partial", streaming: false });
  });
});
