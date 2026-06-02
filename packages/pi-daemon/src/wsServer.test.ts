import { once } from "node:events";
import { WebSocket } from "ws";
import { WsServer } from "./wsServer";
import type { BridgeConnection } from "./authenticatedSession";

describe("WsServer (real WebSocket)", () => {
  let server: WsServer;
  afterEach(async () => {
    await server.close();
  });

  it("adapts each accepted socket to a working BridgeConnection", async () => {
    let conn: BridgeConnection | undefined;
    const received: string[] = [];
    let closed = false;
    server = new WsServer({
      onConnection: (c) => {
        conn = c;
        c.onMessage((d) => received.push(d));
        c.onClose(() => (closed = true));
      },
    });
    const port = await server.listen();

    const client = new WebSocket(`ws://127.0.0.1:${port}`);
    await once(client, "open");
    expect(conn).toBeDefined();

    // server -> client
    conn!.send("world");
    const [raw] = (await once(client, "message")) as [Buffer];
    expect(raw.toString()).toBe("world");

    // client -> server
    client.send("hello");
    await new Promise((r) => setTimeout(r, 20));
    expect(received).toContain("hello");

    client.close();
    await new Promise((r) => setTimeout(r, 20));
    expect(closed).toBe(true);
  });

  it("rejects a browser (http/https) Origin by default", async () => {
    server = new WsServer({ onConnection: () => {} });
    const port = await server.listen();
    const client = new WebSocket(`ws://127.0.0.1:${port}`, { origin: "http://evil.example" });
    const [, res] = (await once(client, "unexpected-response")) as [unknown, { statusCode: number }];
    expect(res.statusCode).toBe(401);
  });

  it("honors an allowedOrigins allowlist", async () => {
    server = new WsServer({ onConnection: () => {}, allowedOrigins: ["chrome-extension://ok"] });
    const port = await server.listen();
    const bad = new WebSocket(`ws://127.0.0.1:${port}`, { origin: "chrome-extension://no" });
    const [, res] = (await once(bad, "unexpected-response")) as [unknown, { statusCode: number }];
    expect(res.statusCode).toBe(401);
  });

  it("rejects a second listen() and a port already in use", async () => {
    server = new WsServer({ onConnection: () => {} });
    const port = await server.listen();
    await expect(server.listen()).rejects.toThrow(/already/i);
    const second = new WsServer({ onConnection: () => {}, port });
    await expect(second.listen()).rejects.toBeTruthy();
  });

  it("close() before listen() is a no-op", async () => {
    const fresh = new WsServer({ onConnection: () => {} });
    await expect(fresh.close()).resolves.toBeUndefined();
    server = fresh;
  });
});
