import { describe, expect, it } from "vitest";
import { fakeCdp } from "../../cdp/testCdp";
import { createEventBuffer } from "../../cdp/eventBuffer";
import { NO_TAB_BOUND } from "../../tabs/agentTabs";
import type { CdpClient } from "../../cdp/cdpClient";
import { learnPageActions } from "./learnPageActions";
import type { Collected } from "./types";

const COLLECTED: Collected = {
  origin: "https://x.com",
  url: "https://x.com/home?q=1",
  elementsByRole: { button: 2, link: 5 },
  interactive: [{ tag: "button", role: null, label: "Go", href: null }],
  searchInputs: [{ label: "Search" }],
  forms: [],
  nav: [],
  hrefs: ["https://x.com/p/1", "https://x.com/p/2"],
  queryParams: ["q"],
  declaredActions: [],
};

function cdpWithCollected(value: unknown = COLLECTED) {
  return fakeCdp({ "Runtime.evaluate": { result: { value } } });
}
const noSleep = async (): Promise<void> => {};

describe("learnPageActions", () => {
  it("assembles a LearnResult from the collector (passive: no network)", async () => {
    const res = await learnPageActions(cdpWithCollected(), createEventBuffer(), noSleep, {});
    expect(res.origin).toBe("https://x.com");
    expect(res.perception.searchInputs).toEqual([{ label: "Search" }]);
    expect(res.urlAnalysis.patterns).toContainEqual({ pattern: "/p/:id", count: 2 });
    expect(res.network).toBeUndefined();
    expect(res.classification).toContainEqual(expect.objectContaining({ category: "search" }));
  });

  it("does not touch the network in passive mode", async () => {
    const cdp = cdpWithCollected();
    await learnPageActions(cdp, createEventBuffer(), noSleep, { mode: "passive" });
    expect(cdp.calls.map((c) => c.method)).toEqual(["Runtime.evaluate"]);
  });

  it("observes network in active mode, then unsubscribes", async () => {
    const buffer = createEventBuffer();
    const cdp = cdpWithCollected();
    const sleep = async (): Promise<void> => {
      buffer.push("Network.requestWillBeSent", { request: { url: "https://x.com/api/items", method: "GET" } }, 1);
    };
    const res = await learnPageActions(cdp, buffer, sleep, { mode: "active" });
    expect(res.network?.endpoints).toEqual([{ method: "GET", path: "/api/items" }]);
    expect(buffer.isSubscribed("Network.requestWillBeSent")).toBe(false);
  });

  it("skips the network block (still unsubscribes) when subscribe fails", async () => {
    const buffer = createEventBuffer();
    const cdp: CdpClient & { calls: { method: string }[] } = {
      calls: [],
      send(method) {
        this.calls.push({ method });
        if (method === "Runtime.evaluate") return Promise.resolve({ result: { value: COLLECTED } });
        if (method === "Network.enable") return Promise.reject(new Error(NO_TAB_BOUND));
        return Promise.resolve(undefined);
      },
    };
    const res = await learnPageActions(cdp, buffer, async () => {}, { mode: "active" });
    expect(res.network).toBeUndefined();
    expect(buffer.isSubscribed("Network.requestWillBeSent")).toBe(false);
  });

  it("throws a clear error when page collection returns a non-Collected value", async () => {
    await expect(learnPageActions(cdpWithCollected(null), createEventBuffer(), noSleep, {})).rejects.toThrow(
      /page collection failed/,
    );
  });

  it("propagates an unbound-tab error from the collector evaluate", async () => {
    const cdp: CdpClient = { send: () => Promise.reject(new Error(NO_TAB_BOUND)) };
    await expect(learnPageActions(cdp, createEventBuffer(), noSleep, {})).rejects.toThrow(NO_TAB_BOUND);
  });
});
