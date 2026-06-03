import { describe, expect, it } from "vitest";
import type { CdpClient } from "../cdp/cdpClient";
import { dismissOverlays, waitFor } from "./page";
import type { Clock } from "./page";

function fakeCdp(evalValues: unknown[] = []): CdpClient & {
  calls: Array<{ method: string; params?: Record<string, unknown> }>;
} {
  const queue = [...evalValues];
  const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  return {
    calls,
    send(method, params) {
      calls.push({ method, params });
      if (method === "Runtime.evaluate") {
        const value = queue.length > 1 ? queue.shift() : queue[0];
        return Promise.resolve({ result: { value } });
      }
      return Promise.resolve(undefined);
    },
  };
}

/** A clock whose time only moves when sleep() is called. */
function fakeClock(): Clock {
  let t = 0;
  return {
    now: () => t,
    sleep: (ms: number) => {
      t += ms;
      return Promise.resolve();
    },
  };
}

describe("dismissOverlays", () => {
  it("returns the script's {removed, nodes} result", async () => {
    const cdp = fakeCdp([{ removed: 2, nodes: ["div#modal", "div.backdrop"] }]);
    const result = await dismissOverlays(cdp, {});
    expect(cdp.calls[0]?.method).toBe("Runtime.evaluate");
    expect(result).toEqual({ removed: 2, nodes: ["div#modal", "div.backdrop"] });
  });

  it("returns a no-op result when the page evaluation throws", async () => {
    const cdp: CdpClient = {
      send: () => Promise.resolve({ exceptionDetails: { text: "boom" } }),
    };
    expect(await dismissOverlays(cdp, {})).toEqual({ removed: 0, nodes: [] });
  });
});

describe("waitFor", () => {
  it("resolves ok:selector as soon as the selector is visible", async () => {
    const cdp = fakeCdp([true]);
    const result = await waitFor(cdp, { selector: "button.go" }, fakeClock());
    expect(result).toEqual({ ok: true, reason: "selector" });
  });

  it("polls until the predicate turns truthy", async () => {
    const cdp = fakeCdp([false, false, true]);
    const result = await waitFor(cdp, { predicate: "window.ready" }, fakeClock());
    expect(result).toEqual({ ok: true, reason: "predicate" });
    // three Runtime.evaluate polls
    expect(cdp.calls.filter((c) => c.method === "Runtime.evaluate")).toHaveLength(3);
  });

  it("resolves ok:selectorGone when the element disappears", async () => {
    const cdp = fakeCdp([true]);
    expect(await waitFor(cdp, { selectorGone: ".spinner" }, fakeClock())).toEqual({
      ok: true,
      reason: "selectorGone",
    });
  });

  it("resolves ok:urlMatch when the current url matches", async () => {
    const cdp = fakeCdp(["https://x.com/checkout/step2"]);
    expect(await waitFor(cdp, { urlMatch: "/checkout/" }, fakeClock())).toEqual({
      ok: true,
      reason: "urlMatch",
    });
  });

  it("times out with ok:false when no condition is met", async () => {
    const cdp = fakeCdp([false]);
    const result = await waitFor(cdp, { predicate: "false", timeoutMs: 250 }, fakeClock());
    expect(result).toEqual({ ok: false, reason: "timeout" });
  });
});
