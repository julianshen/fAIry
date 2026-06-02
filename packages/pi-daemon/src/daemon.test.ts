import { EventEmitter, once } from "node:events";
import { WebSocket } from "ws";
import { createDaemon } from "./daemon";
import { HttpServer } from "./httpServer";
import type { SettingsStore } from "./settings";
import type { ChildLike, ReadableLine } from "./jsonLineProcess";
import type { PiConfig } from "./piConfig";

const TOKEN = "tok";

class FakeStream extends EventEmitter implements ReadableLine {
  setEncoding(): void {}
}
class FakeChild extends EventEmitter implements ChildLike {
  stdout = new FakeStream();
  stderr = new FakeStream();
  stdin = { write: (): void => {} };
  kill(): boolean {
    return true;
  }
}
const fakeSpawn = (): ChildLike => new FakeChild();

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
  it("starts the three loopback servers on distinct ports and authenticates each", async () => {
    const daemon = await createDaemon({ token: TOKEN, settings: fakeStore(), spawn: fakeSpawn });
    try {
      const { bridge, conversation, http } = daemon.ports;
      expect(new Set([bridge, conversation, http]).size).toBe(3);

      const status = await fetch(`http://127.0.0.1:${http}/status`, {
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      expect(status.status).toBe(200);

      expect(await wsAuth(bridge)).toEqual({ type: "auth_ok" });
      expect(await wsAuth(conversation)).toEqual({ type: "auth_ok" });
    } finally {
      await daemon.close();
    }
  });

  it("close() stops every server", async () => {
    const daemon = await createDaemon({ token: TOKEN, settings: fakeStore(), spawn: fakeSpawn });
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
        createDaemon({ token: TOKEN, settings: fakeStore(), spawn: fakeSpawn, ports: { http: taken } }),
      ).rejects.toBeDefined();
    } finally {
      await occupier.close();
    }
  });
});
