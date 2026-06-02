import { ConversationSession } from "./conversationSession";
import type { ConversationDriver } from "./conversationSession";
import type { BridgeConnection } from "./bridgeSession";
import type { PanelBeat } from "./beatMapper";

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
  emit(value: unknown): void {
    this.onMsg?.(typeof value === "string" ? value : JSON.stringify(value));
  }
  parsed(): unknown[] {
    return this.sent.map((s) => JSON.parse(s));
  }
}

const TOKEN = "tok";

/** A fake driver that records calls and exposes the beat sink. */
class FakeDriver implements ConversationDriver {
  started: string[] = [];
  stops = 0;
  disposes = 0;
  emitBeat!: (beat: PanelBeat) => void;
  start(task: string): void {
    this.started.push(task);
  }
  stop(): void {
    this.stops += 1;
  }
  dispose(): void {
    this.disposes += 1;
  }
}

function setup() {
  const conn = new FakeConnection();
  const driver = new FakeDriver();
  const events: string[] = [];
  const session = new ConversationSession({
    token: TOKEN,
    connection: conn,
    createDriver: (onBeat) => {
      driver.emitBeat = onBeat;
      return driver;
    },
    onClose: () => events.push("close"),
  });
  return { conn, driver, session, events };
}

const auth = (conn: FakeConnection): void => conn.emit({ type: "auth", token: TOKEN });

describe("ConversationSession — handshake", () => {
  it("authenticates on the correct token, acks, and creates the driver", () => {
    const { conn, session, driver } = setup();
    auth(conn);
    expect(session.isAuthenticated).toBe(true);
    expect(conn.parsed()).toContainEqual({ type: "auth_ok" });
    expect(driver.emitBeat).toBeTypeOf("function");
  });

  it("closes on a wrong token", () => {
    const { conn, session } = setup();
    conn.emit({ type: "auth", token: "nope" });
    expect(session.isAuthenticated).toBe(false);
    expect(conn.closed).toBe(true);
  });

  it("closes on a non-auth first message", () => {
    const { conn } = setup();
    conn.emit({ type: "start", task: "x" });
    expect(conn.closed).toBe(true);
  });

  it("closes on a malformed first message", () => {
    const { conn } = setup();
    conn.emit("not json");
    expect(conn.closed).toBe(true);
  });

  it("closes (and stays unauthenticated) if creating the driver throws", () => {
    const conn = new FakeConnection();
    const session = new ConversationSession({
      token: TOKEN,
      connection: conn,
      createDriver: () => {
        throw new Error("pi spawn failed");
      },
    });
    expect(() => conn.emit({ type: "auth", token: TOKEN })).not.toThrow();
    expect(session.isAuthenticated).toBe(false);
    expect(conn.closed).toBe(true);
  });
});

describe("ConversationSession — auth timeout", () => {
  it("closes a client that never authenticates within authTimeoutMs", () => {
    vi.useFakeTimers();
    try {
      const conn = new FakeConnection();
      new ConversationSession({
        token: TOKEN,
        connection: conn,
        createDriver: () => new FakeDriver(),
        authTimeoutMs: 1000,
      });
      vi.advanceTimersByTime(1000);
      expect(conn.closed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not close once authenticated before the deadline", () => {
    vi.useFakeTimers();
    try {
      const conn = new FakeConnection();
      const session = new ConversationSession({
        token: TOKEN,
        connection: conn,
        createDriver: () => new FakeDriver(),
        authTimeoutMs: 1000,
      });
      conn.emit({ type: "auth", token: TOKEN });
      vi.advanceTimersByTime(2000);
      expect(conn.closed).toBe(false);
      expect(session.isAuthenticated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ConversationSession — commands", () => {
  it("routes start to the driver", () => {
    const { conn, driver } = setup();
    auth(conn);
    conn.emit({ type: "start", task: "book a flight" });
    expect(driver.started).toEqual(["book a flight"]);
  });

  it("routes stop to the driver", () => {
    const { conn, driver } = setup();
    auth(conn);
    conn.emit({ type: "stop" });
    expect(driver.stops).toBe(1);
  });

  it("ignores unknown or malformed commands after auth without crashing", () => {
    const { conn, driver } = setup();
    auth(conn);
    expect(() => conn.emit({ type: "frobnicate" })).not.toThrow();
    expect(() => conn.emit("garbage")).not.toThrow();
    expect(() => conn.emit({ type: "start" })).not.toThrow(); // missing task
    expect(() => conn.emit(42)).not.toThrow(); // valid JSON, not an object
    expect(() => conn.emit(null)).not.toThrow();
    expect(driver.started).toEqual([]);
  });
});

describe("ConversationSession — beats out", () => {
  it("forwards driver beats to the client", () => {
    const { conn, driver } = setup();
    auth(conn);
    driver.emitBeat({ kind: "say", agent: "sage", text: "hi" });
    expect(conn.parsed()).toContainEqual({ type: "beat", beat: { kind: "say", agent: "sage", text: "hi" } });
  });

  it("does not send beats after the connection has closed", () => {
    const { conn, driver } = setup();
    auth(conn);
    conn.close();
    const before = conn.sent.length;
    driver.emitBeat({ kind: "say", agent: "sage", text: "late" });
    expect(conn.sent.length).toBe(before);
  });
});

describe("ConversationSession — lifecycle", () => {
  it("disposes the driver and notifies on close", () => {
    const { conn, driver, events } = setup();
    auth(conn);
    conn.close();
    expect(driver.disposes).toBe(1);
    expect(events).toContain("close");
  });

  it("does not dispose a driver that was never created (closed before auth)", () => {
    const { conn, driver, events } = setup();
    conn.close();
    expect(driver.disposes).toBe(0);
    expect(events).toContain("close");
  });
});
