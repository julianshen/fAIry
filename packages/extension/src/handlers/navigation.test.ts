import { describe, expect, it } from "vitest";
import { fakeCdp } from "../cdp/testCdp";
import { getTitle, getUrl, navigate } from "./navigation";

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

  it("accepts http as well as https", async () => {
    const cdp = fakeCdp();
    await navigate(cdp, { url: "http://localhost:3000/x" });
    expect(cdp.calls).toHaveLength(1);
  });

  it("rejects non-http(s) schemes without issuing a navigation", async () => {
    const cdp = fakeCdp();
    for (const url of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "data:text/html,<h1>x</h1>",
      "chrome://settings",
      "chrome-extension://abc/x.html",
      "not a url",
    ]) {
      await expect(navigate(cdp, { url })).rejects.toThrow(/http/);
    }
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
