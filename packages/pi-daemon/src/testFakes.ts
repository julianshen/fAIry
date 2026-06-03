import { EventEmitter } from "node:events";
import { createConnection } from "node:net";
import type { ChildLike, ReadableLine } from "./jsonLineProcess";
import type { DomainSkills } from "./domainSkills";
import type { HelperRegistry } from "./helperRegistry";
import type { SkillsLibrary } from "./skillsLibrary";

// Shared test doubles for the "Pi never emits output" case — enough to exercise
// wiring (server bring-up, auth, the synchronous opening beats) without a real
// `pi` binary. Tests that DRIVE Pi output (piSession/conversation/jsonLineProcess)
// keep their own richer fakes — don't fold those in here.

/** A readable stream that never emits. */
export class SilentStream extends EventEmitter implements ReadableLine {
  setEncoding(): void {}
}

/** A Pi child that accepts writes but never produces output or exits. */
export class SilentChild extends EventEmitter implements ChildLike {
  stdout = new SilentStream();
  stderr = new SilentStream();
  stdin = { write: (): void => {} };
  kill(): boolean {
    return true;
  }
}

/** A {@link import("./jsonLineProcess").Spawner} yielding a fresh silent child. */
export const silentSpawn = (): ChildLike => new SilentChild();

/** A Pi child that records what's written to its stdin (for asserting messages sent to Pi). */
export class RecordingChild extends EventEmitter implements ChildLike {
  stdout = new SilentStream();
  stderr = new SilentStream();
  writes: string[] = [];
  stdin = { write: (chunk: string): void => void this.writes.push(chunk) };
  kill(): boolean {
    return true;
  }
  /** The messages sent to Pi, parsed from the NDJSON writes. */
  sent(): unknown[] {
    return this.writes.map((w) => JSON.parse(w));
  }
}

/** A skills library double for tests; override any method via `over`. */
export const fakeSkills = (over: Partial<SkillsLibrary> = {}): SkillsLibrary => ({
  preamble: () => Promise.resolve("# skills"),
  listInteractions: () => Promise.resolve([]),
  readInteraction: () => Promise.resolve(null),
  ...over,
});

/** An empty helper-registry double for wiring tests (createDaemon requires one). */
export const fakeHelpers = (over: Partial<HelperRegistry> = {}): HelperRegistry => ({
  list: () => [],
  get: () => undefined,
  save: () => {},
  remove: () => false,
  callExpression: (name, args) => `CALL(${name}, ${JSON.stringify(args)})`,
  ...over,
});

/** An empty domain-skills double for wiring tests (createDaemon requires one). */
export const fakeDomainSkills = (over: Partial<DomainSkills> = {}): DomainSkills => ({
  list: () => Promise.resolve([]),
  read: () => Promise.resolve(null),
  save: (host, name, body) => Promise.resolve({ host, name, body, bytes: body.length, updatedAt: 0 }),
  remove: () => Promise.resolve(false),
  search: () => Promise.resolve([]),
  ...over,
});

/**
 * A line-framed TCP client, as the Pi `-e` extension speaks to the piBridge:
 * `send` writes one JSON object per line; `next` resolves the next frame back.
 * Shared by the piBridgeServer and daemon relay tests.
 */
export function lineClient(port: number): {
  socket: ReturnType<typeof createConnection>;
  send: (o: unknown) => void;
  next: () => Promise<unknown>;
} {
  const socket = createConnection({ host: "127.0.0.1", port });
  socket.setEncoding("utf8");
  const queue: unknown[] = [];
  const waiters: ((v: unknown) => void)[] = [];
  let buf = "";
  socket.on("data", (chunk: string) => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const v = JSON.parse(line);
      const w = waiters.shift();
      if (w) w(v);
      else queue.push(v);
    }
  });
  return {
    socket,
    send: (o) => void socket.write(JSON.stringify(o) + "\n"),
    next: () =>
      new Promise((resolve) => (queue.length ? resolve(queue.shift()) : waiters.push(resolve))),
  };
}
