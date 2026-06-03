import { EventEmitter } from "node:events";
import { encodeLine } from "./ndjson";
import { ConversationController } from "./conversation";
import type { PanelBeat } from "./beatMapper";
import type { ChildLike, ReadableLine } from "./jsonLineProcess";

class FakeStream extends EventEmitter implements ReadableLine {
  setEncoding(): void {}
  feed(chunk: string): void {
    this.emit("data", chunk);
  }
}
class FakeChild extends EventEmitter implements ChildLike {
  writes: string[] = [];
  stdout = new FakeStream();
  stderr = new FakeStream();
  killed = false;
  stdin = { write: (c: string): void => void this.writes.push(c) };
  kill(): boolean {
    this.killed = true;
    return true;
  }
}

function setup() {
  const child = new FakeChild();
  const beats: PanelBeat[] = [];
  const controller = new ConversationController({ spawn: () => child, onBeat: (b) => beats.push(b) });
  const feed = (msg: object): void => child.stdout.feed(encodeLine(msg));
  const sent = (): unknown[] => child.writes.map((w) => JSON.parse(w));
  return { child, beats, controller, feed, sent };
}

describe("ConversationController", () => {
  it("start() emits user + running and prompts Pi", () => {
    const { controller, beats, sent } = setup();
    controller.start("book a flight");
    expect(beats).toEqual([
      { kind: "user", text: "book a flight" },
      { kind: "status", run: "running" },
    ]);
    expect(sent()).toContainEqual({ type: "prompt", message: "book a flight" });
    expect(controller.isRunning).toBe(true);
  });

  it("pipes Pi events through the mapper to beats", () => {
    const { controller, beats, feed } = setup();
    controller.start("go");
    beats.length = 0; // ignore the start beats
    feed({ type: "text_delta", assistantMessageEvent: { type: "text_delta", delta: "On it" } });
    feed({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "On it" } });
    feed({ type: "tool_execution_start", toolCallId: "t1", toolName: "navigate", args: { url: "https://x.com" } });
    feed({ type: "agent_end", messages: [] });
    expect(beats).toContainEqual({ kind: "thinking", agent: "sage" });
    expect(beats).toContainEqual({ kind: "say", agent: "sage", text: "On it" });
    expect(beats).toContainEqual({ kind: "act", agent: "sage", verb: "Navigated to", target: "https://x.com" });
    expect(beats).toContainEqual({ kind: "status", run: "done" });
  });

  it("stop() aborts the turn and emits status paused", () => {
    const { controller, beats, sent } = setup();
    controller.start("go");
    beats.length = 0;
    controller.stop();
    expect(sent()).toContainEqual({ type: "abort" });
    expect(beats).toContainEqual({ kind: "status", run: "paused" });
    expect(controller.isRunning).toBe(false);
  });

  it("compact() asks Pi to compact, with optional custom instructions", () => {
    const { controller, sent } = setup();
    controller.compact("keep the plan");
    expect(sent()).toContainEqual({ type: "compact", customInstructions: "keep the plan" });
    controller.compact();
    expect(sent()).toContainEqual({ type: "compact" });
  });

  it("resets mapper state between tasks", () => {
    const { controller, beats, feed } = setup();
    controller.start("first");
    feed({ type: "tool_execution_start", toolCallId: "t1", toolName: "click", args: {} });
    controller.start("second");
    beats.length = 0;
    // A tool in the new task should open a fresh group (no stale groupOpen).
    feed({ type: "tool_execution_start", toolCallId: "t2", toolName: "click", args: {} });
    expect(beats.filter((b) => b.kind === "actGroup")).toHaveLength(1);
  });

  it("aborts a running turn before starting a new one (flushing partial text)", () => {
    const { controller, beats, sent, feed } = setup();
    controller.start("first");
    feed({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "partial" } });
    beats.length = 0;
    controller.start("second");
    expect(sent()).toContainEqual({ type: "abort" });
    expect(sent()).toContainEqual({ type: "prompt", message: "second" });
    expect(beats).toContainEqual({ kind: "say", agent: "sage", text: "partial" });
    expect(beats).toContainEqual({ kind: "user", text: "second" });
  });

  it("ignores trailing events after dispose()", () => {
    const { controller, beats, child } = setup();
    controller.start("go");
    beats.length = 0;
    controller.dispose();
    child.emit("close", 1); // async exit after kill
    expect(beats).toEqual([]);
  });

  it("dispose() kills the Pi subprocess", () => {
    const { controller, child } = setup();
    controller.dispose();
    expect(child.killed).toBe(true);
  });
});
