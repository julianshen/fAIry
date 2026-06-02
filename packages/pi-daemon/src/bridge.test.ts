import { RequestCorrelator } from "./bridge";
import type { ToolRequest } from "./bridge";

function setup(timeoutMs?: number) {
  const sent: ToolRequest[] = [];
  const correlator = new RequestCorrelator({
    send: (req) => sent.push(req),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });
  return { sent, correlator };
}

describe("RequestCorrelator — sending", () => {
  it("sends a tool request with a unique id and returns a pending promise", () => {
    const { sent, correlator } = setup();
    void correlator.request("click", { x: 10 });
    expect(sent).toEqual([{ id: "req-1", tool: "click", args: { x: 10 } }]);
    expect(correlator.pendingCount).toBe(1);
  });

  it("issues incrementing ids", () => {
    const { sent, correlator } = setup();
    void correlator.request("a", {});
    void correlator.request("b", {});
    expect(sent.map((r) => r.id)).toEqual(["req-1", "req-2"]);
  });
});

describe("RequestCorrelator — resolving", () => {
  it("resolves the matching request with the result", async () => {
    const { correlator } = setup();
    const p = correlator.request("getUrl", {});
    expect(correlator.resolve({ id: "req-1", ok: true, result: "https://x.com" })).toBe(true);
    await expect(p).resolves.toBe("https://x.com");
    expect(correlator.pendingCount).toBe(0);
  });

  it("rejects the matching request on a tool error", async () => {
    const { correlator } = setup();
    const p = correlator.request("click", {});
    correlator.resolve({ id: "req-1", ok: false, error: "no such element" });
    await expect(p).rejects.toThrow("no such element");
  });

  it("ignores a response with no matching pending request", () => {
    const { correlator } = setup();
    expect(correlator.resolve({ id: "req-999", ok: true })).toBe(false);
  });

  it("rejects with a default message when the error field is absent", async () => {
    const { correlator } = setup();
    const p = correlator.request("x", {});
    correlator.resolve({ id: "req-1", ok: false });
    await expect(p).rejects.toThrow("tool request failed");
  });

  it("rejects all pending requests when the connection drops", async () => {
    const { correlator } = setup();
    const a = correlator.request("a", {});
    const b = correlator.request("b", {});
    correlator.rejectAll("extension disconnected");
    await expect(a).rejects.toThrow("extension disconnected");
    await expect(b).rejects.toThrow("extension disconnected");
    expect(correlator.pendingCount).toBe(0);
  });
});

describe("RequestCorrelator — timeouts", () => {
  it("rejects a request that gets no response within the timeout", async () => {
    vi.useFakeTimers();
    try {
      const { correlator } = setup(1000);
      const p = correlator.request("slow", {});
      const assertion = expect(p).rejects.toThrow(/timed out/i);
      vi.advanceTimersByTime(1000);
      await assertion;
      expect(correlator.pendingCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the timeout once a response arrives", async () => {
    vi.useFakeTimers();
    try {
      const { correlator } = setup(1000);
      const p = correlator.request("quick", {});
      correlator.resolve({ id: "req-1", ok: true, result: 42 });
      await expect(p).resolves.toBe(42);
      // Advancing past the timeout must not throw an unhandled rejection.
      vi.advanceTimersByTime(2000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not arm a timeout when none is configured", () => {
    const { correlator } = setup();
    void correlator.request("forever", {});
    expect(correlator.pendingCount).toBe(1);
  });

  it("clears armed timeouts on rejectAll", async () => {
    vi.useFakeTimers();
    try {
      const { correlator } = setup(1000);
      const p = correlator.request("x", {});
      correlator.rejectAll("gone");
      await expect(p).rejects.toThrow("gone");
      // The armed timeout was cleared, so advancing must not re-settle it.
      vi.advanceTimersByTime(2000);
    } finally {
      vi.useRealTimers();
    }
  });
});
