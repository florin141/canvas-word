// Provider catalog. Adding an OpenAI-compatible backend is one table row; the
// model field is always free text in the settings UI, so these defaults are
// only seeds/suggestions and can age without breaking anyone.

import type { ProviderConfig } from "../types";
import { createAnthropicProvider } from "./anthropic";
import { createGeminiProvider } from "./gemini";
import { normalizeBaseUrl } from "./http";
import { createOpenAICompatibleProvider } from "./openaiCompatible";
import type { AIProvider } from "./types";

export type AdapterId = "openaiCompatible" | "anthropic" | "gemini";

export interface ProviderEntry {
  id: string;
  label: string;
  adapter: AdapterId;
  /** Empty for providers that require the user to enter one (custom, OpenRouter
   *  model choice is still free text but its base URL is fixed). */
  defaultBaseUrl: string;
  defaultModel: string;
  modelSuggestions: readonly string[];
  /** A base URL must be supplied by the user before the provider can run. */
  requiresBaseUrl?: boolean;
  /** Local servers usually accept (and need) no key. */
  keyOptional?: boolean;
}

export const PROVIDERS: readonly ProviderEntry[] = [
  {
    id: "anthropic",
    label: "Claude (Anthropic)",
    adapter: "anthropic",
    defaultBaseUrl: "https://api.anthropic.com",
    defaultModel: "claude-sonnet-5-5",
    modelSuggestions: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"],
  },
  {
    id: "openai",
    label: "OpenAI",
    adapter: "openaiCompatible",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4.1",
    modelSuggestions: ["gpt-4.1", "gpt-4.1-mini", "gpt-4o"],
  },
  {
    id: "gemini",
    label: "Gemini (Google)",
    adapter: "gemini",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-2.5-flash",
    modelSuggestions: ["gemini-2.5-flash", "gemini-2.5-pro"],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    adapter: "openaiCompatible",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "",
    modelSuggestions: [],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    adapter: "openaiCompatible",
    defaultBaseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-chat",
    modelSuggestions: ["deepseek-chat", "deepseek-reasoner"],
  },
  {
    id: "custom",
    label: "Custom (OpenAI-compatible)",
    adapter: "openaiCompatible",
    defaultBaseUrl: "",
    defaultModel: "",
    modelSuggestions: [],
    requiresBaseUrl: true,
    keyOptional: true,
  },
];

export function providerEntry(id: string): ProviderEntry | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/** The effective base URL for a config: the user's override when set, else the
 *  catalog default. Empty means "not configured yet". */
export function resolveBaseUrl(cfg: Pick<ProviderConfig, "providerId" | "baseUrl">): string {
  const override = cfg.baseUrl?.trim();
  if (override) return normalizeBaseUrl(override);
  return normalizeBaseUrl(providerEntry(cfg.providerId)?.defaultBaseUrl ?? "");
}

/** Build the adapter for a configuration. Unknown ids fall back to the
 *  OpenAI-compatible protocol, which is the de-facto standard. */
export function createProvider(cfg: ProviderConfig): AIProvider {
  const entry = providerEntry(cfg.providerId);
  const baseUrl = resolveBaseUrl(cfg);
  const full: ProviderConfig = { ...cfg, baseUrl };
  switch (entry?.adapter) {
    case "anthropic":
      return createAnthropicProvider(full);
    case "gemini":
      return createGeminiProvider(full);
    case "openaiCompatible":
    default:
      return createOpenAICompatibleProvider(full);
  }
}
