import { once } from "node:events";
import { WebSocket } from "ws";
import { createDaemon, type PiBridgeInfo } from "./daemon";
import { HttpServer } from "./httpServer";
import { createPairingStore } from "./pairing";
import { lineClient, SilentChild, silentSpawn } from "./testFakes";
import type { SettingsStore } from "./settings";
import type { PiConfig } from "./piConfig";

const TOKEN = "tok";

function fakeStore(): SettingsStore {
  let cfg: PiConfig = { providers: [] };
  return { get: () => cfg, save: (c) => void (cfg = c) };
}

/** Connect, authenticate, return the first frame back. */
async function wsAuth(port: number): Promise<unknown> {
  const client = new WebSocket(`ws://127.0.0.1:${port}`);
  await once(client, "open");
  client.send(JSON.stringify({ type: "auth", token: TOKEN }));
  const [raw] = (await once(client, "message")) as [Buffer];
  client.close();
  return JSON.parse(raw.toString());
}

describe("createDaemon", () => {
  it("starts the four loopback servers on distinct ports and authenticates each", async () => {
    const daemon = await createDaemon({ token: TOKEN, settings: fakeStore(), spawnPi: silentSpawn });
    try {
      const { bridge, piBridge, conversation, http } = daemon.ports;
      expect(new Set([bridge, piBridge, conversation, http]).size).toBe(4);

      const status = await fetch(`http://127.0.0.1:${http}/status`, {
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      expect(status.status).toBe(200);

      // bridge + conversation are WebSocket; piBridge is TCP (its own tests cover it).
      expect(await wsAuth(bridge)).toEqual({ type: "auth_ok" });
      expect(await wsAuth(conversation)).toEqual({ type: "auth_ok" });
    } finally {
      await daemon.close();
    }
  });

  it("spawns Pi for an authenticated conversation, pointed at the piBridge", async () => {
    const spawns: PiBridgeInfo[] = [];
    const daemon = await createDaemon({
      token: TOKEN,
      settings: fakeStore(),
      spawnPi: (bridge) => {
        spawns.push(bridge);
        return new SilentChild();
      },
    });
    try {
      const client = new WebSocket(`ws://127.0.0.1:${daemon.ports.conversation}`);
      await once(client, "open");
      client.send(JSON.stringify({ type: "auth", token: TOKEN }));
      await once(client, "message"); // auth_ok — Pi is spawned on auth (driver creation)
      expect(spawns).toEqual([{ port: daemon.ports.piBridge, token: TOKEN }]);
      client.close();
    } finally {
      await daemon.close();
    }
  });

  it("relays a Pi tool call through to the connected Chrome bridge", async () => {
    const daemon = await createDaemon({ token: TOKEN, settings: fakeStore(), spawnPi: silentSpawn });
    try {
      // Chrome side (executor): a WS client that answers every tool request.
      const chrome = new WebSocket(`ws://127.0.0.1:${daemon.ports.bridge}`);
      await once(chrome, "open");
      chrome.send(JSON.stringify({ type: "auth", token: TOKEN }));
      await once(chrome, "message"); // auth_ok
      chrome.on("message", (raw: Buffer) => {
        const req = JSON.parse(raw.toString()) as { id?: string; tool?: string };
        if (req.id && req.tool) chrome.send(JSON.stringify({ id: req.id, ok: true, result: `did:${req.tool}` }));
      });

      // Pi side (requester): a TCP client through the piBridge.
      const pi = lineClient(daemon.ports.piBridge);
      await once(pi.socket, "connect");
      pi.send({ type: "auth", token: TOKEN });
      expect(await pi.next()).toEqual({ type: "auth_ok" });
      pi.send({ id: "1", tool: "navigate", args: { url: "https://x" } });
      expect(await pi.next()).toEqual({ id: "1", ok: true, result: "did:navigate" });

      chrome.close();
      pi.socket.destroy();
    } finally {
      await daemon.close();
    }
  });

  it("keeps the authenticated Chrome bridge when a second connection arrives unauthenticated", async () => {
    const daemon = await createDaemon({ token: TOKEN, settings: fakeStore(), spawnPi: silentSpawn });
    try {
      // Chrome #1 authenticates and answers tool calls — the active bridge.
      const chrome1 = new WebSocket(`ws://127.0.0.1:${daemon.ports.bridge}`);
      await once(chrome1, "open");
      chrome1.send(JSON.stringify({ type: "auth", token: TOKEN }));
      await once(chrome1, "message"); // auth_ok
      chrome1.on("message", (raw: Buffer) => {
        const req = JSON.parse(raw.toString()) as { id?: string; tool?: string };
        if (req.id && req.tool) chrome1.send(JSON.stringify({ id: req.id, ok: true, result: "from-1" }));
      });

      // Chrome #2 connects but never authenticates — must NOT displace #1.
      const chrome2 = new WebSocket(`ws://127.0.0.1:${daemon.ports.bridge}`);
      await once(chrome2, "open");
      await new Promise((r) => setTimeout(r, 25));

      const pi = lineClient(daemon.ports.piBridge);
      await once(pi.socket, "connect");
      pi.send({ type: "auth", token: TOKEN });
      expect(await pi.next()).toEqual({ type: "auth_ok" });
      pi.send({ id: "1", tool: "getUrl", args: {} });
      expect(await pi.next()).toEqual({ id: "1", ok: true, result: "from-1" });

      chrome1.close();
      chrome2.close();
      pi.socket.destroy();
    } finally {
      await daemon.close();
    }
  });

  it("reports 'no browser connected' after the Chrome bridge disconnects", async () => {
    const daemon = await createDaemon({ token: TOKEN, settings: fakeStore(), spawnPi: silentSpawn });
    try {
      const chrome = new WebSocket(`ws://127.0.0.1:${daemon.ports.bridge}`);
      await once(chrome, "open");
      chrome.send(JSON.stringify({ type: "auth", token: TOKEN }));
      await once(chrome, "message"); // auth_ok
      chrome.close();
      await once(chrome, "close");
      await new Promise((r) => setTimeout(r, 25)); // let the server mark the session closed

      const pi = lineClient(daemon.ports.piBridge);
      await once(pi.socket, "connect");
      pi.send({ type: "auth", token: TOKEN });
      expect(await pi.next()).toEqual({ type: "auth_ok" });
      pi.send({ id: "1", tool: "getUrl", args: {} });
      expect(await pi.next()).toEqual({ id: "1", ok: false, error: "no browser connected" });
      pi.socket.destroy();
    } finally {
      await daemon.close();
    }
  });

  it("answers a Pi tool call with 'no browser connected' when no Chrome bridge is present", async () => {
    const daemon = await createDaemon({ token: TOKEN, settings: fakeStore(), spawnPi: silentSpawn });
    try {
      const pi = lineClient(daemon.ports.piBridge);
      await once(pi.socket, "connect");
      pi.send({ type: "auth", token: TOKEN });
      expect(await pi.next()).toEqual({ type: "auth_ok" });
      pi.send({ id: "1", tool: "getUrl", args: {} });
      expect(await pi.next()).toEqual({ id: "1", ok: false, error: "no browser connected" });
      pi.socket.destroy();
    } finally {
      await daemon.close();
    }
  });

  it("exposes the pairing endpoint when a pairing store is provided", async () => {
    const daemon = await createDaemon({
      token: TOKEN,
      settings: fakeStore(),
      spawnPi: silentSpawn,
      pairing: createPairingStore({ token: TOKEN, code: "PAIRCODE" }),
    });
    try {
      const res = await fetch(`http://127.0.0.1:${daemon.ports.http}/pair`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "PAIRCODE" }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ token: TOKEN });
    } finally {
      await daemon.close();
    }
  });

  it("close() stops every server", async () => {
    const daemon = await createDaemon({ token: TOKEN, settings: fakeStore(), spawnPi: silentSpawn });
    const httpPort = daemon.ports.http;
    await daemon.close();
    await expect(
      fetch(`http://127.0.0.1:${httpPort}/status`, { headers: { authorization: `Bearer ${TOKEN}` } }),
    ).rejects.toBeDefined();
  });

  it("rejects and tears down the others if one server can't bind", async () => {
    const occupier = new HttpServer({ token: TOKEN, settings: fakeStore() });
    const taken = await occupier.listen();
    try {
      await expect(
        createDaemon({ token: TOKEN, settings: fakeStore(), spawnPi: silentSpawn, ports: { http: taken } }),
      ).rejects.toBeDefined();
    } finally {
      await occupier.close();
    }
  });
});
