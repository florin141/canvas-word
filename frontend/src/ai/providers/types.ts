// Provider adapter contract. Adapters are small, dependency-free wrappers over
// fetch + SSE: they never know about the UI, settings storage, or the editor.

import type { AiRequest, AiStreamEvent } from "../types";

export interface AIProvider {
  /** Stream a chat completion. Errors are yielded as `{ type: "error" }` events
   *  (never thrown) so the UI can render a retryable bubble. Aborting the signal
   *  ends the iterator silently. */
  stream(req: AiRequest, signal: AbortSignal): AsyncIterable<AiStreamEvent>;
  /** Minimal connectivity/credentials check. Never throws. */
  test(signal?: AbortSignal): Promise<{ ok: true } | { ok: false; error: string }>;
}
