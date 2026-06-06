import { describe, expect, it } from "vitest";
import { createPolicyCache } from "./policyCache";

describe("policyCache", () => {
  it("returns undefined for an unknown origin", () => {
    expect(createPolicyCache().get("https://x.com")).toBeUndefined();
  });

  it("returns the stored value after set", () => {
    const cache = createPolicyCache();
    const policy = { level: 2, origin: "https://x.com" };
    cache.set("https://x.com", policy);
    expect(cache.get("https://x.com")).toBe(policy);
  });

  it("keys are independent per origin", () => {
    const cache = createPolicyCache();
    cache.set("https://a.com", { level: 1 });
    expect(cache.get("https://b.com")).toBeUndefined();
  });
});
