// Public AI types. This module is TYPE-ONLY: importing it costs nothing at
// runtime, so the main editor graph (runtime.ts / wordcanvas.ts) can refer to
// these without pulling the lazy AI chunk into the initial bundle.

/** A provider selection: which backend, which key, which model. `baseUrl` is
 *  required only for the "custom" (OpenAI-compatible) provider and may override
 *  the default endpoint for built-ins. */
export interface ProviderConfig {
  providerId: string;
  apiKey?: string;
  baseUrl?: string;
  model: string;
}

/** One turn in a provider chat request. */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Why a provider call failed. `cors` and `network` are deliberately distinct
 *  messages even though browsers blur them — the fix differs. */
export type AiErrorCode = "auth" | "rate_limit" | "network" | "cors" | "model" | "unknown";

/** Streaming events yielded by every provider adapter (and by a host transport). */
export type AiStreamEvent =
  | { type: "text"; delta: string }
  | { type: "done"; usage?: { input?: number; output?: number } }
  | { type: "error"; code: AiErrorCode; message: string };

/** Everything a provider call needs, independent of the adapter. */
export interface AiRequest {
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
}

/** Embedder-owned transport. When supplied, it replaces direct browser→provider
 *  calls, so keys never reach the page — the host's backend holds them and can
 *  apply auth, quotas and logging. */
export type AiTransport = (req: AiRequest, signal: AbortSignal) => AsyncIterable<AiStreamEvent>;

/** Opt-in AI assistant configuration. `enabled` defaults to false; with it off,
 *  nothing is imported, no listeners are installed and no network call is made. */
export interface AiOptions {
  enabled: boolean;
  panel?: {
    /** Open the side panel once the editor is ready. Default false. */
    defaultOpen?: boolean;
  };
  /** Pre-configure a provider (e.g. an embedder-owned custom endpoint). User
   *  settings saved in this browser take precedence once edited. */
  provider?: Partial<ProviderConfig>;
  /** Embedder-owned transport — see AiTransport. */
  transport?: AiTransport;
  /** Show the provider settings surface. Default true; when `transport` is set
   *  the default flips to false (the host owns configuration). */
  showSettings?: boolean;
}
