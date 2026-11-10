// AI provider settings + panel preferences, persisted in localStorage.
//
// Storage is best-effort: private mode / blocked storage must never break the
// editor. Keys are kept PER PROVIDER so switching back and forth doesn't lose
// them. Nothing in this module ever logs a key, and error strings are redacted
// by the provider adapters before they reach here.

import { createProvider, providerEntry, resolveBaseUrl } from "../providers/registry";
import type { AiOptions, AiTransport, ProviderConfig } from "../types";

export const AI_SETTINGS_KEY = "wordcanvas.ai.settings.v1";
export const AI_PANEL_KEY = "wordcanvas.ai.panel.v1";

export interface SavedAiSettings {
  providerId: string;
  model: string;
  /** Explicit base-URL override, or "" to use the catalog default. */
  baseUrl: string;
  /** Per-provider API keys. */
  apiKeys: Record<string, string>;
}

export interface AiPanelPrefs {
  open: boolean;
  /** Panel width in CSS px; clamped by the feature UI. */
  width: number;
}

export const EMPTY_AI_SETTINGS: SavedAiSettings = { providerId: "", model: "", baseUrl: "", apiKeys: {} };
export const DEFAULT_PANEL_PREFS: AiPanelPrefs = { open: false, width: 340 };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const emptySettings = (): SavedAiSettings => ({ ...EMPTY_AI_SETTINGS, apiKeys: {} });

export function loadAiSettings(): SavedAiSettings {
  try {
    const raw = localStorage.getItem(AI_SETTINGS_KEY);
    if (!raw) return emptySettings();
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return emptySettings();
    const apiKeys: Record<string, string> = {};
    if (isRecord(parsed["apiKeys"])) {
      for (const [id, key] of Object.entries(parsed["apiKeys"])) {
        if (typeof key === "string" && key.length > 0) apiKeys[id] = key;
      }
    }
    return {
      providerId: typeof parsed["providerId"] === "string" ? parsed["providerId"] : "",
      model: typeof parsed["model"] === "string" ? parsed["model"] : "",
      baseUrl: typeof parsed["baseUrl"] === "string" ? parsed["baseUrl"] : "",
      apiKeys,
    };
  } catch {
    return emptySettings();
  }
}

export function saveAiSettings(settings: SavedAiSettings): void {
  try {
    localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable — settings just won't persist */
  }
}

/** Fill in an embedder preset where the user has not saved a value yet. Saved
 *  user settings always win, so editing in the UI is stable across reloads. */
export function mergeWithPreset(saved: SavedAiSettings, preset?: Partial<ProviderConfig>): SavedAiSettings {
  if (!preset) return saved;
  const providerId = saved.providerId || preset.providerId || "";
  const entry = providerEntry(providerId);
  const model = saved.model || preset.model || entry?.defaultModel || "";
  const baseUrl = saved.baseUrl || preset.baseUrl || "";
  const apiKeys = { ...saved.apiKeys };
  if (preset.apiKey && !apiKeys[providerId]) apiKeys[providerId] = preset.apiKey;
  return { providerId, model, baseUrl, apiKeys };
}

/** Build the adapter config for the saved provider (or a specific one). */
export function providerConfigFor(settings: SavedAiSettings, providerId = settings.providerId): ProviderConfig {
  const config: ProviderConfig = { providerId, model: settings.model };
  if (settings.baseUrl.trim()) config.baseUrl = settings.baseUrl.trim();
  const key = settings.apiKeys[providerId];
  if (key) config.apiKey = key;
  return config;
}

/** True when the saved settings are enough to make a request (or the embedder
 *  supplied a transport, which owns configuration). */
export function isConfigured(settings: SavedAiSettings, hasTransport = false): boolean {
  if (hasTransport) return true;
  if (!settings.providerId || !settings.model.trim()) return false;
  const entry = providerEntry(settings.providerId);
  if (!entry) return false;
  if (!resolveBaseUrl({ providerId: settings.providerId, baseUrl: settings.baseUrl })) return false;
  if (!entry.keyOptional && !settings.apiKeys[settings.providerId]) return false;
  return true;
}

/** Run a minimal request through the same path a real run uses. */
export async function testConnection(
  config: ProviderConfig,
  transport?: AiTransport,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (transport) {
    try {
      for await (const event of transport(
        { system: "Reply with OK.", messages: [{ role: "user", content: "ping" }], maxTokens: 4 },
        new AbortController().signal,
      )) {
        if (event.type === "error") return { ok: false, error: event.message };
        return { ok: true };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "The transport failed." };
    }
  }
  return createProvider(config).test();
}

/** Resolve `showSettings` for an options object (transport defaults it off). */
export function showSettingsFor(ai: AiOptions): boolean {
  return ai.showSettings ?? ai.transport === undefined;
}

// ---- panel preferences -------------------------------------------------------

export function loadPanelPrefs(): AiPanelPrefs {
  try {
    const raw = localStorage.getItem(AI_PANEL_KEY);
    if (!raw) return { ...DEFAULT_PANEL_PREFS };
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return { ...DEFAULT_PANEL_PREFS };
    const width = typeof parsed["width"] === "number" && Number.isFinite(parsed["width"]) ? parsed["width"] : DEFAULT_PANEL_PREFS.width;
    return { open: parsed["open"] === true, width };
  } catch {
    return { ...DEFAULT_PANEL_PREFS };
  }
}

export function savePanelPrefs(prefs: AiPanelPrefs): void {
  try {
    localStorage.setItem(AI_PANEL_KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable */
  }
}
