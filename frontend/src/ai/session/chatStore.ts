// In-memory chat state: user/assistant turns, streaming flags, and failures.
// Deliberately UI-free (the panel renders from it; the runner mutates it).

import type { ChatMessage } from "../types";

export interface UserTurn {
  id: string;
  role: "user";
  /** What the transcript shows (the instruction, not the embedded context). */
  content: string;
  /** What the provider receives, when it differs from the transcript (a
   *  selection prompt embeds the passage + windows as labelled data). */
  prompt?: string;
  /** Quoted selection shown above the message, when it came from Ask AI. */
  quote?: string;
  /** Selection anchor id, when the turn is anchored to a range. */
  anchorId?: string;
}

export interface AssistantTurn {
  id: string;
  role: "assistant";
  content: string;
  streaming: boolean;
  error?: { code: string; message: string };
  /** The anchor this answer is for (Apply actions target it). */
  anchorId?: string;
}

export type Turn = UserTurn | AssistantTurn;

export interface ChatStore {
  turns(): readonly Turn[];
  addUser(content: string, opts?: { quote?: string; anchorId?: string; prompt?: string }): UserTurn;
  startAssistant(opts?: { anchorId?: string }): AssistantTurn;
  appendDelta(id: string, delta: string): void;
  /** Mark a streaming answer complete. */
  finish(id: string): void;
  /** Stop a stream but keep the partial text. */
  stop(id: string): void;
  fail(id: string, code: string, message: string): void;
  remove(id: string): void;
  clear(): void;
  /** Provider history (completed user/assistant turns, failed answers dropped). */
  history(excludeId?: string): ChatMessage[];
  /** The most recent user turn before `id` (for Retry). */
  lastUserBefore(id: string): UserTurn | null;
}

let seq = 0;
const nextId = (prefix: string): string => `${prefix}-${++seq}-${Date.now().toString(36)}`;

export function createChatStore(): ChatStore {
  let turns: Turn[] = [];
  const find = (id: string): Turn | undefined => turns.find((turn) => turn.id === id);

  return {
    turns: () => turns,

    addUser(content, opts) {
      const turn: UserTurn = { id: nextId("u"), role: "user", content };
      if (opts?.prompt) turn.prompt = opts.prompt;
      if (opts?.quote) turn.quote = opts.quote;
      if (opts?.anchorId) turn.anchorId = opts.anchorId;
      turns = [...turns, turn];
      return turn;
    },

    startAssistant(opts) {
      const turn: AssistantTurn = { id: nextId("a"), role: "assistant", content: "", streaming: true };
      if (opts?.anchorId) turn.anchorId = opts.anchorId;
      turns = [...turns, turn];
      return turn;
    },

    appendDelta(id, delta) {
      const turn = find(id);
      if (!turn || turn.role !== "assistant") return;
      turn.content += delta;
      turns = [...turns]; // identity change so simple memoized consumers re-read
    },

    finish(id) {
      const turn = find(id);
      if (!turn || turn.role !== "assistant") return;
      turn.streaming = false;
      turns = [...turns];
    },

    stop(id) {
      this.finish(id);
    },

    fail(id, code, message) {
      const turn = find(id);
      if (!turn || turn.role !== "assistant") return;
      turn.streaming = false;
      turn.error = { code, message };
      turns = [...turns];
    },

    remove(id) {
      turns = turns.filter((turn) => turn.id !== id);
    },

    clear() {
      turns = [];
    },

    history(excludeId) {
      return turns
        .filter(
          (turn) =>
            turn.id !== excludeId &&
            turn.content.trim().length > 0 &&
            !(turn.role === "assistant" && turn.error !== undefined),
        )
        .map((turn) => ({
          role: turn.role,
          content: turn.role === "user" && turn.prompt ? turn.prompt : turn.content,
        }));
    },

    lastUserBefore(id) {
      const index = turns.findIndex((turn) => turn.id === id);
      if (index < 0) return null;
      for (let i = index - 1; i >= 0; i--) {
        const turn = turns[i]!;
        if (turn.role === "user") return turn;
      }
      return null;
    },
  };
}
