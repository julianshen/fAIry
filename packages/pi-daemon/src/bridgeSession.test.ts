import { BridgeSession } from "./bridgeSession";
import type { BridgeConnection } from "./bridgeSession";
import type { ToolRequest, ToolResponse } from "./bridge";

/** A connection double: captures sent frames, lets a test push messages/close. */
class FakeConnection implements BridgeConnection {
  sent: string[] = [];
  closed = false;
  private onMsg?: (data: string) => void;
  private onCls?: () => void;
  send(data: string): void {
    this.sent.push(data);
  }
  onMessage(handler: (data: string) => void): void {
    this.onMsg = handler;
  }
  onClose(handler: () => void): void {
    this.onCls = handler;
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.onCls?.();
  }
  // test helpers
  emit(value: unknown): void {
    this.onMsg?.(typeof value === "string" ? value : JSON.stringify(value));
  }
  drop(): void {
    this.close();
  }
  parsedSent(): unknown[] {
    return this.sent.map((s) => JSON.parse(s));
  }
}

const TOKEN = "secret-token";

function setup(opts: { token?: string } = {}) {
  const conn = new FakeConnection();
  const events: string[] = [];
  const session = new BridgeSession({
    token: opts.token ?? TOKEN,
    connection: conn,
    onAuthenticated: () => events.push("auth"),
    onClose: () => events.push("close"),
  });
  return { conn, session, events };
}

const authenticate = (conn: FakeConnection): void => conn.emit({ type: "auth", token: TOKEN });

describe("BridgeSession — auth handshake", () => {
  it("starts unauthenticated", () => {
    const { session } = setup();
    expect(session.isAuthenticated).toBe(false);
  });

  it("authenticates on a correct first message and acks", () => {
    const { conn, session, events } = setup();
    authenticate(conn);
    expect(session.isAuthenticated).toBe(true);
    expect(events).toContain("auth");
    expect(conn.parsedSent()).toContainEqual({ type: "auth_ok" });
  });

  it("closes the connection on a wrong token", () => {
    const { conn, session } = setup();
    conn.emit({ type: "auth", token: "wrong" });
    expect(session.isAuthenticated).toBe(false);
    expect(conn.closed).toBe(true);
  });

  it("closes on a malformed first message", () => {
    const { conn, session } = setup();
    conn.emit("not json");
    expect(session.isAuthenticated).toBe(false);
    expect(conn.closed).toBe(true);
  });
});

describe("BridgeSession — tool calls", () => {
  it("rejects requestTool before authentication", async () => {
    const { session } = setup();
    await expect(session.requestTool("click", {})).rejects.toThrow(/not authenticated/i);
  });

  it("sends a ToolRequest frame after auth", () => {
    const { conn, session } = setup();
    authenticate(conn);
    void session.requestTool("navigate", { url: "https://x.com" });
    const req = conn.parsedSent().find((m) => (m as ToolRequest).tool === "navigate") as ToolRequest;
    expect(req).toMatchObject({ tool: "navigate", args: { url: "https://x.com" } });
    expect(typeof req.id).toBe("string");
  });

  it("resolves a tool call when the matching response arrives", async () => {
    const { conn, session } = setup();
    authenticate(conn);
    const p = session.requestTool("getUrl", {});
    const id = (conn.parsedSent().find((m) => (m as ToolRequest).tool === "getUrl") as ToolRequest).id;
    conn.emit({ id, ok: true, result: "https://x.com" } satisfies ToolResponse);
    await expect(p).resolves.toBe("https://x.com");
  });

  it("ignores a malformed message after auth without crashing", () => {
    const { conn } = setup();
    authenticate(conn);
    expect(() => conn.emit("garbage")).not.toThrow();
  });

  it("forwards a per-call timeout to the correlator", async () => {
    vi.useFakeTimers();
    try {
      const conn = new FakeConnection();
      const session = new BridgeSession({ token: TOKEN, connection: conn, timeoutMs: 500 });
      conn.emit({ type: "auth", token: TOKEN });
      const p = session.requestTool("slow", {});
      const assertion = expect(p).rejects.toThrow(/timed out/i);
      vi.advanceTimersByTime(500);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("BridgeSession — auth timeout", () => {
  it("closes a connection that never authenticates within authTimeoutMs", () => {
    vi.useFakeTimers();
    try {
      const conn = new FakeConnection();
      const session = new BridgeSession({ token: TOKEN, connection: conn, authTimeoutMs: 1000 });
      vi.advanceTimersByTime(1000);
      expect(conn.closed).toBe(true);
      expect(session.isAuthenticated).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not close once authenticated before the deadline", () => {
    vi.useFakeTimers();
    try {
      const conn = new FakeConnection();
      const session = new BridgeSession({ token: TOKEN, connection: conn, authTimeoutMs: 1000 });
      conn.emit({ type: "auth", token: TOKEN });
      vi.advanceTimersByTime(2000);
      expect(conn.closed).toBe(false);
      expect(session.isAuthenticated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("BridgeSession — lifecycle", () => {
  it("rejects in-flight calls and notifies on connection close", async () => {
    const { conn, session, events } = setup();
    authenticate(conn);
    const p = session.requestTool("slow", {});
    conn.drop();
    await expect(p).rejects.toThrow(/closed/i);
    expect(events).toContain("close");
  });
});
