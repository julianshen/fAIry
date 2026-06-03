import { describe, expect, it, vi } from "vitest";
import { fakeCdp } from "../cdp/testCdp";
import { createEventBuffer } from "../cdp/eventBuffer";
import { cdpCollect, cdpPassthrough, cdpSubscribe, cdpUnsubscribe } from "./cdp";

describe("cdpPassthrough", () => {
  it("forwards method + params verbatim and returns the raw response", async () => {
    const cdp = fakeCdp({ "DOM.getDocument": { root: { nodeId: 1 } } });
    const result = await cdpPassthrough(cdp, { method: "DOM.getDocument", params: { depth: 1 } });
    expect(cdp.calls[0]).toEqual({ method: "DOM.getDocument", params: { depth: 1 } });
    expect(result).toEqual({ root: { nodeId: 1 } });
  });

  it("defaults params to {} and rejects a missing method", async () => {
    const cdp = fakeCdp({ "Page.reload": "ok" });
    await cdpPassthrough(cdp, { method: "Page.reload" });
    expect(cdp.calls[0]?.params).toEqual({});
    await expect(cdpPassthrough(cdp, {})).rejects.toThrow(/method.*string/);
  });

  it("refuses target/browser-level methods that would escape the tab binding", async () => {
    const cdp = fakeCdp();
    for (const method of [
      "Target.getTargets",
      "Target.attachToTarget",
      "Target.createTarget",
      "Browser.close",
    ]) {
      await expect(cdpPassthrough(cdp, { method })).rejects.toThrow(/not allowed/i);
    }
    expect(cdp.calls).toEqual([]); // nothing reached the debugger
  });

  it("applies the http(s) gate to a raw Page.navigate (no scheme bypass)", async () => {
    const cdp = fakeCdp({ "Page.navigate": { frameId: "1" } });
    await expect(cdpPassthrough(cdp, { method: "Page.navigate", params: { url: "file:///x" } })).rejects.toThrow(
      /http/,
    );
    expect(cdp.calls).toEqual([]); // never reached the debugger
    await cdpPassthrough(cdp, { method: "Page.navigate", params: { url: "https://ok.com" } });
    expect(cdp.calls[0]?.method).toBe("Page.navigate");
  });
});

describe("cdpSubscribe", () => {
  it("subscribes and auto-enables the method's domain", async () => {
    const send = vi.fn(() => Promise.resolve(undefined));
    const buffer = createEventBuffer();
    const result = await cdpSubscribe({ send }, buffer, { method: "Network.responseReceived" });
    expect(result).toEqual({ ok: true });
    expect(send).toHaveBeenCalledWith("Network.enable", {});
    expect(buffer.isSubscribed("Network.responseReceived")).toBe(true);
  });

  it("tolerates a domain that has no .enable command (benign 'not found')", async () => {
    const send = vi.fn(() => Promise.reject(new Error("'Foo.enable' wasn't found")));
    const buffer = createEventBuffer();
    const result = await cdpSubscribe({ send }, buffer, { method: "Foo.bar" });
    expect(result).toEqual({ ok: true }); // stays subscribed; the domain just has no enable
    expect(buffer.isSubscribed("Foo.bar")).toBe(true);
  });

  it("reports failure and rolls back when the domain can't be enabled/attached", async () => {
    // e.g. no tab bound after a worker restart — capture won't actually work, so
    // returning ok:true would mislead the agent into a never-collecting wait.
    const send = vi.fn(() => Promise.reject(new Error("no tab bound to the agent (start a task first)")));
    const buffer = createEventBuffer();
    const result = await cdpSubscribe({ send }, buffer, { method: "Network.responseReceived" });
    expect(result).toEqual({ ok: false });
    expect(buffer.isSubscribed("Network.responseReceived")).toBe(false); // rolled back
  });

  it("returns ok:false for a malformed method and never enables", async () => {
    const send = vi.fn(() => Promise.resolve(undefined));
    const buffer = createEventBuffer();
    expect(await cdpSubscribe({ send }, buffer, { method: "nodot" })).toEqual({ ok: false });
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses to subscribe to target/browser domains (no escaping the tab binding)", async () => {
    const send = vi.fn(() => Promise.resolve(undefined));
    const buffer = createEventBuffer();
    await expect(cdpSubscribe({ send }, buffer, { method: "Target.attachedToTarget" })).rejects.toThrow(
      /not allowed/i,
    );
    expect(send).not.toHaveBeenCalled();
    expect(buffer.isSubscribed("Target.attachedToTarget")).toBe(false);
  });
});

describe("cdpCollect", () => {
  it("drains the buffer for a method", async () => {
    const buffer = createEventBuffer();
    buffer.subscribe("Network.responseReceived");
    buffer.push("Network.responseReceived", { status: 200 }, 1);
    const result = (await cdpCollect(buffer, { method: "Network.responseReceived" })) as unknown[];
    expect(result).toHaveLength(1);
  });

  it("passes max through", async () => {
    const buffer = createEventBuffer();
    buffer.subscribe("Network.responseReceived");
    for (let n = 1; n <= 4; n++) buffer.push("Network.responseReceived", { n }, n);
    const result = (await cdpCollect(buffer, { max: 2 })) as unknown[];
    expect(result).toHaveLength(2);
  });
});

describe("cdpUnsubscribe", () => {
  it("unsubscribes a method", async () => {
    const buffer = createEventBuffer();
    buffer.subscribe("Network.responseReceived");
    expect(await cdpUnsubscribe(buffer, { method: "Network.responseReceived" })).toEqual({
      ok: true,
      cleared: 1,
    });
  });

  it("unsubscribes everything with no method", async () => {
    const buffer = createEventBuffer();
    buffer.subscribe("Network.responseReceived");
    buffer.subscribe("Page.loadEventFired");
    expect(await cdpUnsubscribe(buffer, {})).toEqual({ ok: true, cleared: 2 });
  });
});
