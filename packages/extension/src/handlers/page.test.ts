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

  it("rejects an unparseable urlMatch regex up front instead of compiling it each tick", async () => {
    const cdp = fakeCdp(["https://x.com"]);
    const result = await waitFor(cdp, { urlMatch: "(" }, fakeClock());
    expect(result).toEqual({ ok: false, reason: "badRegex" });
    // bailed before any page evaluation
    expect(cdp.calls).toEqual([]);
  });

  it("rejects an over-long urlMatch (ReDoS guard) without evaluating", async () => {
    const cdp = fakeCdp(["https://x.com"]);
    const result = await waitFor(cdp, { urlMatch: "a".repeat(257) }, fakeClock());
    expect(result).toEqual({ ok: false, reason: "badRegex" });
    expect(cdp.calls).toEqual([]);
  });

  it("caps an absurd timeoutMs so the loop is bounded", async () => {
    const cdp = fakeCdp([false]);
    const clock = fakeClock();
    const result = await waitFor(cdp, { predicate: "false", timeoutMs: 10 ** 12 }, clock);
    expect(result).toEqual({ ok: false, reason: "timeout" });
    // capped at 60s of 100ms polls → ~600, not ~10^10
    expect(clock.now()).toBeLessThanOrEqual(60_000);
  });

  it("resolves networkIdle once the resource count is stable for idleMs", async () => {
    const cdp = fakeCdp([5]); // count stays 5 every poll
    const result = await waitFor(cdp, { networkIdle: true, idleMs: 100 }, fakeClock());
    expect(result).toEqual({ ok: true, reason: "networkIdle" });
  });

  it("waits through a growing count, then resolves when it settles", async () => {
    const cdp = fakeCdp([1, 2, 2]);
    const result = await waitFor(cdp, { networkIdle: true, idleMs: 100 }, fakeClock());
    expect(result).toEqual({ ok: true, reason: "networkIdle" });
    expect(cdp.calls.filter((c) => c.method === "Runtime.evaluate")).toHaveLength(3);
  });

  it("treats a count DROP (navigation reset) as activity, not idle", async () => {
    const cdp = fakeCdp([5, 2, 2]); // a growth-only check would falsely resolve in 2 polls
    const result = await waitFor(cdp, { networkIdle: true, idleMs: 100 }, fakeClock());
    expect(result).toEqual({ ok: true, reason: "networkIdle" });
    expect(cdp.calls.filter((c) => c.method === "Runtime.evaluate")).toHaveLength(3);
  });

  it("times out if the network never settles", async () => {
    const cdp = fakeCdp([1, 2, 3, 4]); // changes every poll
    const result = await waitFor(cdp, { networkIdle: true, idleMs: 100, timeoutMs: 250 }, fakeClock());
    expect(result).toEqual({ ok: false, reason: "timeout" });
  });

  it("a non-number resource read is skipped (no false resolve)", async () => {
    const cdp = fakeCdp([undefined, 5, 5]); // first read NaN → skipped, then stable
    const result = await waitFor(cdp, { networkIdle: true, idleMs: 100 }, fakeClock());
    expect(result).toEqual({ ok: true, reason: "networkIdle" });
  });

  it("networkIdle composes with other conditions — first satisfied wins", async () => {
    const cdp = fakeCdp([true]); // the selector check evaluates truthy first
    const result = await waitFor(cdp, { selector: ".ready", networkIdle: true }, fakeClock());
    expect(result).toEqual({ ok: true, reason: "selector" });
  });
});
