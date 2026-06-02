import { EventEmitter, once } from "node:events";
import { WebSocket } from "ws";
import { ConversationServer } from "./conversationServer";
import type { ConversationSession } from "./conversationSession";
import type { ChildLike, ReadableLine } from "./jsonLineProcess";

const TOKEN = "secret";

/** A Pi child that never emits output — enough to exercise the wiring without a real `pi`. */
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

/**
 * Buffer every incoming frame and hand them out in order. A plain `once(client,
 * "message")` per read drops a frame when the server sends two back-to-back (a
 * `start` yields a user beat then a status beat) — the second arrives before the
 * next `once` is registered.
 */
function frames(client: WebSocket): () => Promise<unknown> {
  const queue: unknown[] = [];
  const waiters: ((v: unknown) => void)[] = [];
  client.on("message", (raw: Buffer) => {
    const msg = JSON.parse(raw.toString());
    const waiter = waiters.shift();
    if (waiter) waiter(msg);
    else queue.push(msg);
  });
  return () =>
    new Promise((resolve) => {
      if (queue.length) resolve(queue.shift());
      else waiters.push(resolve);
    });
}

describe("ConversationServer (real WebSocket)", () => {
  let server: ConversationServer;
  afterEach(async () => {
    await server.close();
  });

  it("authenticates a client, then a start command streams the opening beats", async () => {
    server = new ConversationServer({ token: TOKEN, spawn: fakeSpawn });
    const port = await server.listen();

    const client = new WebSocket(`ws://127.0.0.1:${port}`);
    const next = frames(client);
    await once(client, "open");
    client.send(JSON.stringify({ type: "auth", token: TOKEN }));
    expect(await next()).toEqual({ type: "auth_ok" });

    client.send(JSON.stringify({ type: "start", task: "book a flight" }));
    expect(await next()).toEqual({ type: "beat", beat: { kind: "user", text: "book a flight" } });
    expect(await next()).toEqual({ type: "beat", beat: { kind: "status", run: "running" } });
    client.close();
  });

  it("hands each connection's session to onSession", async () => {
    let session: ConversationSession | undefined;
    server = new ConversationServer({ token: TOKEN, spawn: fakeSpawn, onSession: (s) => (session = s) });
    const port = await server.listen();
    const client = new WebSocket(`ws://127.0.0.1:${port}`);
    const next = frames(client);
    await once(client, "open");
    client.send(JSON.stringify({ type: "auth", token: TOKEN }));
    expect(await next()).toEqual({ type: "auth_ok" });
    expect(session?.isAuthenticated).toBe(true);
    client.close();
  });

  it("close() before listen() resolves to a no-op", async () => {
    const fresh = new ConversationServer({ token: TOKEN, spawn: fakeSpawn });
    await expect(fresh.close()).resolves.toBeUndefined();
    server = fresh;
  });
});
