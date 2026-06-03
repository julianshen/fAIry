import { describe, expect, it } from "vitest";
import { createEventBuffer } from "./eventBuffer";

describe("createEventBuffer", () => {
  it("rejects a method without a domain (no dot)", () => {
    const b = createEventBuffer();
    expect(b.subscribe("notvalid")).toEqual({ ok: false });
    expect(b.isSubscribed("notvalid")).toBe(false);
  });

  it("subscribe returns ok + the domain to enable", () => {
    const b = createEventBuffer();
    expect(b.subscribe("Network.responseReceived")).toEqual({ ok: true, domain: "Network" });
    expect(b.isSubscribed("Network.responseReceived")).toBe(true);
  });

  it("buffers only subscribed methods", () => {
    const b = createEventBuffer();
    b.subscribe("Network.responseReceived");
    b.push("Network.responseReceived", { status: 200 }, 1);
    b.push("Page.loadEventFired", { t: 1 }, 2); // not subscribed → dropped
    const all = b.collect();
    expect(all).toEqual([{ at: 1, method: "Network.responseReceived", params: { status: 200 } }]);
  });

  it("collect drains: a second collect returns only newer events", () => {
    const b = createEventBuffer();
    b.subscribe("Network.responseReceived");
    b.push("Network.responseReceived", { n: 1 }, 1);
    expect(b.collect("Network.responseReceived")).toHaveLength(1);
    expect(b.collect("Network.responseReceived")).toEqual([]); // already drained
    b.push("Network.responseReceived", { n: 2 }, 2);
    expect(b.collect("Network.responseReceived").map((e) => e.params)).toEqual([{ n: 2 }]);
  });

  it("collect honors max and leaves the rest buffered", () => {
    const b = createEventBuffer();
    b.subscribe("Network.responseReceived");
    for (let n = 1; n <= 5; n++) b.push("Network.responseReceived", { n }, n);
    expect(b.collect("Network.responseReceived", 2).map((e) => e.params)).toEqual([{ n: 1 }, { n: 2 }]);
    expect(b.collect("Network.responseReceived", 2).map((e) => e.params)).toEqual([{ n: 3 }, { n: 4 }]);
  });

  it("collect with no method drains across all subscribed methods", () => {
    const b = createEventBuffer();
    b.subscribe("Network.responseReceived");
    b.subscribe("Network.requestWillBeSent");
    b.push("Network.responseReceived", { a: 1 }, 1);
    b.push("Network.requestWillBeSent", { b: 1 }, 2);
    expect(b.collect()).toHaveLength(2);
    expect(b.collect()).toEqual([]); // both drained
  });

  it("unsubscribe(method) stops buffering it and clears its events", () => {
    const b = createEventBuffer();
    b.subscribe("Network.responseReceived");
    b.push("Network.responseReceived", { n: 1 }, 1);
    expect(b.unsubscribe("Network.responseReceived")).toEqual({ ok: true, cleared: 1 });
    expect(b.isSubscribed("Network.responseReceived")).toBe(false);
    b.push("Network.responseReceived", { n: 2 }, 2); // dropped now
    expect(b.collect()).toEqual([]);
  });

  it("unsubscribe() with no method clears everything", () => {
    const b = createEventBuffer();
    b.subscribe("Network.responseReceived");
    b.subscribe("Page.loadEventFired");
    expect(b.unsubscribe()).toEqual({ ok: true, cleared: 2 });
    expect(b.isSubscribed("Network.responseReceived")).toBe(false);
  });

  it("caps a method's buffer, dropping the oldest events", () => {
    const b = createEventBuffer(3); // tiny cap for the test
    b.subscribe("Network.responseReceived");
    for (let n = 1; n <= 5; n++) b.push("Network.responseReceived", { n }, n);
    expect(b.collect().map((e) => e.params)).toEqual([{ n: 3 }, { n: 4 }, { n: 5 }]);
  });
});
