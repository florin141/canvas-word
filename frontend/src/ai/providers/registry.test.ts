import { describe, expect, it } from "vitest";
import { createProvider, PROVIDERS, providerEntry, resolveBaseUrl } from "./registry";

describe("provider registry", () => {
  it("exposes the v1 catalog", () => {
    expect(PROVIDERS.map((p) => p.id)).toEqual(["anthropic", "openai", "gemini", "openrouter", "deepseek", "custom"]);
    expect(providerEntry("custom")?.requiresBaseUrl).toBe(true);
    expect(providerEntry("unknown")).toBeUndefined();
  });

  it("resolves the catalog default, then a normalized override", () => {
    expect(resolveBaseUrl({ providerId: "openai" })).toBe("https://api.openai.com/v1");
    expect(resolveBaseUrl({ providerId: "openai", baseUrl: " https://proxy.test/v1/// " })).toBe("https://proxy.test/v1");
    expect(resolveBaseUrl({ providerId: "custom" })).toBe("");
  });

  it("builds a runnable adapter for every entry and for unknown ids", () => {
    for (const entry of PROVIDERS) {
      const provider = createProvider({ providerId: entry.id, model: "m", baseUrl: entry.defaultBaseUrl });
      expect(typeof provider.stream).toBe("function");
      expect(typeof provider.test).toBe("function");
    }
    const fallback = createProvider({ providerId: "unknown", model: "m", baseUrl: "https://x.test" });
    expect(typeof fallback.stream).toBe("function");
  });
});
