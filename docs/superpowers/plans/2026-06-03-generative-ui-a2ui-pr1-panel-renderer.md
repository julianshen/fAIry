# Generative UI (A2UI) — PR-1: Panel Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `@fairy/agent-panel` the ability to render A2UI messages (text, card, group, list, table, chart) into the conversation feed via a new `ui` beat, so once any producer emits such a beat the panel draws it.

**Architecture:** A new self-contained `src/a2ui/` module owns the A2UI node types and a pure `A2UIView` renderer that switches on node type; charts delegate to a recharts-backed `A2UIChart`. The existing `Beat`/`FeedItem` unions gain a `ui` variant, the `reduce` engine folds it into the feed (mirroring the existing `result` beat), and `Feed`/`FeedItems` route it to `A2UIView`. The daemon and transport are untouched — this PR is panel-only and is testable standalone by feeding hand-written A2UI messages.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), React 18, Vitest + Testing Library (jsdom), v8 coverage (≥90% gate), recharts for charts.

**Scope note:** This is PR-1 of the 3-PR sequence in `docs/superpowers/specs/2026-06-03-generative-ui-a2ui-design.md`. PR-2 (daemon `beatMapper` → `ui` beat) and PR-3 (`-e` convenience tools) are deferred to their own plans, written after this merges and the spec's flagged integration point (does Pi's `AgentEvent` stream surface tool *results* richly?) is verified. Work continues on the existing `feat/generative-ui-a2ui` branch, where the spec doc is already committed.

**Conventions to follow (observed in this package):**
- Render functions are `export function X(props): ReactElement`.
- Tests use Vitest globals (`describe`/`it`/`expect`), `import { render, screen } from "@testing-library/react"`.
- `noUncheckedIndexedAccess` is on: indexed access yields `T | undefined`; handle it (the existing code uses non-null `!` in tests and narrows in source).
- Run all commands from `packages/agent-panel/` unless stated. The test runner is `bun run test` (Vitest); a single file is `bunx vitest run <path>`.

---

## Task 1: A2UI types + recharts dependency

**Files:**
- Create: `packages/agent-panel/src/a2ui/types.ts`
- Modify: `packages/agent-panel/package.json` (add `recharts`)
- Modify: `packages/agent-panel/vite.config.ts` (exclude the type-only module from coverage)

- [ ] **Step 1: Add the recharts dependency**

Run (from `packages/agent-panel/`):

```bash
bun add recharts@^2.15.0
```

Expected: `package.json` gains `"recharts": "^2.15.0"` under `dependencies`; the workspace lockfile updates; install succeeds.

- [ ] **Step 2: Create the A2UI type module**

Create `packages/agent-panel/src/a2ui/types.ts`:

```ts
/**
 * A pragmatic NESTED-TREE subset of A2UI v0.8's component types — the shapes the
 * panel renders. A message is a single root node; container nodes nest children.
 * Unknown `type` values are tolerated at render time (forward-compatible), so the
 * feed degrades gracefully rather than crashing on future/full-spec messages.
 */
export type A2UITextVariant = "body" | "heading" | "caption";

/** Chart kinds the panel can draw (a fAIry extension over A2UI core). */
export type A2UIChartKind = "bar" | "line" | "area" | "pie";

export type A2UINode =
  | { type: "text"; text: string; variant?: A2UITextVariant }
  | { type: "card"; title?: string; children: A2UINode[] }
  | { type: "group"; children: A2UINode[] }
  | { type: "list"; ordered?: boolean; items: Array<string | A2UINode> }
  | { type: "table"; caption?: string; columns: string[]; rows: Array<Array<string | number>> }
  | {
      type: "chart";
      chart: A2UIChartKind;
      title?: string;
      data: Array<Record<string, string | number>>;
      x: string;
      series: string[];
    };

/** A single A2UI message is one root node (which may nest children). */
export type A2UIMessage = A2UINode;
```

- [ ] **Step 3: Exclude the type-only module from coverage**

In `packages/agent-panel/vite.config.ts`, the `coverage.exclude` array already ends with `src/types.ts` (commented "Type-only module — no runtime statements to cover"). Add the new type-only module right after it.

Find:

```ts
        // Type-only module — no runtime statements to cover.
        "src/types.ts",
      ],
```

Replace with:

```ts
        // Type-only modules — no runtime statements to cover.
        "src/types.ts",
        "src/a2ui/types.ts",
      ],
```

- [ ] **Step 4: Verify it typechecks**

Run: `bun run typecheck`
Expected: PASS (no errors). `recharts` resolves and the new module compiles.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-panel/src/a2ui/types.ts packages/agent-panel/package.json packages/agent-panel/vite.config.ts ../../bun.lock ../../bun.lockb 2>/dev/null; git add -A packages/agent-panel
git commit -m "feat(panel): add A2UI node types and recharts dependency

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

(The `git add` of the lockfile uses whichever of `bun.lock`/`bun.lockb` exists at the repo root; the trailing `git add -A packages/agent-panel` ensures the new module is staged.)

---

## Task 2: `A2UIChart` (recharts-backed chart widget)

**Files:**
- Create: `packages/agent-panel/src/a2ui/A2UIChart.tsx`
- Test: `packages/agent-panel/src/a2ui/A2UIChart.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/agent-panel/src/a2ui/A2UIChart.test.tsx`. It mocks `recharts` so we assert the data/props we hand it (not pixels — recharts cannot measure size in jsdom):

```tsx
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("recharts", () => {
  type StubProps = { children?: ReactNode; dataKey?: string; nameKey?: string; data?: unknown[] };
  const stub =
    (testid: string) =>
    ({ children, dataKey, nameKey, data }: StubProps) =>
      (
        <div
          data-testid={testid}
          data-key={dataKey ?? ""}
          data-namekey={nameKey ?? ""}
          data-len={data ? String(data.length) : ""}
        >
          {children}
        </div>
      );
  return {
    ResponsiveContainer: stub("responsive"),
    BarChart: stub("barchart"),
    LineChart: stub("linechart"),
    AreaChart: stub("areachart"),
    PieChart: stub("piechart"),
    Bar: stub("bar"),
    Line: stub("line"),
    Area: stub("area"),
    Pie: stub("pie"),
    XAxis: stub("xaxis"),
    YAxis: stub("yaxis"),
    CartesianGrid: stub("grid"),
    Tooltip: stub("tooltip"),
    Legend: stub("legend"),
  };
});

import { A2UIChart } from "./A2UIChart";
import type { A2UINode } from "./types";

type ChartNode = Extract<A2UINode, { type: "chart" }>;

const bar: ChartNode = {
  type: "chart",
  chart: "bar",
  title: "Quarterly",
  x: "month",
  series: ["plan", "actual"],
  data: [
    { month: "Jan", plan: 10, actual: 8 },
    { month: "Feb", plan: 12, actual: 14 },
    { month: "Mar", plan: 9, actual: 11 },
  ],
};

describe("A2UIChart", () => {
  it("renders a bar chart: one Bar per series, x-axis bound to the x key, title shown", () => {
    const { container } = render(<A2UIChart node={bar} />);
    expect(container.querySelector(".a2ui-chart")).toHaveAttribute("data-chart", "bar");
    expect(screen.getByText("Quarterly")).toBeInTheDocument();
    expect(screen.getByTestId("barchart")).toHaveAttribute("data-len", "3");
    expect(screen.getByTestId("xaxis")).toHaveAttribute("data-key", "month");
    expect(screen.getAllByTestId("bar")).toHaveLength(2);
  });

  it("renders a line chart with one Line per series", () => {
    const node: ChartNode = { ...bar, chart: "line", series: ["plan"] };
    render(<A2UIChart node={node} />);
    expect(screen.getByTestId("linechart")).toBeInTheDocument();
    expect(screen.getAllByTestId("line")).toHaveLength(1);
  });

  it("renders an area chart with one Area per series", () => {
    const node: ChartNode = { ...bar, chart: "area", series: ["plan"] };
    render(<A2UIChart node={node} />);
    expect(screen.getByTestId("areachart")).toBeInTheDocument();
    expect(screen.getAllByTestId("area")).toHaveLength(1);
  });

  it("renders a pie chart keyed on the first series and named by the x field", () => {
    const node: ChartNode = { ...bar, chart: "pie", title: undefined };
    render(<A2UIChart node={node} />);
    const pie = screen.getByTestId("pie");
    expect(pie).toHaveAttribute("data-key", "plan");
    expect(pie).toHaveAttribute("data-namekey", "month");
  });

  it("tolerates a pie chart with no series (empty data-key)", () => {
    const node: ChartNode = { ...bar, chart: "pie", series: [], title: undefined };
    render(<A2UIChart node={node} />);
    expect(screen.getByTestId("pie")).toHaveAttribute("data-key", "");
  });

  it("cycles the palette for more series than colors", () => {
    const node: ChartNode = {
      ...bar,
      series: ["a", "b", "c", "d", "e", "f", "g"],
      data: [{ month: "Jan", a: 1, b: 1, c: 1, d: 1, e: 1, f: 1, g: 1 }],
    };
    render(<A2UIChart node={node} />);
    expect(screen.getAllByTestId("bar")).toHaveLength(7);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run src/a2ui/A2UIChart.test.tsx`
Expected: FAIL — `A2UIChart` cannot be imported (module `./A2UIChart` does not exist yet).

- [ ] **Step 3: Implement `A2UIChart`**

Create `packages/agent-panel/src/a2ui/A2UIChart.tsx`:

```tsx
import type { ReactElement } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import type { A2UINode } from "./types";

type ChartNode = Extract<A2UINode, { type: "chart" }>;

/** Stable per-series palette (indexed by series order, wrapping past the end). */
const SERIES_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#06b6d4", "#a855f7"];
const colorFor = (i: number): string => SERIES_COLORS[i % SERIES_COLORS.length] as string;

/**
 * Renders an A2UI `chart` node via recharts. Cartesian kinds (bar/line/area)
 * share axes/grid/legend and draw one element per series; `pie` draws the first
 * series as slices labelled by the `x` field.
 */
export function A2UIChart({ node }: { node: ChartNode }): ReactElement {
  return (
    <div className="a2ui-chart" data-chart={node.chart}>
      {node.title && <div className="a2ui-chart-title">{node.title}</div>}
      <ResponsiveContainer width="100%" height={220}>
        {renderChart(node)}
      </ResponsiveContainer>
    </div>
  );
}

function renderChart(node: ChartNode): ReactElement {
  switch (node.chart) {
    case "bar":
      return (
        <BarChart data={node.data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey={node.x} />
          <YAxis />
          <Tooltip />
          <Legend />
          {node.series.map((s, i) => (
            <Bar key={s} dataKey={s} fill={colorFor(i)} />
          ))}
        </BarChart>
      );
    case "line":
      return (
        <LineChart data={node.data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey={node.x} />
          <YAxis />
          <Tooltip />
          <Legend />
          {node.series.map((s, i) => (
            <Line key={s} type="monotone" dataKey={s} stroke={colorFor(i)} />
          ))}
        </LineChart>
      );
    case "area":
      return (
        <AreaChart data={node.data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey={node.x} />
          <YAxis />
          <Tooltip />
          <Legend />
          {node.series.map((s, i) => (
            <Area key={s} type="monotone" dataKey={s} stroke={colorFor(i)} fill={colorFor(i)} />
          ))}
        </AreaChart>
      );
    case "pie":
      return (
        <PieChart>
          <Tooltip />
          <Legend />
          <Pie data={node.data} dataKey={node.series[0] ?? ""} nameKey={node.x} fill={colorFor(0)} label />
        </PieChart>
      );
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run src/a2ui/A2UIChart.test.tsx`
Expected: PASS (all 6 tests). Output pristine — no warnings.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-panel/src/a2ui/A2UIChart.tsx packages/agent-panel/src/a2ui/A2UIChart.test.tsx
git commit -m "feat(panel): A2UIChart — recharts bar/line/area/pie widget

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `A2UIView` renderer (text / card / group / list / table / unknown + chart routing)

**Files:**
- Create: `packages/agent-panel/src/a2ui/renderA2UI.tsx`
- Test: `packages/agent-panel/src/a2ui/renderA2UI.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/agent-panel/src/a2ui/renderA2UI.test.tsx`. It mocks `./A2UIChart` (so this file only verifies *routing* to the chart widget, not recharts):

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("./A2UIChart", () => ({
  A2UIChart: ({ node }: { node: { chart: string } }) => (
    <div data-testid="chart" data-chart={node.chart} />
  ),
}));

import { A2UIView } from "./renderA2UI";
import type { A2UINode } from "./types";

describe("A2UIView", () => {
  it("wraps output in an .a2ui container", () => {
    const { container } = render(<A2UIView message={{ type: "text", text: "hi" }} />);
    expect(container.querySelector(".a2ui")).not.toBeNull();
  });

  it("renders text with the default body variant and an explicit variant", () => {
    const { container, rerender } = render(<A2UIView message={{ type: "text", text: "plain" }} />);
    expect(container.querySelector(".a2ui-text")).toHaveAttribute("data-variant", "body");
    expect(screen.getByText("plain")).toBeInTheDocument();
    rerender(<A2UIView message={{ type: "text", text: "Title", variant: "heading" }} />);
    expect(container.querySelector(".a2ui-text")).toHaveAttribute("data-variant", "heading");
  });

  it("renders a card with its title and nested children", () => {
    const message: A2UINode = {
      type: "card",
      title: "Summary",
      children: [
        { type: "text", text: "inside" },
        { type: "table", columns: ["A"], rows: [["1"]] },
      ],
    };
    const { container } = render(<A2UIView message={message} />);
    expect(container.querySelector(".a2ui-card-title")).toHaveTextContent("Summary");
    expect(screen.getByText("inside")).toBeInTheDocument();
    expect(container.querySelector(".a2ui-card .a2ui-table")).not.toBeNull();
  });

  it("renders a group's children with no chrome of its own", () => {
    const message: A2UINode = {
      type: "group",
      children: [
        { type: "text", text: "one" },
        { type: "text", text: "two" },
      ],
    };
    const { container } = render(<A2UIView message={message} />);
    expect(container.querySelector(".a2ui-group")).not.toBeNull();
    expect(container.querySelectorAll(".a2ui-group .a2ui-text")).toHaveLength(2);
  });

  it("renders an unordered list of strings", () => {
    const { container } = render(
      <A2UIView message={{ type: "list", items: ["alpha", "beta"] }} />,
    );
    expect(container.querySelector("ul.a2ui-list")).not.toBeNull();
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(screen.getByText("alpha")).toBeInTheDocument();
  });

  it("renders an ordered list and supports node items", () => {
    const message: A2UINode = {
      type: "list",
      ordered: true,
      items: ["first", { type: "card", title: "nested", children: [] }],
    };
    const { container } = render(<A2UIView message={message} />);
    expect(container.querySelector("ol.a2ui-list")).not.toBeNull();
    expect(container.querySelector("li .a2ui-card-title")).toHaveTextContent("nested");
  });

  it("renders a table with caption, header columns, and body cells", () => {
    const message: A2UINode = {
      type: "table",
      caption: "Fares",
      columns: ["Airline", "Price"],
      rows: [
        ["ANA", 842],
        ["JAL", 910],
      ],
    };
    const { container } = render(<A2UIView message={message} />);
    expect(container.querySelector("caption")).toHaveTextContent("Fares");
    expect(container.querySelectorAll("thead th")).toHaveLength(2);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(screen.getByText("842")).toBeInTheDocument();
  });

  it("routes a chart node to A2UIChart", () => {
    render(<A2UIView message={{ type: "chart", chart: "bar", x: "m", series: ["a"], data: [] }} />);
    expect(screen.getByTestId("chart")).toHaveAttribute("data-chart", "bar");
  });

  it("renders a fallback for an unknown node type", () => {
    const bogus = { type: "widget" } as unknown as A2UINode;
    const { container } = render(<A2UIView message={bogus} />);
    const unknown = container.querySelector(".a2ui-unknown");
    expect(unknown).toHaveAttribute("data-type", "widget");
    expect(unknown).toHaveTextContent("widget");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run src/a2ui/renderA2UI.test.tsx`
Expected: FAIL — `A2UIView` cannot be imported (module `./renderA2UI` does not exist yet).

- [ ] **Step 3: Implement `A2UIView`**

Create `packages/agent-panel/src/a2ui/renderA2UI.tsx`:

```tsx
import type { ReactElement } from "react";
import type { A2UINode } from "./types";
import { A2UIChart } from "./A2UIChart";

/** Renders one A2UI message (a single root node), recursing into containers. */
export function A2UIView({ message }: { message: A2UINode }): ReactElement {
  return <div className="a2ui">{renderNode(message)}</div>;
}

function renderNode(node: A2UINode, key?: number): ReactElement {
  switch (node.type) {
    case "text":
      return (
        <div key={key} className="a2ui-text" data-variant={node.variant ?? "body"}>
          {node.text}
        </div>
      );
    case "card":
      return (
        <div key={key} className="a2ui-card">
          {node.title && <div className="a2ui-card-title">{node.title}</div>}
          <div className="a2ui-card-body">{node.children.map((c, i) => renderNode(c, i))}</div>
        </div>
      );
    case "group":
      return (
        <div key={key} className="a2ui-group">
          {node.children.map((c, i) => renderNode(c, i))}
        </div>
      );
    case "list": {
      const items = node.items.map((it, i) => (
        <li key={i}>{typeof it === "string" ? it : renderNode(it)}</li>
      ));
      return node.ordered ? (
        <ol key={key} className="a2ui-list">
          {items}
        </ol>
      ) : (
        <ul key={key} className="a2ui-list">
          {items}
        </ul>
      );
    }
    case "table":
      return (
        <table key={key} className="a2ui-table">
          {node.caption && <caption>{node.caption}</caption>}
          <thead>
            <tr>
              {node.columns.map((c, i) => (
                <th key={i}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {node.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "chart":
      return <A2UIChart key={key} node={node} />;
    default:
      // Runtime-only branch: a `type` the schema doesn't cover (e.g. a future or
      // full-spec A2UI message). TS narrows `node` to `never` here, so read the
      // type defensively for the fallback label.
      return (
        <div key={key} className="a2ui-unknown" data-type={(node as { type: string }).type}>
          Unsupported component: {(node as { type: string }).type}
        </div>
      );
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run src/a2ui/renderA2UI.test.tsx`
Expected: PASS (all 9 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/agent-panel/src/a2ui/renderA2UI.tsx packages/agent-panel/src/a2ui/renderA2UI.test.tsx
git commit -m "feat(panel): A2UIView — pure renderer for A2UI node tree

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `ui` beat → feed item (types + engine)

**Files:**
- Modify: `packages/agent-panel/src/types.ts` (add `ui` to `FeedItem` and `Beat`)
- Modify: `packages/agent-panel/src/engine.ts` (handle `ui` beat in `reduce`; count it in `counts`)
- Test: `packages/agent-panel/src/engine.test.ts` (new `ui` test + updated `counts` test)

- [ ] **Step 1: Write the failing tests**

In `packages/agent-panel/src/engine.test.ts`, add a `ui` test to the `"reduce — result, confirm, takeover"` block. Insert it after the `"adds a result card"` test (after the closing `});` on the `it("adds a result card", ...)`):

```ts
  it("adds a ui card from a ui beat", () => {
    const s = run({ kind: "ui", a2ui: { type: "text", text: "hello" } });
    const ui = only(s, "ui");
    expect(ui).toHaveLength(1);
    expect(ui[0]!.a2ui).toEqual({ type: "text", text: "hello" });
  });
```

Then update the existing `counts` test so a `ui` beat counts toward `chat`. Find:

```ts
      { kind: "say", agent: "atlas", text: "hi" },
      { kind: "result", result: RESULT },
    );
    expect(counts(s.items)).toEqual({ chat: 3, activity: 2, plan: 2 });
```

Replace with:

```ts
      { kind: "say", agent: "atlas", text: "hi" },
      { kind: "result", result: RESULT },
      { kind: "ui", a2ui: { type: "text", text: "x" } },
    );
    expect(counts(s.items)).toEqual({ chat: 4, activity: 2, plan: 2 });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bunx vitest run src/engine.test.ts`
Expected: FAIL — TypeScript/assertion errors: `kind: "ui"` is not assignable to the `Beat` union, and `counts` returns `chat: 3` (no `ui` handling yet).

- [ ] **Step 3: Add the `ui` variant to the type unions**

In `packages/agent-panel/src/types.ts`, add the A2UI import below the existing `IconName` import. Find:

```ts
import type { IconName } from "./components/Icon";
```

Replace with:

```ts
import type { IconName } from "./components/Icon";
import type { A2UIMessage } from "./a2ui/types";
```

Add the `ui` feed item to the `FeedItem` union. Find:

```ts
  | (ItemBase & { type: "result"; result: ResultCard })
```

Replace with:

```ts
  | (ItemBase & { type: "result"; result: ResultCard })
  | (ItemBase & { type: "ui"; a2ui: A2UIMessage })
```

Add the `ui` beat to the `Beat` union. Find:

```ts
  | { kind: "result"; result: ResultCard }
```

Replace with:

```ts
  | { kind: "result"; result: ResultCard }
  | { kind: "ui"; a2ui: A2UIMessage }
```

- [ ] **Step 4: Handle the `ui` beat in the reducer**

In `packages/agent-panel/src/engine.ts`, add a `ui` case mirroring `result`. Find the end of the `result` case:

```ts
    case "result": {
      const seq = state.seq + 1;
      return {
        ...state,
        seq,
        items: [
          ...finalizeActions(state.items),
          { type: "result", key: seq, result: action.result },
        ],
      };
    }
```

Insert directly after it:

```ts
    case "ui": {
      const seq = state.seq + 1;
      return {
        ...state,
        seq,
        items: [
          ...finalizeActions(state.items),
          { type: "ui", key: seq, a2ui: action.a2ui },
        ],
      };
    }
```

- [ ] **Step 5: Count `ui` items as chat in `counts`**

In `packages/agent-panel/src/engine.ts`, find the chat tally condition:

```ts
    if (it.type === "user" || it.type === "say" || it.type === "result" || it.type === "confirm" || it.type === "takeover") {
```

Replace with:

```ts
    if (it.type === "user" || it.type === "say" || it.type === "result" || it.type === "confirm" || it.type === "takeover" || it.type === "ui") {
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bunx vitest run src/engine.test.ts`
Expected: PASS (the new `ui` test and the updated `counts` test).

- [ ] **Step 7: Commit**

```bash
git add packages/agent-panel/src/types.ts packages/agent-panel/src/engine.ts packages/agent-panel/src/engine.test.ts
git commit -m "feat(panel): ui beat folds an A2UI message into the feed

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Render the `ui` feed item (`UiItem` + `Feed` routing)

**Files:**
- Modify: `packages/agent-panel/src/components/FeedItems.tsx` (add `UiItem`)
- Modify: `packages/agent-panel/src/components/Feed.tsx` (route `ui` → `UiItem`)
- Test: `packages/agent-panel/src/components/FeedItems.test.tsx` (new `UiItem` test)
- Test: `packages/agent-panel/src/components/Feed.test.tsx` (route `ui` in the dispatch test)

- [ ] **Step 1: Write the failing tests**

In `packages/agent-panel/src/components/FeedItems.test.tsx`, add `UiItem` to the imports. Find:

```tsx
import {
  MsgItem,
  ThinkingItem,
  HandoffItem,
  PlanItem,
  ActionsItem,
  ResultItem,
  ConfirmItem,
  TakeoverItem,
} from "./FeedItems";
```

Replace with:

```tsx
import {
  MsgItem,
  ThinkingItem,
  HandoffItem,
  PlanItem,
  ActionsItem,
  ResultItem,
  ConfirmItem,
  TakeoverItem,
  UiItem,
} from "./FeedItems";
```

Then add a `UiItem` describe block at the end of the file (after the last existing `describe`):

```tsx
describe("UiItem", () => {
  it("renders the A2UI message inside a ui-item wrapper", () => {
    const item: Item<"ui"> = { type: "ui", key: 1, a2ui: { type: "text", text: "rendered" } };
    const { container } = render(<UiItem item={item} />);
    expect(screen.getByText("rendered")).toBeInTheDocument();
    expect(container.querySelector(".ui-item .a2ui")).not.toBeNull();
  });
});
```

In `packages/agent-panel/src/components/Feed.test.tsx`, extend the dispatch test. Find:

```tsx
      { type: "actions", key: 6, agent: "atlas", title: "Nav", open: true, running: false, rows: [] },
    ];
    const { container } = render(
      <Feed
        items={items}
        chat="flat"
        actionStyle="timeline"
        onAnswer={() => {}}
        onTake={() => {}}
        onToggleActions={() => {}}
      />,
    );
    expect(container.querySelector(".feed")).toHaveAttribute("data-chat", "flat");
    expect(screen.getByText("go")).toBeInTheDocument();
    expect(screen.getByText("on it")).toBeInTheDocument();
    expect(container.querySelector(".typing")).not.toBeNull();
    expect(container.querySelector(".handoff")).not.toBeNull();
    expect(container.querySelector(".plan")).not.toBeNull();
    expect(container.querySelector(".actions")).not.toBeNull();
  });
```

Replace with:

```tsx
      { type: "actions", key: 6, agent: "atlas", title: "Nav", open: true, running: false, rows: [] },
      { type: "ui", key: 8, a2ui: { type: "text", text: "uitext" } },
    ];
    const { container } = render(
      <Feed
        items={items}
        chat="flat"
        actionStyle="timeline"
        onAnswer={() => {}}
        onTake={() => {}}
        onToggleActions={() => {}}
      />,
    );
    expect(container.querySelector(".feed")).toHaveAttribute("data-chat", "flat");
    expect(screen.getByText("go")).toBeInTheDocument();
    expect(screen.getByText("on it")).toBeInTheDocument();
    expect(container.querySelector(".typing")).not.toBeNull();
    expect(container.querySelector(".handoff")).not.toBeNull();
    expect(container.querySelector(".plan")).not.toBeNull();
    expect(container.querySelector(".actions")).not.toBeNull();
    expect(container.querySelector(".ui-item")).not.toBeNull();
    expect(screen.getByText("uitext")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bunx vitest run src/components/FeedItems.test.tsx src/components/Feed.test.tsx`
Expected: FAIL — `UiItem` is not exported by `./FeedItems`, and `Feed`'s switch has no `ui` case (the `.ui-item` query returns null; with `noFallthroughCasesInSwitch` the new item type also surfaces a type error in `Feed.tsx` once the union has `ui`).

- [ ] **Step 3: Implement `UiItem`**

In `packages/agent-panel/src/components/FeedItems.tsx`, add the `A2UIView` import below the existing `RichText` import. Find:

```tsx
import { Icon } from "./Icon";
import { RichText } from "./RichText";
```

Replace with:

```tsx
import { Icon } from "./Icon";
import { RichText } from "./RichText";
import { A2UIView } from "../a2ui/renderA2UI";
```

Add the `UiItem` component at the end of the file (after `TakeoverItem`):

```tsx
export function UiItem({ item }: { item: Item<"ui"> }): ReactElement {
  return (
    <div className="ui-item">
      <A2UIView message={item.a2ui} />
    </div>
  );
}
```

- [ ] **Step 4: Route the `ui` item in `Feed`**

In `packages/agent-panel/src/components/Feed.tsx`, add `UiItem` to the import. Find:

```tsx
import {
  MsgItem,
  ThinkingItem,
  HandoffItem,
  PlanItem,
  ActionsItem,
  ResultItem,
  ConfirmItem,
  TakeoverItem,
} from "./FeedItems";
```

Replace with:

```tsx
import {
  MsgItem,
  ThinkingItem,
  HandoffItem,
  PlanItem,
  ActionsItem,
  ResultItem,
  ConfirmItem,
  TakeoverItem,
  UiItem,
} from "./FeedItems";
```

Add the `ui` case to the switch. Find:

```tsx
          case "result":
            return <ResultItem key={it.key} item={it} />;
```

Replace with:

```tsx
          case "result":
            return <ResultItem key={it.key} item={it} />;
          case "ui":
            return <UiItem key={it.key} item={it} />;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bunx vitest run src/components/FeedItems.test.tsx src/components/Feed.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/agent-panel/src/components/FeedItems.tsx packages/agent-panel/src/components/Feed.tsx packages/agent-panel/src/components/FeedItems.test.tsx packages/agent-panel/src/components/Feed.test.tsx
git commit -m "feat(panel): render ui feed items via A2UIView

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Public exports, baseline styles, and full verification

**Files:**
- Modify: `packages/agent-panel/src/index.ts` (export `A2UIView` + A2UI types)
- Modify: `packages/agent-panel/src/styles/index.css` (minimal A2UI styling)

- [ ] **Step 1: Export the A2UI surface from the barrel**

In `packages/agent-panel/src/index.ts`, add the renderer export below the `Icon` exports. Find:

```ts
export { Icon } from "./components/Icon";
export type { IconName } from "./components/Icon";
```

Replace with:

```ts
export { Icon } from "./components/Icon";
export type { IconName } from "./components/Icon";

export { A2UIView } from "./a2ui/renderA2UI";
export type { A2UIMessage, A2UINode, A2UIChartKind, A2UITextVariant } from "./a2ui/types";
```

- [ ] **Step 2: Add baseline styles for the A2UI widgets**

Append to `packages/agent-panel/src/styles/index.css` (these classNames are produced by the renderer; styles are visual-only and not covered by tests — `css: false` in the Vitest config):

```css
/* ── A2UI generative UI ─────────────────────────────────────────── */
.ui-item {
  margin: 8px 0;
}
.a2ui {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.a2ui-text[data-variant="heading"] {
  font-weight: 600;
  font-size: 1.05em;
}
.a2ui-text[data-variant="caption"] {
  opacity: 0.7;
  font-size: 0.85em;
}
.a2ui-card {
  border: 1px solid var(--border-3, rgba(255, 255, 255, 0.12));
  border-radius: 10px;
  padding: 10px 12px;
}
.a2ui-card-title {
  font-weight: 600;
  margin-bottom: 6px;
}
.a2ui-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.a2ui-list {
  margin: 0;
  padding-left: 1.25em;
}
.a2ui-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9em;
}
.a2ui-table caption {
  text-align: left;
  opacity: 0.7;
  margin-bottom: 4px;
}
.a2ui-table th,
.a2ui-table td {
  border: 1px solid var(--border-3, rgba(255, 255, 255, 0.12));
  padding: 4px 8px;
  text-align: left;
}
.a2ui-table th {
  font-weight: 600;
}
.a2ui-chart-title {
  font-weight: 600;
  margin-bottom: 4px;
}
.a2ui-unknown {
  opacity: 0.6;
  font-size: 0.85em;
  font-style: italic;
}
```

- [ ] **Step 3: Run the full test suite**

Run: `bun run test`
Expected: PASS — all existing tests plus the new A2UI tests. Output pristine.

- [ ] **Step 4: Run the coverage gate**

Run: `bun run test:coverage`
Expected: PASS — ≥90% lines/functions/branches/statements. The new runtime files (`A2UIChart.tsx`, `renderA2UI.tsx`, the `UiItem`/`Feed` additions, the `ui` reducer case) are exercised by Tasks 2–5; `src/a2ui/types.ts` is coverage-excluded.

- [ ] **Step 5: Typecheck and lint**

Run: `bun run typecheck && bun run lint`
Expected: PASS — no TypeScript errors, no ESLint errors.

- [ ] **Step 6: Commit**

```bash
git add packages/agent-panel/src/index.ts packages/agent-panel/src/styles/index.css
git commit -m "feat(panel): export A2UIView + A2UI types; baseline A2UI styles

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Post-implementation (standard path)

After the tasks above, follow the repo's standard merge path for this PR:

1. Run `/simplify` on the branch diff and apply the cleanup it surfaces.
2. Push `feat/generative-ui-a2ui` and open a PR to `main` (use `gh pr create --body-file` with a heredoc body; never push to `main` directly — it is policy-blocked). The PR carries both the design spec (already committed) and this PR-1 implementation.
3. Address review bots (Gemini / Codex / CodeRabbit) and merge.

PR body must end with:

```text
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

## Deferred to follow-on plans (not this PR)

- **PR-2 — daemon `beatMapper` → `ui` beat.** Recognize the `render_ui` tool in Pi's `AgentEvent` stream and emit `{ kind: "ui", a2ui }`. **Blocked on verifying** the spec's flagged integration point: does Pi surface tool *results* (`{ content, details: message }`) richly, or must `render_ui` read `args.message`? Write this plan after PR-1 merges and that is confirmed against a live `pi --mode rpc`.
- **PR-3 — `-e` convenience tools.** `render_table` / `render_chart` / `render_list` in `pi-extension/browser-bridge.ts` that build the A2UI message, plus extending the beatMapper name family.
- **Future specs:** UI→agent interactivity (`uiEvent` command seam), full A2UI v0.8 adjacency-list support, full AG-UI/CopilotKit adoption.

## Self-Review

**1. Spec coverage.** Spec → task mapping:
- A2UI subset schema (text/card/group/list/table/chart) → Task 1 `types.ts`.
- `A2UIView` pure renderer + per-node widgets + unknown fallback → Task 3 (text/card/group/list/table/unknown) + Task 2 (chart via recharts).
- `chart` extension backed by recharts (bar/line/area/pie) → Task 2.
- `Beat` gains `{ kind: "ui"; a2ui }`; `FeedItem` gains `ui`; `engine` folds it (mirrors `result`) → Task 4.
- `FeedItems` renders the `ui` item via `<A2UIView>`; `Feed` routes it → Task 5.
- `package.json` adds `recharts` → Task 1.
- Testing strategy (per-node component tests; chart asserts data passed to recharts not pixels; engine `ui`-beat test; counts) → Tasks 2–5. Non-UI tool-call mapping (beatMapper) is explicitly PR-2, deferred.
- `index.ts` exports → Task 6.
  No PR-1 spec requirement is left without a task. (PR-2/PR-3 are intentionally separate plans, per the spec's own sequencing and its flagged Pi integration unknown.)

**2. Placeholder scan.** No "TBD"/"TODO"/"handle edge cases"/"similar to Task N". Every code step shows complete code; every run step shows the exact command and expected outcome. ✓

**3. Type consistency.** `A2UINode`/`A2UIMessage`/`A2UIChartKind`/`A2UITextVariant` are defined in Task 1 and used identically in Tasks 2–6. `A2UIView({ message })` and `A2UIChart({ node })` prop shapes match every call site (`renderA2UI.tsx`, `FeedItems.tsx`, and both test files). The `ui` discriminant is `kind: "ui"` on `Beat` and `type: "ui"` on `FeedItem` consistently across `types.ts`, `engine.ts`, `engine.test.ts`, `FeedItems.tsx`, `Feed.tsx`, and the tests. `colorFor`/`SERIES_COLORS` are internal to `A2UIChart.tsx`. ✓
