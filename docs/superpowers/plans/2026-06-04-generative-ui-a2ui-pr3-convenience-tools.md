# Generative UI (A2UI) — PR-3: convenience tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `render_table` / `render_chart` / `render_list` convenience tools so the agent can render common UI from simple args, with the daemon emitting the resulting `ui` beat by parsing the built A2UI out of the tool result.

**Architecture:** Two files. (1) The Pi `-e` script (`pi-extension/browser-bridge.ts`) gains three local tools that build a plain A2UI object from typed args and return it as `{ content:[{text: JSON.stringify(message)}], details: message }` (same shape `render_ui` uses). (2) The daemon's `beatMapper` recognizes the convenience-tool family: at `tool_use` it records the call id (no beat yet — the message isn't in the args); at `tool_result` it `JSON.parse`s the output and emits `{ kind: "ui", a2ui }`. The daemon stays A2UI-agnostic (it parses opaque JSON, never builds A2UI). `render_ui` keeps its PR-2 args path.

**Tech Stack:** Bun + TypeScript (daemon: strict + `noUncheckedIndexedAccess`, Vitest ≥90% gate). The `-e` script is a standalone artifact loaded by Pi (`pi --mode rpc -e …`); its imports (`@sinclair/typebox`, `@earendil-works/pi-coding-agent`) are provided by Pi at runtime and are absent from the daemon's `node_modules`, so it is **outside** the daemon's `tsconfig`/coverage and cannot be imported by daemon unit tests.

---

## Spec → task map & testing reality

- The **daemon `beatMapper`** change (Task 1) is in `src/`, carries the real logic/risk, and is **fully unit-tested**.
- The **`-e` tools** (Task 2) are part of the standalone, integration-only `browser-bridge.ts`. They cannot be unit-tested in the daemon suite (their Pi-runtime-only deps aren't installed; importing the file would break `tsc`). They are trivial object construction, verified structurally (mirroring the existing tool pattern + `render_ui`) and by the existing `pi -e` smoke. **Task 2 is therefore not TDD** — this is a deliberate, documented exception for standalone glue, consistent with the other ~40 untested tools in that file. Task 1's tests prove the daemon correctly turns these tools' results into `ui` beats.

---

### Task 1: `beatMapper` — recognize the convenience family + parse the result

**Files:**
- Modify: `packages/pi-daemon/src/beatMapper.ts`
- Test: `packages/pi-daemon/src/beatMapper.test.ts`

Run from `packages/pi-daemon/`. Single-file test: `bunx vitest run src/beatMapper.test.ts`. Commit trailer MUST be exactly:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

- [ ] **Step 1: Write the failing tests**

Append this `describe` block to the END of `packages/pi-daemon/src/beatMapper.test.ts` (the file already defines `run(...events)` and imports `BeatMapper`, `PanelBeat`, `AgentEvent` — reuse them):

```ts
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
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bunx vitest run src/beatMapper.test.ts`
Expected: FAIL. `render_table`/`render_chart`/`render_list` currently fall through to the page-action path (`actGroup`+`act`), and `tool_result` returns `[]`, so no `ui` beats are produced.

- [ ] **Step 3: Add the convenience-tool family constant**

In `packages/pi-daemon/src/beatMapper.ts`, find:

```ts
const RENDER_UI_TOOL = "render_ui";
```

Insert directly after it:

```ts
/**
 * The `-e` convenience tools whose built A2UI message arrives in the tool RESULT
 * (constructed from simple args), not the call args — see the PR-3 design. The
 * mapper records their call id at tool_use and parses the result into a ui beat.
 */
const RENDER_RESULT_TOOLS = new Set(["render_table", "render_chart", "render_list"]);

/** Parse a convenience tool's result into the opaque A2UI value, or undefined if unusable. */
function parseA2ui(output: unknown): unknown {
  if (typeof output !== "string") return output;
  try {
    return JSON.parse(output);
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4: Add the `pendingUi` field**

In `packages/pi-daemon/src/beatMapper.ts`, find the `BeatMapper` class fields:

```ts
export class BeatMapper {
  private text = "";
  private groupOpen = false;
```

Replace with:

```ts
export class BeatMapper {
  private text = "";
  private groupOpen = false;
  /** Ids of in-flight convenience-tool calls whose result becomes a ui beat. */
  private pendingUi = new Set<string>();
```

- [ ] **Step 5: Handle the family at `tool_use`**

In the `tool_use` case, find the `render_ui` branch and the page-action logic:

```ts
        if (event.name === RENDER_UI_TOOL) {
          // Generative UI, not a page action: emit a ui beat carrying the A2UI
          // message (from the call args — see the PR-2 plan's verification note)
          // instead of opening an action group. The panel finalizes the running
          // group on a ui beat (like a say), so clear groupOpen to stay in sync —
          // otherwise a later tool's act lands in a group the panel has closed.
          this.groupOpen = false;
          beats.push({ kind: "ui", a2ui: event.input.message });
          return beats;
        }
        if (!this.groupOpen) {
```

Insert a new branch between the `render_ui` branch and the `if (!this.groupOpen)` line:

```ts
        if (event.name === RENDER_UI_TOOL) {
          // Generative UI, not a page action: emit a ui beat carrying the A2UI
          // message (from the call args — see the PR-2 plan's verification note)
          // instead of opening an action group. The panel finalizes the running
          // group on a ui beat (like a say), so clear groupOpen to stay in sync —
          // otherwise a later tool's act lands in a group the panel has closed.
          this.groupOpen = false;
          beats.push({ kind: "ui", a2ui: event.input.message });
          return beats;
        }
        if (RENDER_RESULT_TOOLS.has(event.name)) {
          // Convenience tool: the built A2UI arrives in the result, not the args.
          // Record the id so tool_result can emit the ui beat. Like render_ui it's
          // panel output, not a page action — clear groupOpen (the forthcoming ui
          // beat finalizes the running group in the panel).
          this.groupOpen = false;
          this.pendingUi.add(event.id);
          return beats;
        }
        if (!this.groupOpen) {
```

- [ ] **Step 6: Emit the `ui` beat at `tool_result`**

In `packages/pi-daemon/src/beatMapper.ts`, find the `tool_result` case:

```ts
      case "tool_result":
        return [];
```

Replace with:

```ts
      case "tool_result": {
        if (!this.pendingUi.has(event.id)) return [];
        this.pendingUi.delete(event.id);
        const a2ui = parseA2ui(event.output);
        return a2ui === undefined ? [] : [{ kind: "ui", a2ui }];
      }
```

- [ ] **Step 7: Clear `pendingUi` in `reset()`**

Find the `reset` method:

```ts
  reset(): void {
    this.text = "";
    this.groupOpen = false;
  }
```

Replace with:

```ts
  reset(): void {
    this.text = "";
    this.groupOpen = false;
    this.pendingUi.clear();
  }
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `bunx vitest run src/beatMapper.test.ts`
Expected: PASS (all existing tests plus the 8 new convenience-tool tests).

- [ ] **Step 9: Full suite + typecheck + lint**

Run: `bun run test && bun run typecheck && bun run lint`
Expected: PASS. The new branches are covered by Step 1's tests, so the ≥90% gate holds.

- [ ] **Step 10: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/pi-daemon/src/beatMapper.ts packages/pi-daemon/src/beatMapper.test.ts
git commit -F - <<'MSG'
feat(daemon): map render_table/chart/list results to ui beats (A2UI PR-3)

The beatMapper recognizes the convenience-tool family: at tool_use it records the
call id (the built A2UI isn't in the args), and at tool_result it JSON-parses the
output into a {kind:"ui", a2ui} beat. The daemon stays A2UI-agnostic (parses
opaque JSON, never builds A2UI). render_ui keeps its args path; reset() clears the
pending ids.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 2: `-e` convenience tools (`render_table` / `render_chart` / `render_list`)

**Files:**
- Modify: `packages/pi-daemon/pi-extension/browser-bridge.ts`

**Not TDD** (standalone `-e` glue — see "testing reality" above). Verification is structural: the tools mirror the existing `render_ui` registration and the builders produce the A2UI shapes the panel renders (PR-1) and the daemon parses (Task 1). Do NOT add a daemon unit test importing this file — it would pull Pi-runtime-only modules into `tsc`/Vitest.

- [ ] **Step 1: Add the builder functions**

In `packages/pi-daemon/pi-extension/browser-bridge.ts`, find the export-default line:

```ts
export default function (pi: ExtensionAPI): void {
```

Insert these pure builders directly ABOVE it (module scope):

```ts
/** A2UI message object built by the convenience tools (plain JSON for the panel). */
type A2uiMessage = Record<string, unknown>;

/** Build an A2UI table; `title` maps to the table's `caption` slot. */
function buildTable(args: { title?: string; columns: unknown; rows: unknown }): A2uiMessage {
  const table: A2uiMessage = { type: "table", columns: args.columns, rows: args.rows };
  if (args.title) table.caption = args.title;
  return table;
}

/** Build an A2UI chart node (the `chart` arg is the kind: bar/line/area/pie). */
function buildChart(args: {
  chart: unknown;
  title?: string;
  data: unknown;
  x: unknown;
  series: unknown;
}): A2uiMessage {
  const chart: A2uiMessage = { type: "chart", chart: args.chart, data: args.data, x: args.x, series: args.series };
  if (args.title) chart.title = args.title;
  return chart;
}

/** Build an A2UI list; a `title`, if given, wraps the list in a titled card. */
function buildList(args: { title?: string; ordered?: boolean; items: unknown }): A2uiMessage {
  const list: A2uiMessage = { type: "list", items: args.items };
  if (args.ordered) list.ordered = true;
  return args.title ? { type: "card", title: args.title, children: [list] } : list;
}
```

- [ ] **Step 2: Register the three tools**

In the same file, find the end of the `render_ui` tool registration (the closing of its `pi.registerTool({...})` call):

```ts
    execute: async (_id, params) => {
      const message = (params as { message: unknown }).message;
      return { content: [{ type: "text" as const, text: JSON.stringify(message) }], details: message };
    },
  });
}
```

Replace with (insert the three new registrations before the final `}` that closes `export default function`):

```ts
    execute: async (_id, params) => {
      const message = (params as { message: unknown }).message;
      return { content: [{ type: "text" as const, text: JSON.stringify(message) }], details: message };
    },
  });

  pi.registerTool({
    name: "render_table",
    label: "Render table",
    description:
      "Render a table in the Fairy panel. Pass {title?, columns, rows}: columns are header " +
      "strings; rows are arrays of cell values (string|number), one array per row.",
    parameters: Type.Object({
      title: Type.Optional(Type.String()),
      columns: Type.Array(Type.String()),
      rows: Type.Array(Type.Array(Type.Union([Type.String(), Type.Number()]))),
    }),
    execute: async (_id, params) => {
      const message = buildTable(params as { title?: string; columns: string[]; rows: (string | number)[][] });
      return { content: [{ type: "text" as const, text: JSON.stringify(message) }], details: message };
    },
  });

  pi.registerTool({
    name: "render_chart",
    label: "Render chart",
    description:
      "Render a chart in the Fairy panel. Pass {chart, title?, data, x, series}: chart is the " +
      "kind (bar|line|area|pie); data is an array of row objects; x is the category key; series " +
      "are the value keys to plot.",
    parameters: Type.Object({
      chart: Type.Union([Type.Literal("bar"), Type.Literal("line"), Type.Literal("area"), Type.Literal("pie")]),
      title: Type.Optional(Type.String()),
      data: Type.Array(Type.Record(Type.String(), Type.Union([Type.String(), Type.Number()]))),
      x: Type.String(),
      series: Type.Array(Type.String()),
    }),
    execute: async (_id, params) => {
      const message = buildChart(
        params as { chart: string; title?: string; data: unknown; x: string; series: string[] },
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(message) }], details: message };
    },
  });

  pi.registerTool({
    name: "render_list",
    label: "Render list",
    description:
      "Render a list in the Fairy panel. Pass {title?, ordered?, items}: items are strings; set " +
      "ordered for a numbered list; a title wraps the list in a titled card.",
    parameters: Type.Object({
      title: Type.Optional(Type.String()),
      ordered: Type.Optional(Type.Boolean()),
      items: Type.Array(Type.String()),
    }),
    execute: async (_id, params) => {
      const message = buildList(params as { title?: string; ordered?: boolean; items: string[] });
      return { content: [{ type: "text" as const, text: JSON.stringify(message) }], details: message };
    },
  });
}
```

- [ ] **Step 3: Structural self-check**

Re-read the diff and confirm:
- Each new tool mirrors `render_ui`'s shape: `name`/`label`/`description`/`parameters: Type.Object({...})`/`execute` returning `{ content:[{type:"text", text: JSON.stringify(message)}], details: message }`.
- The names are exactly `render_table` / `render_chart` / `render_list` — matching `RENDER_RESULT_TOOLS` in Task 1.
- The builders produce the A2UI shapes from the spec: table `{type:"table", caption?, columns, rows}`, chart `{type:"chart", chart, title?, data, x, series}`, list `{type:"list", ordered?, items}` (card-wrapped when titled).
- No new `import` was added (self-containment preserved — only `Type` from the existing typebox import is used).

(There is no daemon unit test for this file. The daemon side that consumes these tools' results is covered by Task 1; the end-to-end render is exercised by the existing `pi -e` smoke when a real `pi` is present.)

- [ ] **Step 4: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/pi-daemon/pi-extension/browser-bridge.ts
git commit -F - <<'MSG'
feat(pi-extension): render_table/render_chart/render_list convenience tools

Three local A2UI tools mirroring render_ui: each builds a plain A2UI message from
simple args (title→caption for tables, native title for charts, card-wrap for
titled lists) and returns it JSON-stringified. The daemon's beatMapper (PR-3)
parses the result into a ui beat. Builders are inline/self-contained — the -e
script must not gain non-Pi-runtime imports.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

## Manual end-to-end check (optional, needs a real `pi`)

Run the daemon, pair the extension, and prompt the agent: "show last quarter's revenue as a bar chart" / "list the steps as a numbered list" / "compare these options in a table". The panel should render the chart/list/table inline. Not required to land PR-3 (Task 1's unit tests cover the daemon path; the builders are trivial).

---

## Self-Review

**1. Spec coverage.**
- Three convenience tools with the spec's schemas + `title` mappings (table→`caption`, chart→native `title`, list→`card`-wrap) → Task 2 (`buildTable`/`buildChart`/`buildList` + registrations).
- Arg named `chart` for the kind → Task 2 `render_chart` schema/builder.
- beatMapper family recognition + result-parse, `render_ui` unchanged, `pendingUi`, `reset()` clears it, parse-failure → no beat, daemon stays agnostic → Task 1.
- Data flow / error handling (schema-validated args; unparseable result → no beat) → Task 1 (parse) + Task 2 (TypeBox schemas).
- Testing approach (beatMapper unit-tested; builders standalone) → Task 1 tests + the documented Task 2 exception.
  No spec requirement is left without a task.

**2. Placeholder scan.** No "TBD"/"TODO"/"handle edge cases"/"similar to Task N". Every code step shows complete before/after; the test step shows full test code; commands show expected outcomes. Task 2's non-TDD nature is explicitly justified, not a hand-wave. ✓

**3. Type consistency.** `RENDER_RESULT_TOOLS` (Task 1) holds exactly `render_table`/`render_chart`/`render_list`, matching the tool `name`s registered in Task 2. `parseA2ui(output: unknown): unknown` and `pendingUi: Set<string>` are defined in Task 1 and used consistently (`pendingUi.has/add/delete/clear`, `event.id: string`). The emitted beat `{ kind: "ui"; a2ui }` matches the `PanelBeat` `ui` member already in the union (from PR-2). The builders return `A2uiMessage` (`Record<string, unknown>`) and are stringified identically to `render_ui`. ✓
