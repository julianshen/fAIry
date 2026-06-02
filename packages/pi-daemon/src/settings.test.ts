import { redactConfig } from "./settings";
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
