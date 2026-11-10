// OpenAI-compatible adapter: OpenAI, DeepSeek, Mistral, Grok, OpenRouter, local
// servers (Ollama / LM Studio / llama.cpp), and any custom endpoint that speaks
// POST {baseUrl}/chat/completions with SSE. Bearer auth, omitted when no key is
// set (local servers usually don't need one).

import type { AiRequest, ProviderConfig } from "../types";
import { endpoint, errorCodeForStatus, NETWORK_ERROR_MESSAGE, readErrorBody, redactSecret } from "./http";
import { sseData } from "./sse";
import type { AIProvider } from "./types";

const DEFAULT_MAX_TOKENS = 4096;

export function createOpenAICompatibleProvider(cfg: ProviderConfig): AIProvider {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.apiKey) headers["Authorization"] = `Bearer ${cfg.apiKey}`;

  const requestBody = (req: AiRequest, stream: boolean): string =>
    JSON.stringify({
      model: cfg.model,
      messages: [{ role: "system", content: req.system }, ...req.messages],
      stream,
      max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
    });

  return {
    async *stream(req, signal) {
      let res: Response;
      try {
        res = await fetch(endpoint(cfg.baseUrl ?? "", "/chat/completions"), {
          method: "POST",
          headers,
          body: requestBody(req, true),
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
          if (data === "[DONE]") break;
          let json: unknown;
          try {
            json = JSON.parse(data);
          } catch {
            continue; // partial/keep-alive line
          }
          const err = (json as { error?: { message?: unknown } }).error?.message;
          if (typeof err === "string") {
            yield { type: "error", code: "unknown", message: redactSecret(err, cfg.apiKey) };
            return;
          }
          const delta = (json as { choices?: { delta?: { content?: unknown } }[] }).choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) yield { type: "text", delta };
        }
        yield { type: "done" };
      } catch {
        if (signal.aborted) return;
        yield { type: "error", code: "network", message: NETWORK_ERROR_MESSAGE };
      }
    },

    async test(signal) {
      try {
        const res = await fetch(endpoint(cfg.baseUrl ?? "", "/chat/completions"), {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: cfg.model,
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 1,
            stream: false,
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
