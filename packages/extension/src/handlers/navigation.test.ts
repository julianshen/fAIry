import { describe, expect, it } from "vitest";
import type { CdpClient } from "../cdp/cdpClient";
import { getTitle, getUrl, navigate } from "./navigation";

/** Records every send() and returns canned results keyed by method. */
function fakeCdp(responses: Record<string, unknown> = {}): CdpClient & {
  calls: Array<{ method: string; params?: Record<string, unknown> }>;
} {
  const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  return {
    calls,
    send(method, params) {
      calls.push({ method, params });
      return Promise.resolve(responses[method]);
    },
  };
}

describe("navigate", () => {
  it("issues Page.navigate with the url and reports ok", async () => {
    const cdp = fakeCdp();
    const result = await navigate(cdp, { url: "https://example.com" });
    expect(cdp.calls).toEqual([
      { method: "Page.navigate", params: { url: "https://example.com" } },
    ]);
    expect(result).toEqual({ ok: true });
  });

  it("rejects when url is missing or not a string", async () => {
    const cdp = fakeCdp();
    await expect(navigate(cdp, {})).rejects.toThrow(/url/);
    await expect(navigate(cdp, { url: 42 })).rejects.toThrow(/url/);
    expect(cdp.calls).toEqual([]);
  });
});

describe("getUrl", () => {
  it("evaluates location.href and returns the string", async () => {
    const cdp = fakeCdp({
      "Runtime.evaluate": { result: { value: "https://example.com/page" } },
    });
    const result = await getUrl(cdp, {});
    expect(cdp.calls[0]?.method).toBe("Runtime.evaluate");
    expect(cdp.calls[0]?.params).toMatchObject({ returnByValue: true });
    expect(result).toBe("https://example.com/page");
  });
});

describe("getTitle", () => {
  it("evaluates document.title and returns the string", async () => {
    const cdp = fakeCdp({
      "Runtime.evaluate": { result: { value: "Example Domain" } },
    });
    const result = await getTitle(cdp, {});
    expect(result).toBe("Example Domain");
  });
});
