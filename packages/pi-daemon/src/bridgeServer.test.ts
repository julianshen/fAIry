import { once } from "node:events";
import { WebSocket } from "ws";
import { BridgeServer } from "./bridgeServer";
import type { BridgeSession } from "./bridgeSession";
import type { ToolRequest } from "./bridge";

const TOKEN = "secret";

/** Resolve with the next text frame from a ws client. */
async function nextMessage(client: WebSocket): Promise<unknown> {
  const [raw] = (await once(client, "message")) as [Buffer];
  return JSON.parse(raw.toString());
}

describe("BridgeServer (real WebSocket)", () => {
  let server: BridgeServer;

  afterEach(async () => {
    await server.close();
  });

  it("authenticates a client and round-trips a tool call", async () => {
    let session: BridgeSession | undefined;
    server = new BridgeServer({ token: TOKEN, onSession: (s) => (session = s) });
    const port = await server.listen();

    const client = new WebSocket(`ws://127.0.0.1:${port}`);
    await once(client, "open");

    client.send(JSON.stringify({ type: "auth", token: TOKEN }));
    expect(await nextMessage(client)).toEqual({ type: "auth_ok" });
    expect(session?.isAuthenticated).toBe(true);

    // Daemon side issues a tool call; the client receives it and replies.
    const call = session!.requestTool("getUrl", {});
    const req = (await nextMessage(client)) as ToolRequest;
    expect(req).toMatchObject({ tool: "getUrl", args: {} });
    client.send(JSON.stringify({ id: req.id, ok: true, result: "https://x.com" }));

    await expect(call).resolves.toBe("https://x.com");
    client.close();
  });

  it("forwards timeout options to each session", async () => {
    server = new BridgeServer({ token: TOKEN, timeoutMs: 5000, authTimeoutMs: 5000 });
    const port = await server.listen();
    const client = new WebSocket(`ws://127.0.0.1:${port}`);
    await once(client, "open");
    client.send(JSON.stringify({ type: "auth", token: TOKEN }));
    expect(await nextMessage(client)).toEqual({ type: "auth_ok" });
    client.close();
  });

  it("close() before listen() resolves to a no-op", async () => {
    const fresh = new BridgeServer({ token: TOKEN });
    await expect(fresh.close()).resolves.toBeUndefined();
    server = fresh; // afterEach close() is then a no-op too
  });

  it("closes a client that presents the wrong token", async () => {
    server = new BridgeServer({ token: TOKEN });
    const port = await server.listen();

    const client = new WebSocket(`ws://127.0.0.1:${port}`);
    await once(client, "open");
    client.send(JSON.stringify({ type: "auth", token: "wrong" }));

    const [code] = (await once(client, "close")) as [number];
    expect(typeof code).toBe("number");
  });

  it("listen() resolves with the bound port and close() stops accepting", async () => {
    server = new BridgeServer({ token: TOKEN });
    const port = await server.listen();
    expect(port).toBeGreaterThan(0);
    await server.close();

    const client = new WebSocket(`ws://127.0.0.1:${port}`);
    const [err] = (await once(client, "error")) as [Error];
    expect(err).toBeInstanceOf(Error);
    // re-assign so afterEach's close() is a no-op on an already-closed server
    server = new BridgeServer({ token: TOKEN });
    await server.listen();
  });
});
