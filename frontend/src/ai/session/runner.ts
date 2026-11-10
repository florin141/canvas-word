// One streaming run. Provider selection is centralized here so the UI never
// touches fetch/SSE and the embedder transport follows the same contract.

import { createProvider } from "../providers/registry";
import { providerConfigFor, type SavedAiSettings } from "../settings/aiSettings";
import type { AiErrorCode, AiRequest, AiStreamEvent, AiTransport } from "../types";

export interface RunDeps {
  settings: SavedAiSettings;
  transport?: AiTransport;
}

export interface RunHandlers {
  onDelta(delta: string): void;
  onDone(): void;
  onError(code: AiErrorCode, message: string): void;
}

/** Stream a request, converting every failure into an `onError` callback. The
 *  function resolves when the run ends (done, error, abort, or stream close). */
export async function runRequest(
  deps: RunDeps,
  req: AiRequest,
  signal: AbortSignal,
  handlers: RunHandlers,
): Promise<void> {
  let events: AsyncIterable<AiStreamEvent>;
  try {
    events = deps.transport
      ? deps.transport(req, signal)
      : createProvider(providerConfigFor(deps.settings)).stream(req, signal);
  } catch (err) {
    if (signal.aborted) return;
    handlers.onError("unknown", err instanceof Error ? err.message : "The provider could not be started.");
    return;
  }

  try {
    for await (const event of events) {
      if (signal.aborted) return;
      if (event.type === "text") {
        handlers.onDelta(event.delta);
      } else if (event.type === "error") {
        handlers.onError(event.code, event.message);
        return;
      } else {
        handlers.onDone();
        return;
      }
    }
    if (!signal.aborted) handlers.onDone();
  } catch (err) {
    if (signal.aborted) return;
    handlers.onError("network", err instanceof Error ? err.message : "The connection failed.");
  }
}
