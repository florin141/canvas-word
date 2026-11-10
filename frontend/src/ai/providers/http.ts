// Shared HTTP helpers for provider adapters: URL normalization, status→error
// mapping, response-body reading, and key redaction. Keys must never appear in
// an error string or a log line.

import type { AiErrorCode } from "../types";

/** Trim whitespace and trailing slashes so `${base}${path}` is predictable. */
export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/** Join a normalized base URL and an absolute API path. */
export function endpoint(baseUrl: string, path: string): string {
  return `${normalizeBaseUrl(baseUrl)}${path}`;
}

export function errorCodeForStatus(status: number): AiErrorCode {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status === 404) return "model";
  if (status >= 500) return "network";
  return "unknown";
}

/** Replace every occurrence of the key (and obvious bearer forms) in text. */
export function redactSecret(text: string, secret?: string): string {
  let out = text;
  if (secret) out = out.split(secret).join("[redacted]");
  return out.replace(/Bearer\s+[A-Za-z0-9._\-]+/g, "Bearer [redacted]");
}

/** Read a provider's error body into a short, redacted, user-readable message. */
export async function readErrorBody(res: Response, secret?: string): Promise<string> {
  let text = "";
  try {
    text = await res.text();
  } catch {
    /* body unavailable */
  }
  const detail = text.trim().slice(0, 400);
  const suffix = detail ? ` — ${detail}` : "";
  return redactSecret(`The provider returned HTTP ${res.status}.${suffix}`, secret);
}

/** Shown when fetch itself fails. Browsers cannot distinguish CORS from an
 *  offline endpoint, so the message covers both and points hosted apps at the
 *  embedder transport. */
export const NETWORK_ERROR_MESSAGE =
  "Could not reach the provider. Check your connection — or the endpoint may not allow browser (CORS) requests. Hosted apps should route calls through an AI transport.";
