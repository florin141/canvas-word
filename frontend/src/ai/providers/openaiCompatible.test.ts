import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiRequest, AiStreamEvent, ProviderConfig } from "../types";
import { createOpenAICompatibleProvider } from "./openaiCompatible";

const encoder = new TextEncoder();

const streamOf = (chunks: string[]): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });

const collect = async (events: AsyncIterable<AiStreamEvent>): Promise<AiStreamEvent[]> => {
  const out: AiStreamEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
};

const REQ: AiRequest = { system: "You are helpful.", messages: [{ role: "user", content: "Hi" }] };

const cfg: ProviderConfig = {
  providerId: "custom",
  baseUrl: "https://example.test/v1/",
  apiKey: "sk-secret-key",
  model: "test-model",
};

afterEach(() => vi.unstubAllGlobals());

describe("createOpenAICompatibleProvider.stream", () => {
  it("streams text deltas and a done event", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          streamOf([
            'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
            "data: [DONE]\n\n",
          ]),
          { status: 200 },
        ),
      ),
    );
    const events = await collect(createOpenAICompatibleProvider(cfg).stream(REQ, new AbortController().signal));
    expect(events).toEqual([
      { type: "text", delta: "Hel" },
      { type: "text", delta: "lo" },
      { type: "done" },
    ]);
  });

  it("posts to /chat/completions with the system message and stream:true", async () => {
    const fetchMock = vi.fn(async () => new Response(streamOf(["data: [DONE]\n\n"]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await collect(createOpenAICompatibleProvider(cfg).stream(REQ, new AbortController().signal));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://example.test/v1/chat/completions");
    const body = JSON.parse(String(init.body)) as {
      model: string;
      stream: boolean;
      messages: { role: string; content: string }[];
    };
    expect(body.model).toBe("test-model");
    expect(body.stream).toBe(true);
    expect(body.messages[0]).toEqual({ role: "system", content: "You are helpful." });
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer sk-secret-key");
  });

  it.each([
    [401, "auth"],
    [403, "auth"],
    [429, "rate_limit"],
    [404, "model"],
    [500, "network"],
  ] as const)("maps HTTP %i to %s, without leaking the key", async (status, code) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(`provider says no: ${cfg.apiKey}`, { status })),
    );
    const events = await collect(createOpenAICompatibleProvider(cfg).stream(REQ, new AbortController().signal));
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.type).toBe("error");
    if (event.type === "error") {
      expect(event.code).toBe(code);
      expect(event.message).not.toContain("sk-secret-key");
      expect(event.message).toContain("[redacted]");
    }
  });

  it("maps a fetch throw to a network/CORS hint", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    const events = await collect(createOpenAICompatibleProvider(cfg).stream(REQ, new AbortController().signal));
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("error");
    if (events[0]!.type === "error") {
      expect(events[0]!.code).toBe("network");
      expect(events[0]!.message).toMatch(/CORS/);
    }
  });

  it("ends silently when aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new DOMException("Aborted", "AbortError"))));
    const events = await collect(createOpenAICompatibleProvider(cfg).stream(REQ, controller.signal));
    expect(events).toEqual([]);
  });
});

describe("createOpenAICompatibleProvider.test", () => {
  it("reports ok on a 2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    await expect(createOpenAICompatibleProvider(cfg).test()).resolves.toEqual({ ok: true });
  });

  it("reports a redacted error on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`bad ${cfg.apiKey}`, { status: 401 })));
    const result = await createOpenAICompatibleProvider(cfg).test();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("401");
      expect(result.error).not.toContain("sk-secret-key");
    }
  });
});
