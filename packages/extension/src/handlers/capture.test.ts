import { describe, expect, it } from "vitest";
import type { CdpClient } from "../cdp/cdpClient";
import { fakeCdp as recordingCdp } from "../cdp/testCdp";
import { screenshot, screenshotMarked } from "./capture";

const METRICS = { visualViewport: { clientWidth: 800.4, clientHeight: 600.6 } };

/** The shared recorder seeded with the capture defaults; overrides win. */
function fakeCdp(overrides: Record<string, unknown> = {}) {
  return recordingCdp({
    "Page.getLayoutMetrics": METRICS,
    "Page.captureScreenshot": { data: "BASE64DATA" },
    "Runtime.evaluate": { result: { value: [] } },
    ...overrides,
  });
}

describe("screenshot", () => {
  it("captures jpeg by default with quality 70 and rounded viewport size", async () => {
    const cdp = fakeCdp();
    const result = await screenshot(cdp, {});
    expect(cdp.calls.map((c) => c.method)).toEqual([
      "Page.getLayoutMetrics",
      "Page.captureScreenshot",
    ]);
    expect(cdp.calls[1]?.params).toEqual({ format: "jpeg", quality: 70 });
    expect(result).toEqual({ base64: "BASE64DATA", width: 800, height: 601, format: "jpeg" });
  });

  it("captures png without a quality param when format is png", async () => {
    const cdp = fakeCdp();
    const result = await screenshot(cdp, { format: "png" });
    expect(cdp.calls[1]?.params).toEqual({ format: "png" });
    expect(result.format).toBe("png");
  });
});

describe("screenshotMarked", () => {
  it("injects marks, captures, removes the overlay, and returns the marks", async () => {
    const marks = [{ id: 1, x: 5, y: 6, w: 10, h: 10, tag: "a", role: null, label: "Home", href: "/" }];
    const cdp = fakeCdp({ "Runtime.evaluate": { result: { value: marks } } });
    const result = await screenshotMarked(cdp, {});
    const methods = cdp.calls.map((c) => c.method);
    // inject (Runtime.evaluate) → metrics → capture → remove (Runtime.evaluate)
    expect(methods).toEqual([
      "Runtime.evaluate",
      "Page.getLayoutMetrics",
      "Page.captureScreenshot",
      "Runtime.evaluate",
    ]);
    expect(result.marks).toEqual(marks);
    expect(result.base64).toBe("BASE64DATA");
    expect(result.width).toBe(800);
  });

  it("still returns a screenshot when the overlay removal fails", async () => {
    let evalCount = 0;
    const cdp: CdpClient = {
      send(method) {
        if (method === "Runtime.evaluate") {
          evalCount += 1;
          if (evalCount === 2) return Promise.reject(new Error("page navigated"));
          return Promise.resolve({ result: { value: [] } });
        }
        if (method === "Page.getLayoutMetrics") return Promise.resolve(METRICS);
        return Promise.resolve({ data: "IMG" });
      },
    };
    const result = await screenshotMarked(cdp, {});
    expect(result.base64).toBe("IMG");
  });
});
