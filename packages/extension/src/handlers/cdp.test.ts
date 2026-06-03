import { describe, expect, it, vi } from "vitest";
import { fakeCdp } from "../cdp/testCdp";
import { createEventBuffer } from "../cdp/eventBuffer";
import { cdpCollect, cdpPassthrough, cdpSubscribe, cdpUnsubscribe } from "./cdp";

describe("cdpPassthrough", () => {
  it("forwards method + params verbatim and returns the raw response", async () => {
    const cdp = fakeCdp({ "Browser.getVersion": { product: "Chrome/137" } });
    const result = await cdpPassthrough(cdp, { method: "Browser.getVersion", params: { x: 1 } });
    expect(cdp.calls[0]).toEqual({ method: "Browser.getVersion", params: { x: 1 } });
    expect(result).toEqual({ product: "Chrome/137" });
  });

  it("defaults params to {} and rejects a missing method", async () => {
    const cdp = fakeCdp({ "Page.reload": "ok" });
    await cdpPassthrough(cdp, { method: "Page.reload" });
    expect(cdp.calls[0]?.params).toEqual({});
    await expect(cdpPassthrough(cdp, {})).rejects.toThrow(/method.*string/);
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

  it("tolerates a domain that has no .enable", async () => {
    const send = vi.fn(() => Promise.reject(new Error("not enableable")));
    const buffer = createEventBuffer();
    const result = await cdpSubscribe({ send }, buffer, { method: "Foo.bar" });
    expect(result).toEqual({ ok: true }); // still subscribed despite enable failing
  });

  it("returns ok:false for a malformed method and never enables", async () => {
    const send = vi.fn(() => Promise.resolve(undefined));
    const buffer = createEventBuffer();
    expect(await cdpSubscribe({ send }, buffer, { method: "nodot" })).toEqual({ ok: false });
    expect(send).not.toHaveBeenCalled();
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
