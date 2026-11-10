import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiRequest, AiStreamEvent, AiTransport } from "../types";
import { EMPTY_AI_SETTINGS, type SavedAiSettings } from "../settings/aiSettings";
import { runRequest, type RunHandlers } from "./runner";

const REQ: AiRequest = { system: "sys", messages: [{ role: "user", content: "hi" }] };
const SETTINGS: SavedAiSettings = {
  ...EMPTY_AI_SETTINGS,
  providerId: "custom",
  model: "m",
  baseUrl: "https://example.test/v1",
  apiKeys: { custom: "k" },
};

const handlers = (): RunHandlers & { events: string[] } => {
  const events: string[] = [];
  return {
    events,
    onDelta: (delta) => events.push(`text:${delta}`),
    onDone: () => events.push("done"),
    onError: (code, message) => events.push(`error:${code}:${message}`),
  };
};

const transportOf = (events: AiStreamEvent[]): AiTransport =>
  async function* () {
    for (const event of events) yield event;
  };

afterEach(() => vi.unstubAllGlobals());

describe("runRequest", () => {
  it("streams transport deltas and finishes once", async () => {
    const h = handlers();
    await runRequest({ settings: SETTINGS, transport: transportOf([{ type: "text", delta: "a" }, { type: "text", delta: "b" }, { type: "done" }]) }, REQ, new AbortController().signal, h);
    expect(h.events).toEqual(["text:a", "text:b", "done"]);
  });

  it("surfaces transport error events and stops", async () => {
    const h = handlers();
    await runRequest({ settings: SETTINGS, transport: transportOf([{ type: "error", code: "auth", message: "bad key" }, { type: "done" }]) }, REQ, new AbortController().signal, h);
    expect(h.events).toEqual(["error:auth:bad key"]);
  });

  it("treats a stream that closes without done as complete", async () => {
    const h = handlers();
    await runRequest({ settings: SETTINGS, transport: transportOf([{ type: "text", delta: "a" }]) }, REQ, new AbortController().signal, h);
    expect(h.events).toEqual(["text:a", "done"]);
  });

  it("stays silent when aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const h = handlers();
    await runRequest({ settings: SETTINGS, transport: transportOf([{ type: "text", delta: "a" }]) }, REQ, controller.signal, h);
    expect(h.events).toEqual([]);
  });

  it("maps a throwing transport to an unknown error", async () => {
    const h = handlers();
    const transport: AiTransport = () => {
      throw new Error("boom");
    };
    await runRequest({ settings: SETTINGS, transport }, REQ, new AbortController().signal, h);
    expect(h.events).toEqual(["error:unknown:boom"]);
  });

  it("uses the provider adapter when no transport is supplied", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("denied", { status: 401 })));
    const h = handlers();
    await runRequest({ settings: SETTINGS }, REQ, new AbortController().signal, h);
    expect(h.events).toHaveLength(1);
    expect(h.events[0]).toMatch(/^error:auth:/);
  });
});
