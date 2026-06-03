import { describe, expect, it, vi } from "vitest";
import { fakeCdp } from "../cdp/testCdp";
import { createBrowserHandlers } from "./registry";

/** The exact wire names the daemon relays (the `bridge("...")` args in the -e script). */
const EXPECTED_TOOLS = [
  "navigate",
  "getUrl",
  "getTitle",
  "click",
  "type",
  "scroll",
  "evaluate",
  "screenshot",
  "screenshotMarked",
  "getDom",
  "axtree",
  "describeAt",
  "dismissOverlays",
  "waitFor",
];

describe("createBrowserHandlers", () => {
  it("registers exactly the implemented wire tool names", () => {
    const handlers = createBrowserHandlers(fakeCdp());
    expect(Object.keys(handlers).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it("routes a call to the matching handler, passing the cdp client", async () => {
    const send = vi.fn((method: string) =>
      Promise.resolve(method === "Page.navigate" ? undefined : { result: { value: "x" } }),
    );
    const handlers = createBrowserHandlers({ send });
    const result = await handlers.navigate!({ url: "https://example.com" });
    expect(send).toHaveBeenCalledWith("Page.navigate", { url: "https://example.com" });
    expect(result).toEqual({ ok: true });
  });

  it("every handler is a function taking args", () => {
    const handlers = createBrowserHandlers(fakeCdp());
    for (const name of EXPECTED_TOOLS) {
      expect(typeof handlers[name]).toBe("function");
    }
  });
});
