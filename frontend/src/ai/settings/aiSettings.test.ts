import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AI_PANEL_KEY,
  AI_SETTINGS_KEY,
  DEFAULT_PANEL_PREFS,
  EMPTY_AI_SETTINGS,
  isConfigured,
  loadAiSettings,
  loadPanelPrefs,
  mergeWithPreset,
  providerConfigFor,
  saveAiSettings,
  savePanelPrefs,
} from "./aiSettings";

function stubStorage(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  return store;
}

beforeEach(() => {
  stubStorage();
});
afterEach(() => vi.unstubAllGlobals());

describe("AI settings storage", () => {
  it("round-trips settings and keeps per-provider keys", () => {
    saveAiSettings({
      providerId: "openai",
      model: "gpt-4.1",
      baseUrl: "",
      apiKeys: { openai: "sk-a", deepseek: "sk-b" },
    });
    expect(loadAiSettings()).toEqual({
      providerId: "openai",
      model: "gpt-4.1",
      baseUrl: "",
      apiKeys: { openai: "sk-a", deepseek: "sk-b" },
    });
  });

  it("returns empty settings for absent, malformed, or non-object JSON", () => {
    expect(loadAiSettings()).toEqual(EMPTY_AI_SETTINGS);
    const store = stubStorage();
    store.set(AI_SETTINGS_KEY, "{not json");
    expect(loadAiSettings()).toEqual(EMPTY_AI_SETTINGS);
    store.set(AI_SETTINGS_KEY, JSON.stringify(["array"]));
    expect(loadAiSettings()).toEqual(EMPTY_AI_SETTINGS);
  });

  it("never throws when storage is unavailable", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    });
    expect(loadAiSettings()).toEqual(EMPTY_AI_SETTINGS);
    expect(() => saveAiSettings(EMPTY_AI_SETTINGS)).not.toThrow();
  });

  it("merges an embedder preset only where the user has no saved value", () => {
    const merged = mergeWithPreset(EMPTY_AI_SETTINGS, {
      providerId: "custom",
      model: "local-model",
      baseUrl: "http://localhost:11434/v1",
      apiKey: "local-key",
    });
    expect(merged).toEqual({
      providerId: "custom",
      model: "local-model",
      baseUrl: "http://localhost:11434/v1",
      apiKeys: { custom: "local-key" },
    });
    expect(mergeWithPreset(merged, { model: "ignored", providerId: "openai" })).toEqual(merged);
  });

  it("builds a config with only the fields that are set", () => {
    expect(providerConfigFor({ providerId: "openai", model: "m", baseUrl: "", apiKeys: {} })).toEqual({
      providerId: "openai",
      model: "m",
    });
    expect(providerConfigFor({ providerId: "openai", model: "m", baseUrl: " https://x.test ", apiKeys: { openai: "k" } })).toEqual({
      providerId: "openai",
      model: "m",
      baseUrl: "https://x.test",
      apiKey: "k",
    });
  });

  it("knows when a provider is configured", () => {
    expect(isConfigured(EMPTY_AI_SETTINGS)).toBe(false);
    expect(isConfigured(EMPTY_AI_SETTINGS, true)).toBe(true);
    expect(isConfigured({ providerId: "openai", model: "", baseUrl: "", apiKeys: { openai: "k" } })).toBe(false);
    expect(isConfigured({ providerId: "openai", model: "m", baseUrl: "", apiKeys: {} })).toBe(false);
    expect(isConfigured({ providerId: "openai", model: "m", baseUrl: "", apiKeys: { openai: "k" } })).toBe(true);
    // custom requires a base URL, but no key (local server)
    expect(isConfigured({ providerId: "custom", model: "m", baseUrl: "", apiKeys: {} })).toBe(false);
    expect(isConfigured({ providerId: "custom", model: "m", baseUrl: "http://localhost:1234/v1", apiKeys: {} })).toBe(true);
  });
});

describe("AI panel preferences", () => {
  it("defaults closed at 340px and round-trips", () => {
    expect(loadPanelPrefs()).toEqual(DEFAULT_PANEL_PREFS);
    savePanelPrefs({ open: true, width: 420 });
    expect(loadPanelPrefs()).toEqual({ open: true, width: 420 });
    expect(localStorage.getItem(AI_PANEL_KEY)).toContain("420");
  });

  it("falls back on malformed values", () => {
    localStorage.setItem(AI_PANEL_KEY, "nope");
    expect(loadPanelPrefs()).toEqual(DEFAULT_PANEL_PREFS);
    localStorage.setItem(AI_PANEL_KEY, JSON.stringify({ open: "yes", width: "wide" }));
    expect(loadPanelPrefs()).toEqual(DEFAULT_PANEL_PREFS);
  });
});
