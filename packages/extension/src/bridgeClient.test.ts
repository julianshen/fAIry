import { connectBridge } from "./bridgeClient";
import { FakeSocket } from "./testSocket";

/** Flush pending microtasks (the execute → reply chain settles across a few ticks). */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function setup(execute: (tool: string, args: Record<string, unknown>) => Promise<unknown>) {
  const socket = new FakeSocket();
  const client = connectBridge({
    url: "ws://127.0.0.1:6001",
    token: "TOK",
    execute,
    socketFactory: () => socket,
  });
  return { socket, client };
}

describe("connectBridge", () => {
  it("authenticates with the token as the first frame on open", () => {
    const { socket } = setup(async () => null);
    socket.fireOpen();
    expect(socket.parsed()[0]).toEqual({ type: "auth", token: "TOK" });
  });

  it("executes a tool request and replies with the result keyed by id", async () => {
    const calls: Array<{ tool: string; args: unknown }> = [];
    const { socket } = setup(async (tool, args) => {
      calls.push({ tool, args });
      return "https://x.com";
    });
    socket.fireOpen();
    socket.fireMessage({ id: "1", tool: "getUrl", args: {} });
    await flush();
    expect(calls).toEqual([{ tool: "getUrl", args: {} }]);
    // reply is sent after auth
    expect(socket.parsed().at(-1)).toEqual({ id: "1", ok: true, result: "https://x.com" });
  });

  it("replies ok:false with the message when the tool throws", async () => {
    const { socket } = setup(async () => {
      throw new Error("no active tab");
    });
    socket.fireOpen();
    socket.fireMessage({ id: "7", tool: "click", args: { x: 1, y: 2 } });
    await flush();
    expect(socket.parsed().at(-1)).toEqual({ id: "7", ok: false, error: "no active tab" });
  });

  it("stringifies a non-Error rejection into the error field", async () => {
    const { socket } = setup(() => Promise.reject("boom"));
    socket.fireOpen();
    socket.fireMessage({ id: "1", tool: "navigate", args: {} });
    await flush();
    expect(socket.parsed().at(-1)).toEqual({ id: "1", ok: false, error: "boom" });
  });

  it("replies ok:false when execute throws synchronously (not just rejects)", async () => {
    const { socket } = setup(() => {
      throw new Error("sync boom");
    });
    socket.fireOpen();
    socket.fireMessage({ id: "1", tool: "navigate", args: {} });
    await flush();
    expect(socket.parsed().at(-1)).toEqual({ id: "1", ok: false, error: "sync boom" });
  });

  it("invokes onClose when the socket closes", () => {
    const socket = new FakeSocket();
    let closed = false;
    connectBridge({
      url: "ws://x",
      token: "T",
      execute: async () => null,
      onClose: () => (closed = true),
      socketFactory: () => socket,
    });
    socket.fireClose();
    expect(closed).toBe(true);
  });

  it("ignores malformed requests (missing id/tool, non-object, bad JSON)", async () => {
    let executed = 0;
    const { socket } = setup(async () => {
      executed++;
      return "ok";
    });
    socket.fireOpen();
    const after = socket.sent.length;
    socket.fireMessage({ nonsense: true }); // no id/tool
    socket.fireMessage(42); // non-object
    socket.fireMessage(null); // null
    socket.fireRaw("{bad json"); // unparseable
    await flush();
    expect(executed).toBe(0);
    expect(socket.sent.length).toBe(after); // nothing replied
  });

  it("stops replying after the socket closes", async () => {
    let resolveExec!: (v: unknown) => void;
    const { socket } = setup(() => new Promise((r) => (resolveExec = r)));
    socket.fireOpen();
    socket.fireMessage({ id: "1", tool: "getUrl", args: {} });
    await flush(); // let execute() run + capture resolveExec (its promise stays pending)
    const before = socket.sent.length;
    socket.fireClose();
    socket.fireMessage({ id: "2", tool: "click", args: {} }); // arrives after close → ignored
    resolveExec("late"); // the first request's execute settles after close
    await flush();
    expect(socket.sent.length).toBe(before); // nothing replied on a closed socket
  });

  it("defaults missing/non-object args to {}", async () => {
    const calls: Array<{ tool: string; args: unknown }> = [];
    const { socket } = setup(async (tool, args) => {
      calls.push({ tool, args });
      return "ok";
    });
    socket.fireOpen();
    socket.fireMessage({ id: "1", tool: "getUrl" }); // no args
    socket.fireMessage({ id: "2", tool: "getTitle", args: [1, 2] }); // array
    await flush();
    expect(calls).toEqual([
      { tool: "getUrl", args: {} },
      { tool: "getTitle", args: {} },
    ]);
  });

  it("replies with an error when the tool result is not serializable", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const { socket } = setup(async () => circular);
    socket.fireOpen();
    socket.fireMessage({ id: "1", tool: "getDom", args: {} });
    await flush();
    expect(socket.parsed().at(-1)).toMatchObject({ id: "1", ok: false });
  });

  it("stops replying once close() is called, before the close event arrives", async () => {
    let resolveExec!: (v: unknown) => void;
    const { socket, client } = setup(() => new Promise((r) => (resolveExec = r)));
    socket.fireOpen();
    socket.fireMessage({ id: "1", tool: "getUrl", args: {} });
    await flush(); // execute runs, promise pending
    const before = socket.sent.length;
    client.close(); // sets closed synchronously — no onClose event fired here
    resolveExec("late");
    await flush();
    expect(socket.sent.length).toBe(before); // no reply after close() was called
  });

  it("close() closes the socket", () => {
    const { socket, client } = setup(async () => null);
    client.close();
    expect(socket.closed).toBe(true);
  });

  it("defaults to a real WebSocket adapter when no factory is injected", () => {
    const created: string[] = [];
    class FakeWS {
      constructor(url: string) {
        created.push(url);
      }
      addEventListener(): void {}
      send(): void {}
      close(): void {}
    }
    vi.stubGlobal("WebSocket", FakeWS);
    try {
      const client = connectBridge({ url: "ws://127.0.0.1:6001", token: "T", execute: async () => null });
      expect(created).toEqual(["ws://127.0.0.1:6001"]);
      client.close();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
