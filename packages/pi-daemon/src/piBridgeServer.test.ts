import { once } from "node:events";
import { PiBridgeServer } from "./piBridgeServer";
import { lineClient } from "./testFakes";

const TOKEN = "secret";

async function connectAndAuth(port: number, token = TOKEN) {
  const c = lineClient(port);
  await once(c.socket, "connect");
  c.send({ type: "auth", token });
  return c;
}

describe("PiBridgeServer (real TCP)", () => {
  let server: PiBridgeServer;
  afterEach(async () => {
    await server.close();
  });

  it("authenticates, then relays a tool call to requestTool and returns the result", async () => {
    const calls: Array<{ tool: string; args: unknown }> = [];
    server = new PiBridgeServer({
      token: TOKEN,
      requestTool: async (tool, args) => {
        calls.push({ tool, args });
        return "https://x.com";
      },
    });
    const port = await server.listen();
    const c = await connectAndAuth(port);
    expect(await c.next()).toEqual({ type: "auth_ok" });

    c.send({ id: "1", tool: "navigate", args: { url: "https://x.com" } });
    expect(await c.next()).toEqual({ id: "1", ok: true, result: "https://x.com" });
    expect(calls).toEqual([{ tool: "navigate", args: { url: "https://x.com" } }]);
    c.socket.destroy();
  });

  it("returns ok:false with the message when the relayed tool rejects", async () => {
    server = new PiBridgeServer({
      token: TOKEN,
      requestTool: async () => {
        throw new Error("no browser connected");
      },
    });
    const port = await server.listen();
    const c = await connectAndAuth(port);
    expect(await c.next()).toEqual({ type: "auth_ok" });

    c.send({ id: "7", tool: "click", args: { x: 1, y: 2 } });
    expect(await c.next()).toEqual({ id: "7", ok: false, error: "no browser connected" });
    c.socket.destroy();
  });

  it("ignores malformed post-auth frames (non-object, null, missing id/tool) but serves valid ones", async () => {
    server = new PiBridgeServer({ token: TOKEN, requestTool: async () => "ok" });
    const port = await server.listen();
    const c = await connectAndAuth(port);
    expect(await c.next()).toEqual({ type: "auth_ok" });

    c.send(42); // non-object → dropped
    c.send(null); // null → dropped
    c.send({ nonsense: true }); // no id/tool → dropped
    c.send({ id: "9", tool: "getUrl", args: {} });
    expect(await c.next()).toEqual({ id: "9", ok: true, result: "ok" });
    c.socket.destroy();
  });

  it("stringifies a non-Error rejection into the error field", async () => {
    server = new PiBridgeServer({
      token: TOKEN,
      requestTool: () => Promise.reject("boom"),
    });
    const port = await server.listen();
    const c = await connectAndAuth(port);
    expect(await c.next()).toEqual({ type: "auth_ok" });
    c.send({ id: "1", tool: "navigate", args: {} });
    expect(await c.next()).toEqual({ id: "1", ok: false, error: "boom" });
    c.socket.destroy();
  });

  it("defaults a missing/!object args to an empty object", async () => {
    const calls: Array<{ tool: string; args: unknown }> = [];
    server = new PiBridgeServer({
      token: TOKEN,
      requestTool: async (tool, args) => {
        calls.push({ tool, args });
        return "ok";
      },
    });
    const port = await server.listen();
    const c = await connectAndAuth(port);
    expect(await c.next()).toEqual({ type: "auth_ok" });

    c.send({ id: "1", tool: "getUrl" }); // no args
    expect(await c.next()).toEqual({ id: "1", ok: true, result: "ok" });
    c.send({ id: "2", tool: "getTitle", args: null }); // null args
    expect(await c.next()).toEqual({ id: "2", ok: true, result: "ok" });
    c.send({ id: "3", tool: "axtree", args: [1, 2] }); // array args (typeof "object")
    expect(await c.next()).toEqual({ id: "3", ok: true, result: "ok" });
    expect(calls).toEqual([
      { tool: "getUrl", args: {} },
      { tool: "getTitle", args: {} },
      { tool: "axtree", args: {} },
    ]);
    c.socket.destroy();
  });

  it("answers ok:false when requestTool throws synchronously (no daemon crash)", async () => {
    server = new PiBridgeServer({
      token: TOKEN,
      requestTool: () => {
        throw new Error("sync boom");
      },
    });
    const port = await server.listen();
    const c = await connectAndAuth(port);
    expect(await c.next()).toEqual({ type: "auth_ok" });
    c.send({ id: "1", tool: "navigate", args: {} });
    expect(await c.next()).toEqual({ id: "1", ok: false, error: "sync boom" });
    c.socket.destroy();
  });

  it("drops a relayed result that arrives after the client disconnected", async () => {
    let resolveTool!: (v: unknown) => void;
    server = new PiBridgeServer({
      token: TOKEN,
      requestTool: () => new Promise((r) => (resolveTool = r)),
    });
    const port = await server.listen();
    const c = await connectAndAuth(port);
    expect(await c.next()).toEqual({ type: "auth_ok" });

    c.send({ id: "1", tool: "navigate", args: {} });
    c.socket.destroy();
    await new Promise((r) => setTimeout(r, 25)); // let 'close' reach the session
    // The session is no longer authenticated, so replying must be a silent no-op.
    expect(() => resolveTool("late")).not.toThrow();
  });

  it("hands each session to onSession", async () => {
    let seen = false;
    server = new PiBridgeServer({ token: TOKEN, requestTool: async () => null, onSession: () => (seen = true) });
    const port = await server.listen();
    const c = await connectAndAuth(port);
    expect(await c.next()).toEqual({ type: "auth_ok" });
    expect(seen).toBe(true);
    c.socket.destroy();
  });

  it("closes a client that presents the wrong token", async () => {
    server = new PiBridgeServer({ token: TOKEN, requestTool: async () => null });
    const port = await server.listen();
    const c = await connectAndAuth(port, "wrong");
    const [hadError] = (await once(c.socket, "close")) as [boolean];
    expect(typeof hadError).toBe("boolean");
  });

  it("refuses to bind a non-loopback host", async () => {
    server = new PiBridgeServer({ token: TOKEN, requestTool: async () => null, host: "0.0.0.0" });
    await expect(server.listen()).rejects.toThrow(/loopback/);
  });

  it("rejects a second listen while already listening", async () => {
    server = new PiBridgeServer({ token: TOKEN, requestTool: async () => null });
    await server.listen();
    await expect(server.listen()).rejects.toThrow(/already/i);
  });

  it("rejects listen() when the port is already in use", async () => {
    server = new PiBridgeServer({ token: TOKEN, requestTool: async () => null });
    const port = await server.listen();
    const second = new PiBridgeServer({ token: TOKEN, requestTool: async () => null, port });
    await expect(second.listen()).rejects.toBeDefined();
  });

  it("close() destroys live sockets so shutdown can't hang on a connected client", async () => {
    server = new PiBridgeServer({ token: TOKEN, requestTool: async () => null });
    const port = await server.listen();
    const c = await connectAndAuth(port);
    expect(await c.next()).toEqual({ type: "auth_ok" });
    // With the client still connected, close() must still resolve promptly
    // (a plain server.close() would wait for the socket to end → hang).
    await expect(server.close()).resolves.toBeUndefined();
    c.socket.destroy();
  });

  it("close() before listen() resolves to a no-op", async () => {
    const fresh = new PiBridgeServer({ token: TOKEN, requestTool: async () => null });
    await expect(fresh.close()).resolves.toBeUndefined();
    server = fresh;
  });
});
