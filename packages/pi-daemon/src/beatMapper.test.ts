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

describe("BeatMapper — render_ui (generative UI)", () => {
  it("emits a ui beat carrying the A2UI message instead of an act", () => {
    const message = { type: "card", title: "Summary", children: [] };
    const beats = run({ type: "tool_use", id: "u1", name: "render_ui", input: { message } });
    expect(beats).toEqual([{ kind: "ui", a2ui: message }]);
  });

  it("flushes buffered text before the ui beat", () => {
    const message = { type: "text", text: "hi" };
    const beats = run(
      { type: "text_delta", text: "here you go" },
      { type: "tool_use", id: "u1", name: "render_ui", input: { message } },
    );
    expect(beats).toEqual([
      { kind: "thinking", agent: "sage" },
      { kind: "say", agent: "sage", text: "here you go" },
      { kind: "ui", a2ui: message },
    ]);
  });

  it("does not open an action group for render_ui (a later page tool opens its own)", () => {
    const beats = run(
      { type: "tool_use", id: "u1", name: "render_ui", input: { message: { type: "text", text: "x" } } },
      { type: "tool_use", id: "t2", name: "click", input: { selector: "#go" } },
    );
    expect(beats.filter((b) => b.kind === "actGroup")).toHaveLength(1);
    expect(beats.filter((b) => b.kind === "ui")).toHaveLength(1);
    expect(beats.filter((b) => b.kind === "act")).toHaveLength(1);
  });

  it("still emits a ui beat when the message arg is missing", () => {
    const beats = run({ type: "tool_use", id: "u1", name: "render_ui", input: {} });
    expect(beats).toEqual([{ kind: "ui", a2ui: undefined }]);
  });

  it("closes the open action group: a page tool after render_ui opens a fresh group", () => {
    // The panel finalizes the running action group on a ui beat (like a say), so
    // the mapper must too — otherwise the next tool's act lands in a group the
    // panel already closed and is dropped.
    const beats = run(
      { type: "tool_use", id: "t1", name: "navigate", input: { url: "https://x.com" } },
      { type: "tool_use", id: "u1", name: "render_ui", input: { message: { type: "text", text: "x" } } },
      { type: "tool_use", id: "t2", name: "click", input: { selector: "#go" } },
    );
    expect(beats.filter((b) => b.kind === "actGroup")).toHaveLength(2);
    expect(beats.filter((b) => b.kind === "act")).toHaveLength(2);
  });
});

describe("BeatMapper — propose_save (proposal)", () => {
  it("maps a propose_save tool_use to a proposal beat carrying the draft", () => {
    const mapper = new BeatMapper();
    const proposal = { kind: "skill", name: "checkout", content: "# notes", host: "shop.example" };
    const beats = mapper.apply({ type: "tool_use", id: "p1", name: "browser_propose_save", input: proposal });
    expect(beats).toContainEqual({ kind: "proposal", proposal });
  });

  it("ignores a propose_save tool_use with a non-object input", () => {
    const mapper = new BeatMapper();
    // A malformed runtime payload (input typed Record<string,unknown>, but the
    // agent could send anything over the wire) — cast to exercise the guard.
    const beats = mapper.apply({
      type: "tool_use",
      id: "p1",
      name: "browser_propose_save",
      input: "nope" as unknown as Record<string, unknown>,
    });
    expect(beats.some((b) => b.kind === "proposal")).toBe(false);
  });
});

describe("BeatMapper — convenience tools (render_table/chart/list)", () => {
  it("emits a ui beat from the tool result for render_table", () => {
    const message = { type: "table", columns: ["A"], rows: [["1"]] };
    const beats = run(
      { type: "tool_use", id: "r1", name: "render_table", input: { columns: ["A"], rows: [["1"]] } },
      { type: "tool_result", id: "r1", output: JSON.stringify(message), isError: false },
    );
    expect(beats).toEqual([{ kind: "ui", a2ui: message }]);
  });

  it("recognizes render_chart and render_list too", () => {
    const chart = { type: "chart", chart: "bar", data: [], x: "m", series: ["a"] };
    const list = { type: "list", items: ["a"] };
    const chartBeats = run(
      { type: "tool_use", id: "c1", name: "render_chart", input: {} },
      { type: "tool_result", id: "c1", output: JSON.stringify(chart), isError: false },
    );
    const listBeats = run(
      { type: "tool_use", id: "l1", name: "render_list", input: {} },
      { type: "tool_result", id: "l1", output: JSON.stringify(list), isError: false },
    );
    expect(chartBeats).toEqual([{ kind: "ui", a2ui: chart }]);
    expect(listBeats).toEqual([{ kind: "ui", a2ui: list }]);
  });

  it("flushes buffered text before a convenience-tool ui beat", () => {
    const message = { type: "list", items: ["a"] };
    const beats = run(
      { type: "text_delta", text: "here:" },
      { type: "tool_use", id: "r1", name: "render_list", input: { items: ["a"] } },
      { type: "tool_result", id: "r1", output: JSON.stringify(message), isError: false },
    );
    expect(beats).toEqual([
      { kind: "thinking", agent: "sage" },
      { kind: "say", agent: "sage", text: "here:" },
      { kind: "ui", a2ui: message },
    ]);
  });

  it("closes the action group: a page tool after a convenience tool opens a fresh group", () => {
    const table = { type: "table", columns: ["A"], rows: [] };
    const beats = run(
      { type: "tool_use", id: "t1", name: "navigate", input: { url: "https://x.com" } },
      { type: "tool_use", id: "r1", name: "render_table", input: { columns: ["A"], rows: [] } },
      { type: "tool_result", id: "r1", output: JSON.stringify(table), isError: false },
      { type: "tool_use", id: "t2", name: "click", input: { selector: "#go" } },
    );
    expect(beats.filter((b) => b.kind === "actGroup")).toHaveLength(2);
    expect(beats.filter((b) => b.kind === "ui")).toHaveLength(1);
  });

  it("passes through an already-parsed (non-string) result object", () => {
    const message = { type: "text", text: "x" };
    const beats = run(
      { type: "tool_use", id: "r1", name: "render_table", input: {} },
      { type: "tool_result", id: "r1", output: message, isError: false },
    );
    expect(beats).toEqual([{ kind: "ui", a2ui: message }]);
  });

  it("emits no beat when a convenience tool's result is not valid JSON", () => {
    const beats = run(
      { type: "tool_use", id: "r1", name: "render_chart", input: {} },
      { type: "tool_result", id: "r1", output: "not json{", isError: false },
    );
    expect(beats.filter((b) => b.kind === "ui")).toHaveLength(0);
  });

  it("emits no beat when a convenience tool's result is null", () => {
    const beats = run(
      { type: "tool_use", id: "r1", name: "render_table", input: {} },
      { type: "tool_result", id: "r1", output: JSON.stringify(null), isError: false },
    );
    expect(beats.filter((b) => b.kind === "ui")).toHaveLength(0);
  });

  it("ignores a tool_result whose id is not a pending convenience call", () => {
    const mapper = new BeatMapper();
    mapper.apply({ type: "tool_use", id: "t", name: "navigate", input: {} });
    expect(mapper.apply({ type: "tool_result", id: "t", output: "{}", isError: false })).toEqual([]);
  });

  it("reset() forgets pending convenience-tool ids", () => {
    const mapper = new BeatMapper();
    mapper.apply({ type: "tool_use", id: "r1", name: "render_table", input: {} });
    mapper.reset();
    expect(mapper.apply({ type: "tool_result", id: "r1", output: "{}", isError: false })).toEqual([]);
  });

  it("emits no beat when a convenience tool's result is an error", () => {
    const errored = { type: "table", columns: [], rows: [] }; // valid A2UI, but isError
    const beats = run(
      { type: "tool_use", id: "r1", name: "render_table", input: {} },
      { type: "tool_result", id: "r1", output: JSON.stringify(errored), isError: true },
    );
    expect(beats.filter((b) => b.kind === "ui")).toHaveLength(0);
  });

  it("drops a pending convenience call when the turn ends before its result", () => {
    const mapper = new BeatMapper();
    mapper.apply({ type: "tool_use", id: "r1", name: "render_table", input: {} });
    mapper.apply({ type: "turn_end", reason: "cancelled" });
    // A late result for the cancelled call must not render stale UI after the run.
    expect(mapper.apply({ type: "tool_result", id: "r1", output: "{}", isError: false })).toEqual([]);
  });
});
