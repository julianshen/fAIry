import { EventEmitter } from "node:events";
import { JsonLineProcess } from "./jsonLineProcess";
import type { ChildLike, ReadableLine, JsonLineHandlers } from "./jsonLineProcess";

/** A readable stream that records its encoding and lets a test push data. */
class FakeStream extends EventEmitter implements ReadableLine {
  encoding: string | undefined;
  setEncoding(enc: string): void {
    this.encoding = enc;
  }
  feed(chunk: string): void {
    this.emit("data", chunk);
  }
}

/** A child process double — captures stdin writes, drives stdout/stderr/exit. */
class FakeChild extends EventEmitter implements ChildLike {
  writes: string[] = [];
  stdout = new FakeStream();
  stderr = new FakeStream();
  killed: string | undefined;
  stdin = {
    write: (chunk: string): void => {
      this.writes.push(chunk);
    },
  };
  kill(signal?: string): boolean {
    this.killed = signal ?? "SIGTERM";
    return true;
  }
}

function setup(handlers: Partial<JsonLineHandlers> = {}) {
  const child = new FakeChild();
  const proc = new JsonLineProcess(() => child, {
    onMessage: () => {},
    ...handlers,
  });
  return { child, proc };
}

describe("JsonLineProcess", () => {
  it("spawns via the injected spawner and sets utf8 on the output streams", () => {
    const { child } = setup();
    expect(child.stdout.encoding).toBe("utf8");
    expect(child.stderr.encoding).toBe("utf8");
  });

  it("encodes sent values as NDJSON lines to stdin", () => {
    const { child, proc } = setup();
    proc.send({ type: "prompt", message: "hi" });
    proc.send({ type: "abort" });
    expect(child.writes).toEqual(['{"type":"prompt","message":"hi"}\n', '{"type":"abort"}\n']);
  });

  it("emits one onMessage per complete line from stdout", () => {
    const messages: unknown[] = [];
    const { child } = setup({ onMessage: (m) => messages.push(m) });
    child.stdout.feed('{"type":"agent_start"}\n{"type":"turn_end"}\n');
    expect(messages).toEqual([{ type: "agent_start" }, { type: "turn_end" }]);
  });

  it("buffers a line split across stdout chunks", () => {
    const messages: unknown[] = [];
    const { child } = setup({ onMessage: (m) => messages.push(m) });
    child.stdout.feed('{"type":"mes');
    child.stdout.feed('sage_update"}\n');
    expect(messages).toEqual([{ type: "message_update" }]);
  });

  it("forwards stderr text to onStderr", () => {
    const errs: string[] = [];
    const { child } = setup({ onStderr: (s) => errs.push(s) });
    child.stderr.feed("pi: warning\n");
    expect(errs).toEqual(["pi: warning\n"]);
  });

  it("reports a malformed stdout line to onError without throwing", () => {
    const errs: string[] = [];
    const { child } = setup({ onError: (e) => errs.push(e.message) });
    expect(() => child.stdout.feed("not json\n")).not.toThrow();
    expect(errs).toHaveLength(1);
  });

  it("invokes onExit with the exit code", () => {
    let code: number | null = -1;
    const { child } = setup({ onExit: (c) => (code = c) });
    child.emit("exit", 0);
    expect(code).toBe(0);
  });

  it("routes a spawn-level error to onError", () => {
    const errs: string[] = [];
    const { child } = setup({ onError: (e) => errs.push(e.message) });
    child.emit("error", new Error("ENOENT"));
    expect(errs).toEqual(["ENOENT"]);
  });

  it("kill() terminates the child", () => {
    const { child, proc } = setup();
    proc.kill();
    expect(child.killed).toBe("SIGTERM");
  });
});
