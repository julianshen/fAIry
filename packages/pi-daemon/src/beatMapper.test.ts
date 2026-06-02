import { BeatMapper } from "./beatMapper";
import type { PanelBeat } from "./beatMapper";
import type { AgentEvent } from "./piSession";

function run(...events: AgentEvent[]): PanelBeat[] {
  const mapper = new BeatMapper();
  return events.flatMap((e) => mapper.apply(e));
}

describe("BeatMapper — text", () => {
  it("emits a thinking beat on the first delta only, then buffers", () => {
    const mapper = new BeatMapper();
    expect(mapper.apply({ type: "text_delta", text: "Hel" })).toEqual([{ kind: "thinking", agent: "sage" }]);
    expect(mapper.apply({ type: "text_delta", text: "lo" })).toEqual([]);
  });

  it("flushes the buffered text as a say at the next boundary", () => {
    const beats = run(
      { type: "text_delta", text: "On " },
      { type: "text_delta", text: "it." },
      { type: "turn_end", reason: "stop" },
    );
    expect(beats).toContainEqual({ kind: "say", agent: "sage", text: "On it." });
  });
});

describe("BeatMapper — tools", () => {
  it("flushes text, opens one action group, and adds a row on tool_use", () => {
    const beats = run(
      { type: "text_delta", text: "navigating" },
      { type: "tool_use", id: "t1", name: "navigate", input: { url: "https://x.com" } },
    );
    expect(beats).toEqual([
      { kind: "thinking", agent: "sage" },
      { kind: "say", agent: "sage", text: "navigating" },
      { kind: "actGroup", agent: "sage", title: expect.any(String) },
      { kind: "act", agent: "sage", verb: expect.any(String), target: "https://x.com" },
    ]);
  });

  it("does not open a second action group for a second tool in the same turn", () => {
    const beats = run(
      { type: "tool_use", id: "t1", name: "navigate", input: { url: "https://x.com" } },
      { type: "tool_use", id: "t2", name: "click", input: { selector: "#go" } },
    );
    expect(beats.filter((b) => b.kind === "actGroup")).toHaveLength(1);
    expect(beats.filter((b) => b.kind === "act")).toHaveLength(2);
  });

  it("reopens an action group when a tool follows text in the same turn", () => {
    const beats = run(
      { type: "tool_use", id: "t1", name: "navigate", input: { url: "https://x.com" } },
      { type: "text_delta", text: "looking at the results" },
      { type: "tool_use", id: "t2", name: "click", input: { selector: "#go" } },
    );
    // The intervening text finalizes the panel's group, so the 2nd tool needs a fresh one.
    expect(beats.filter((b) => b.kind === "actGroup")).toHaveLength(2);
  });

  it("returns an empty target when the primary arg is explicitly null", () => {
    const [, act] = run({ type: "tool_use", id: "t", name: "x", input: { query: null } });
    expect(act).toMatchObject({ kind: "act", target: "" });
  });

  it("derives the row target from a primary argument", () => {
    const [, act] = run({ type: "tool_use", id: "t", name: "click", input: { selector: "#go" } });
    expect(act).toMatchObject({ kind: "act", target: "#go" });
  });

  it("falls back to the tool name and an empty target for unmapped tools/args", () => {
    const [, act] = run({ type: "tool_use", id: "t", name: "cdp", input: { method: "Page.enable" } });
    expect(act).toMatchObject({ kind: "act", verb: "cdp", target: "" });
  });

  it("produces no beat for a tool_result", () => {
    const mapper = new BeatMapper();
    mapper.apply({ type: "tool_use", id: "t", name: "navigate", input: {} });
    expect(mapper.apply({ type: "tool_result", id: "t", output: "ok", isError: false })).toEqual([]);
  });
});

describe("BeatMapper — turn end & errors", () => {
  it("maps turn_end stop -> status done (after flushing text)", () => {
    expect(run({ type: "turn_end", reason: "stop" })).toEqual([{ kind: "status", run: "done" }]);
  });

  it("maps turn_end cancelled -> status paused", () => {
    expect(run({ type: "turn_end", reason: "cancelled" })).toEqual([{ kind: "status", run: "paused" }]);
  });

  it("maps turn_end error -> status done", () => {
    expect(run({ type: "turn_end", reason: "error" })).toEqual([{ kind: "status", run: "done" }]);
  });

  it("surfaces an error as a say, flushing any partial text first", () => {
    const beats = run({ type: "text_delta", text: "partial" }, { type: "error", message: "boom" });
    expect(beats).toContainEqual({ kind: "say", agent: "sage", text: "partial" });
    expect(beats).toContainEqual({ kind: "say", agent: "sage", text: "⚠️ boom" });
  });
});

describe("BeatMapper — reset", () => {
  it("clears buffered text and the open-group flag", () => {
    const mapper = new BeatMapper();
    mapper.apply({ type: "text_delta", text: "x" });
    mapper.apply({ type: "tool_use", id: "t", name: "navigate", input: {} });
    mapper.reset();
    // After reset, a new tool_use opens a fresh group and no stale text flushes.
    const beats = mapper.apply({ type: "tool_use", id: "t2", name: "click", input: {} });
    expect(beats.filter((b) => b.kind === "actGroup")).toHaveLength(1);
    expect(beats.filter((b) => b.kind === "say")).toHaveLength(0);
  });
});
