import { isPiConfig, redactConfig } from "./settings";
import type { PiConfig } from "./piConfig";

describe("redactConfig", () => {
  it("replaces each provider's apiKey with a hasKey flag and never leaks the key", () => {
    const config: PiConfig = {
      providers: [
        { id: "anthropic", apiKey: "sk-ant-secret" },
        { id: "openai", apiKey: "" },
      ],
    };
    const redacted = redactConfig(config);
    expect(redacted.providers).toEqual([
      { id: "anthropic", hasKey: true },
      { id: "openai", hasKey: false },
    ]);
    // No apiKey field, and the secret string appears nowhere in the output.
    expect(JSON.stringify(redacted)).not.toContain("sk-ant-secret");
    expect(JSON.stringify(redacted)).not.toContain("apiKey");
  });

  it("treats a whitespace-only key as not configured", () => {
    const redacted = redactConfig({ providers: [{ id: "x", apiKey: "   " }] });
    expect(redacted.providers).toEqual([{ id: "x", hasKey: false }]);
  });

  it("preserves the non-secret defaults and enabled models", () => {
    const config: PiConfig = {
      providers: [{ id: "anthropic", apiKey: "k" }],
      defaultProvider: "anthropic",
      defaultModel: "claude-opus-4-8",
      enabledModels: ["claude-opus-4-8", "gpt-5"],
    };
    const redacted = redactConfig(config);
    expect(redacted.defaultProvider).toBe("anthropic");
    expect(redacted.defaultModel).toBe("claude-opus-4-8");
    expect(redacted.enabledModels).toEqual(["claude-opus-4-8", "gpt-5"]);
  });

  it("omits optional fields when the config has none", () => {
    const redacted = redactConfig({ providers: [] });
    expect(redacted).toEqual({ providers: [] });
  });
});

describe("isPiConfig", () => {
  it("accepts a minimal config and one with valid optional fields", () => {
    expect(isPiConfig({ providers: [] })).toBe(true);
    expect(isPiConfig({ providers: [{ id: "a", apiKey: "k" }] })).toBe(true);
    expect(
      isPiConfig({ providers: [], defaultProvider: "a", defaultModel: "m", enabledModels: ["x"] }),
    ).toBe(true);
  });

  it("rejects non-objects", () => {
    expect(isPiConfig(null)).toBe(false);
    expect(isPiConfig(42)).toBe(false);
    expect(isPiConfig("x")).toBe(false);
  });

  it("rejects a missing or non-array providers", () => {
    expect(isPiConfig({})).toBe(false);
    expect(isPiConfig({ providers: "nope" })).toBe(false);
  });

  it("rejects provider entries that are not {id, apiKey} strings", () => {
    expect(isPiConfig({ providers: [null] })).toBe(false);
    expect(isPiConfig({ providers: [{ id: "a" }] })).toBe(false);
    expect(isPiConfig({ providers: [{ id: "a", apiKey: 1 }] })).toBe(false);
    expect(isPiConfig({ providers: [{ id: 1, apiKey: "k" }] })).toBe(false);
  });

  it("rejects optional fields of the wrong type", () => {
    expect(isPiConfig({ providers: [], defaultProvider: 5 })).toBe(false);
    expect(isPiConfig({ providers: [], defaultModel: 5 })).toBe(false);
    expect(isPiConfig({ providers: [], enabledModels: "gpt-5" })).toBe(false);
    expect(isPiConfig({ providers: [], enabledModels: ["ok", 2] })).toBe(false);
  });
});
