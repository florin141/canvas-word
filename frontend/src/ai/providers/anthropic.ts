// Anthropic (Claude) adapter: POST /v1/messages with stream:true. Browser calls
// need the `anthropic-dangerous-direct-browser-access` header; if the endpoint
// blocks them the UI surfaces a CORS/transport hint.

import type { AiRequest, ProviderConfig } from "../types";
import { endpoint, errorCodeForStatus, NETWORK_ERROR_MESSAGE, readErrorBody, redactSecret } from "./http";
import { sseData } from "./sse";
import type { AIProvider } from "./types";

const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 4096;

export function createAnthropicProvider(cfg: ProviderConfig): AIProvider {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": ANTHROPIC_VERSION,
    // Required for browser-origin requests; harmless from a transport.
    "anthropic-dangerous-direct-browser-access": "true",
  };
  if (cfg.apiKey) headers["x-api-key"] = cfg.apiKey;

  const body = (req: AiRequest, stream: boolean): string =>
    JSON.stringify({
      model: cfg.model,
      max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: req.system,
      messages: req.messages,
      stream,
    });

  return {
    async *stream(req, signal) {
      let res: Response;
      try {
        res = await fetch(endpoint(cfg.baseUrl ?? "", "/v1/messages"), {
          method: "POST",
          headers,
          body: body(req, true),
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
          const type = (json as { type?: unknown }).type;
          if (type === "content_block_delta") {
            const delta = (json as { delta?: { text?: unknown } }).delta?.text;
            if (typeof delta === "string" && delta.length > 0) yield { type: "text", delta };
          } else if (type === "error") {
            const message = (json as { error?: { message?: unknown } }).error?.message;
            yield {
              type: "error",
              code: "unknown",
              message: redactSecret(typeof message === "string" ? message : "The provider reported an error.", cfg.apiKey),
            };
            return;
          } else if (type === "message_stop") {
            break;
          }
        }
        yield { type: "done" };
      } catch {
        if (signal.aborted) return;
        yield { type: "error", code: "network", message: NETWORK_ERROR_MESSAGE };
      }
    },

    async test(signal) {
      try {
        const res = await fetch(endpoint(cfg.baseUrl ?? "", "/v1/messages"), {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: cfg.model,
            max_tokens: 1,
            messages: [{ role: "user", content: "ping" }],
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
