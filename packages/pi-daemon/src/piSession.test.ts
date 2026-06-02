import { EventEmitter } from "node:events";
import { encodeLine } from "./ndjson";
import { PiSession } from "./piSession";
import type { AgentEvent } from "./piSession";
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

/** Build a session over a fake child; returns the child, the session, and the
 *  list of emitted events plus a helper to push a Pi wire message. */
function setup() {
  const child = new FakeChild();
  const events: AgentEvent[] = [];
  const session = new PiSession(() => child, { onEvent: (e) => events.push(e) });
  const sent = (): unknown[] => child.writes.map((w) => JSON.parse(w));
  const feed = (msg: object): void => child.stdout.feed(encodeLine(msg));
  return { child, session, events, sent, feed };
}

describe("PiSession — sending", () => {
  it("starts a turn with a plain prompt when idle and marks itself running", () => {
    const { session, sent } = setup();
    session.startTurn("book a flight");
    expect(sent()).toEqual([{ type: "prompt", message: "book a flight" }]);
    expect(session.isRunning).toBe(true);
  });

  it("steers an overlapping prompt while a turn is running", () => {
    const { session, sent } = setup();
    session.startTurn("first");
    session.startTurn("second");
    expect(sent()[1]).toEqual({ type: "prompt", message: "second", streamingBehavior: "steer" });
  });

  it("abort() sends abort, ends the turn as cancelled, and clears running", () => {
    const { session, sent, events } = setup();
    session.startTurn("go");
    session.abort();
    expect(sent()).toContainEqual({ type: "abort" });
    expect(events).toContainEqual({ type: "turn_end", reason: "cancelled" });
    expect(session.isRunning).toBe(false);
  });

  it("compact() sends a compact command", () => {
    const { session, sent } = setup();
    session.compact();
    expect(sent()).toContainEqual({ type: "compact" });
  });
});

describe("PiSession — translating Pi events", () => {
  it("emits text deltas from message_update", () => {
    const { session, events, feed } = setup();
    session.startTurn("go");
    feed({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Hel" } });
    feed({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "lo" } });
    expect(events).toContainEqual({ type: "text_delta", text: "Hel" });
    expect(events).toContainEqual({ type: "text_delta", text: "lo" });
  });

  it("emits tool_use on tool_execution_start", () => {
    const { session, events, feed } = setup();
    session.startTurn("go");
    feed({ type: "tool_execution_start", toolCallId: "t1", toolName: "click", args: { x: 5 } });
    expect(events).toContainEqual({ type: "tool_use", id: "t1", name: "click", input: { x: 5 } });
  });

  it("emits a text tool_result on tool_execution_end", () => {
    const { session, events, feed } = setup();
    session.startTurn("go");
    feed({
      type: "tool_execution_end",
      toolCallId: "t1",
      result: { content: [{ type: "text", text: "ok" }] },
      isError: false,
    });
    expect(events).toContainEqual({ type: "tool_result", id: "t1", output: "ok", isError: false });
  });

  it("normalizes an image tool_result", () => {
    const { session, events, feed } = setup();
    session.startTurn("go");
    feed({
      type: "tool_execution_end",
      toolCallId: "t2",
      result: { content: [{ type: "image", data: "BASE64" }], details: { width: 800, height: 600 } },
      isError: false,
    });
    expect(events).toContainEqual({
      type: "tool_result",
      id: "t2",
      output: { format: "png", base64: "BASE64", width: 800, height: 600 },
      isError: false,
    });
  });

  it("ends the turn on agent_end (stop), and clears running", () => {
    const { session, events, feed } = setup();
    session.startTurn("go");
    feed({ type: "agent_end", messages: [] });
    expect(events).toContainEqual({ type: "turn_end", reason: "stop" });
    expect(session.isRunning).toBe(false);
  });

  it("does not emit a renderer turn_end on an intermediate turn_end", () => {
    const { session, events, feed } = setup();
    session.startTurn("go");
    feed({ type: "turn_end", message: {} });
    expect(events.filter((e) => e.type === "turn_end")).toHaveLength(0);
    expect(session.isRunning).toBe(true);
  });

  it("surfaces an upstream LLM error from message_update and ends the turn", () => {
    const { session, events, feed } = setup();
    session.startTurn("go");
    feed({
      type: "message_update",
      assistantMessageEvent: { type: "error", reason: "rate_limit", errorMessage: "429" },
    });
    expect(events).toContainEqual({ type: "error", message: "Agent error (rate_limit): 429" });
    expect(events).toContainEqual({ type: "turn_end", reason: "error" });
    expect(session.isRunning).toBe(false);
  });

  it("surfaces a failed auto-retry", () => {
    const { session, events, feed } = setup();
    session.startTurn("go");
    feed({ type: "auto_retry_end", aborted: true, finalError: "503" });
    expect(events).toContainEqual({ type: "error", message: "Agent retry failed: 503" });
    expect(events).toContainEqual({ type: "turn_end", reason: "error" });
  });

  it("auto-cancels blocking extension UI requests", () => {
    const { session, sent, feed } = setup();
    session.startTurn("go");
    feed({ type: "extension_ui_request", method: "confirm", id: "ui1" });
    expect(sent()).toContainEqual({ type: "extension_ui_response", id: "ui1", cancelled: true });
  });
});

describe("PiSession — desync recovery", () => {
  it("re-sends the last prompt with steer once when Pi reports 'already processing'", () => {
    const { session, sent, feed } = setup();
    session.startTurn("do it");
    // Pi rejected the plain prompt because it was still processing.
    feed({ type: "response", command: "prompt", success: false, error: "Agent is already processing" });
    const writes = sent();
    expect(writes[writes.length - 1]).toEqual({
      type: "prompt",
      message: "do it",
      streamingBehavior: "steer",
    });
    expect(session.isRunning).toBe(true);
  });

  it("does not loop the steer-retry on a persistent rejection", () => {
    const { session, sent, feed } = setup();
    session.startTurn("do it");
    feed({ type: "response", command: "prompt", success: false, error: "Agent is already processing" });
    feed({ type: "response", command: "prompt", success: false, error: "Agent is already processing" });
    const steers = sent().filter(
      (w) => (w as { streamingBehavior?: string }).streamingBehavior === "steer",
    );
    expect(steers).toHaveLength(1);
  });
});

describe("PiSession — edge cases", () => {
  it("compact() forwards custom instructions when given", () => {
    const { session, sent } = setup();
    session.compact("keep the booking details");
    expect(sent()).toContainEqual({ type: "compact", customInstructions: "keep the booking details" });
  });

  it("setAutoCompaction() toggles Pi's auto-compaction", () => {
    const { session, sent } = setup();
    session.setAutoCompaction(true);
    expect(sent()).toContainEqual({ type: "set_auto_compaction", enabled: true });
  });

  it("abort() is a no-op when no turn is running", () => {
    const { session, sent, events } = setup();
    session.abort();
    expect(sent()).toEqual([]);
    expect(events).toEqual([]);
  });

  it("defaults missing tool fields on tool_execution_start", () => {
    const { session, events, feed } = setup();
    session.startTurn("go");
    feed({ type: "tool_execution_start" });
    expect(events).toContainEqual({ type: "tool_use", id: "", name: "", input: {} });
  });

  it("falls back to the raw result when a tool produces no text/image", () => {
    const { session, events, feed } = setup();
    session.startTurn("go");
    feed({ type: "tool_execution_end", result: { details: "x" }, isError: true });
    expect(events).toContainEqual({ type: "tool_result", id: "", output: { details: "x" }, isError: true });
  });

  it("surfaces a non-recoverable command failure and ends the turn", () => {
    const { session, events, feed } = setup();
    session.startTurn("go");
    feed({ type: "response", command: "prompt", success: false, error: "boom" });
    expect(events).toContainEqual({ type: "error", message: "Pi command failed: boom" });
    expect(events).toContainEqual({ type: "turn_end", reason: "error" });
    expect(session.isRunning).toBe(false);
  });

  it("reports a failed non-turn command without ending the turn", () => {
    const { session, events, feed } = setup();
    session.startTurn("go");
    feed({ type: "response", command: "compact", success: false, error: "nope" });
    expect(events).toContainEqual({ type: "error", message: "Pi command failed: nope" });
    expect(events.filter((e) => e.type === "turn_end")).toHaveLength(0);
    expect(session.isRunning).toBe(true);
  });

  it("ignores successful responses", () => {
    const { session, events, feed } = setup();
    session.startTurn("go");
    feed({ type: "response", command: "get_state", success: true });
    expect(events).toEqual([]);
  });

  it("ignores non-blocking extension UI requests", () => {
    const { session, sent, feed } = setup();
    session.startTurn("go");
    const before = sent().length;
    feed({ type: "extension_ui_request", method: "notify", id: "n1" });
    expect(sent()).toHaveLength(before);
  });

  it("does not crash on a null or non-object stdout line", () => {
    const { session, events, child } = setup();
    session.startTurn("go");
    expect(() => child.stdout.feed("null\n")).not.toThrow();
    expect(() => child.stdout.feed("42\n")).not.toThrow();
    expect(events).toEqual([]);
  });

  it("tolerates a non-array tool result content", () => {
    const { session, events, feed } = setup();
    session.startTurn("go");
    feed({ type: "tool_execution_end", toolCallId: "t1", result: { content: "oops" }, isError: false });
    expect(events).toContainEqual({
      type: "tool_result",
      id: "t1",
      output: { content: "oops" },
      isError: false,
    });
  });

  it("leaves running false if the prompt send fails", () => {
    const { session, child } = setup();
    (child as { stdin: unknown }).stdin = null;
    expect(() => session.startTurn("go")).toThrow();
    expect(session.isRunning).toBe(false);
  });

  it("ends the turn on a success:false auto_retry_end", () => {
    const { session, events, feed } = setup();
    session.startTurn("go");
    feed({ type: "auto_retry_end", success: false, finalError: "503" });
    expect(events).toContainEqual({ type: "error", message: "Agent retry failed: 503" });
    expect(events).toContainEqual({ type: "turn_end", reason: "error" });
  });

  it("ignores unrecognized and non-text/error message updates", () => {
    const { session, events, feed } = setup();
    session.startTurn("go");
    feed({ type: "agent_start" });
    feed({ type: "message_update", assistantMessageEvent: { type: "thinking" } });
    feed({ type: "auto_retry_end", aborted: false });
    expect(events).toEqual([]);
  });
});

describe("PiSession — process lifecycle", () => {
  it("forwards stderr as an error event", () => {
    const { session, events, child } = setup();
    session.startTurn("go");
    child.stderr.feed("pi: boom\n");
    expect(events).toContainEqual({ type: "error", message: "[pi stderr] pi: boom" });
  });

  it("reports an unexpected exit during a turn", () => {
    const { session, events, child } = setup();
    session.startTurn("go");
    child.emit("close", 1);
    expect(events).toContainEqual({ type: "error", message: "Pi exited (code 1)" });
    expect(events).toContainEqual({ type: "turn_end", reason: "cancelled" });
    expect(session.isRunning).toBe(false);
  });

  it("dispose() kills the child", () => {
    const { session, child } = setup();
    session.dispose();
    expect(child.killed).toBe(true);
  });
});
