// Google Gemini adapter: streamGenerateContent?alt=sse. The key travels as a
// query parameter (Google's browser API convention); redaction still applies to
// any echoed error text.

import type { AiRequest, ProviderConfig } from "../types";
import { endpoint, errorCodeForStatus, NETWORK_ERROR_MESSAGE, readErrorBody, redactSecret } from "./http";
import { sseData } from "./sse";
import type { AIProvider } from "./types";

const DEFAULT_MAX_TOKENS = 4096;

export function createGeminiProvider(cfg: ProviderConfig): AIProvider {
  const model = encodeURIComponent(cfg.model);
  const keyQuery = cfg.apiKey ? `key=${encodeURIComponent(cfg.apiKey)}` : "";
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  const body = (req: AiRequest): string =>
    JSON.stringify({
      systemInstruction: { parts: [{ text: req.system }] },
      contents: req.messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      generationConfig: { maxOutputTokens: req.maxTokens ?? DEFAULT_MAX_TOKENS },
    });

  const url = (method: string): string => {
    const base = endpoint(cfg.baseUrl ?? "", `/models/${model}:${method}`);
    return keyQuery ? `${base}?${keyQuery}` : base;
  };

  return {
    async *stream(req, signal) {
      let res: Response;
      try {
        res = await fetch(url("streamGenerateContent") + (keyQuery ? "&alt=sse" : "?alt=sse"), {
          method: "POST",
          headers,
          body: body(req),
          signal,
        });
      } catch {
        if (signal.aborted) return;
        yield { type: "error", code: "network", message: NETWORK_ERROR_MESSAGE };
        return;
      }
      if (!res.ok) {
        yield { type: "error", code: errorCodeForStatus(res.status), message: await readErrorBody(res, cfg.apiKey) };
        return;
      }
      if (!res.body) {
        yield { type: "error", code: "unknown", message: "The provider returned an empty response." };
        return;
      }
      try {
        for await (const data of sseData(res.body)) {
          let json: unknown;
          try {
            json = JSON.parse(data);
          } catch {
            continue;
          }
          const blocked = (json as { promptFeedback?: { blockReason?: unknown } }).promptFeedback?.blockReason;
          if (typeof blocked === "string") {
            yield { type: "error", code: "unknown", message: `The provider blocked the prompt (${blocked}).` };
            return;
          }
          const parts = (json as { candidates?: { content?: { parts?: { text?: unknown }[] } }[] }).candidates?.[0]?.content?.parts;
          if (Array.isArray(parts)) {
            for (const part of parts) {
              if (typeof part?.text === "string" && part.text.length > 0) yield { type: "text", delta: part.text };
            }
          }
        }
        yield { type: "done" };
      } catch {
        if (signal.aborted) return;
        yield { type: "error", code: "network", message: redactSecret(NETWORK_ERROR_MESSAGE, cfg.apiKey) };
      }
    },

    async test(signal) {
      try {
        const res = await fetch(url("generateContent"), {
          method: "POST",
          headers,
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: "ping" }] }],
            generationConfig: { maxOutputTokens: 1 },
          }),
          ...(signal ? { signal } : {}),
        });
        if (!res.ok) return { ok: false, error: await readErrorBody(res, cfg.apiKey) };
        return { ok: true };
      } catch {
        if (signal?.aborted) return { ok: false, error: "Cancelled." };
        return { ok: false, error: NETWORK_ERROR_MESSAGE };
      }
    },
  };
}
