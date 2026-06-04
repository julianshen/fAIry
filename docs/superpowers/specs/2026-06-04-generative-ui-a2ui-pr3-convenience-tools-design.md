# Generative UI (A2UI) — PR-3: convenience tools — design

**Status:** approved (design phase) · **Date:** 2026-06-04 · **Builds on:** PR-1 (#38, panel renderer), PR-2 (#39, daemon `render_ui` → `ui` beat)

## Context

PR-1 made the panel render A2UI messages via a `ui` beat; PR-2 made the daemon
emit that beat when the agent calls `render_ui` (reading the message from the
call args). PR-3 — the last piece of the generative-UI track — adds **convenience
tools** so the agent can produce common UI without hand-authoring an A2UI message:

- `render_table` — a table from `columns` + `rows`
- `render_chart` — a chart from `chart` kind + `data`/`x`/`series`
- `render_list` — an ordered/unordered list from `items`

Unlike `render_ui` (whose `message` **is** its arg), these take simple args and
**build** the A2UI message, so the message only exists as the tool's return value.

## Decision (resolved the build-vs-parse fork)

The `-e` script builds the A2UI; **the daemon parses it out of the tool result**
and stays A2UI-agnostic. Chosen over (A) building in the daemon from args — which
would couple the daemon to the A2UI schema, breaking the agnostic stance PR-1/PR-2
established — and over (C) a uniform result-parse for all four tools, which would
needlessly refactor the just-merged `render_ui` args path. Net: the A2UI shapes
live in exactly one place (the `-e` builders + the panel's schema); the daemon
never constructs A2UI.

## Goal & non-goals

**Goal:** the agent can render tables, charts, and lists by calling a convenience
tool with simple args; the built A2UI shows in the panel end-to-end.

**Non-goals (v1):** no new A2UI node types (reuse PR-1's `table`/`chart`/`list`/
`card`); no daemon-side A2UI construction; no UI→agent interactivity (still
deferred); no change to `render_ui`'s PR-2 args path.

## Components

### `pi-extension/browser-bridge.ts` — three local tools + pure builders

Each tool mirrors `render_ui`: a `Type.Object` schema, and an `execute` that
builds a plain A2UI object and returns it as
`{ content: [{ type: "text", text: JSON.stringify(message) }], details: message }`
(the same shape `onToolEnd` already understands). The build logic is in **pure,
exported builder functions** so they can be unit-tested:

- `buildTable({ title?, columns, rows })` → `{ type: "table", columns, rows }`,
  plus `caption: title` when `title` is given (the A2UI table's title slot is
  `caption`).
- `buildChart({ chart, title?, data, x, series })` →
  `{ type: "chart", chart, title?, data, x, series }` (omit `title` when absent).
  The arg is named `chart` (the chart kind: `bar`|`line`|`area`|`pie`) to match
  the A2UI node's `chart` field and avoid colliding with the node's `type`.
- `buildList({ title?, ordered?, items })` → `{ type: "list", ordered?, items }`,
  wrapped as `{ type: "card", title, children: [list] }` when `title` is given
  (lists have no title slot).

Tool schemas (TypeBox):
- `render_table`: `{ title?: string, columns: string[], rows: (string|number)[][] }`
- `render_chart`: `{ chart: "bar"|"line"|"area"|"pie", title?: string,
  data: object[], x: string, series: string[] }`
- `render_list`: `{ title?: string, ordered?: boolean, items: string[] }`

Naming follows `render_ui` (no `browser_` prefix — these are panel-output tools,
not browser actions).

### `pi-daemon/src/beatMapper.ts` — recognize the family, parse the result

- A `RENDER_RESULT_TOOLS` set `{ render_table, render_chart, render_list }` (the
  tools whose message arrives via the result). `render_ui` stays separate on its
  PR-2 args path.
- **`tool_use`** for a `RENDER_RESULT_TOOLS` name: flush buffered text, set
  `groupOpen = false` (it's UI output, not a page action — and the forthcoming
  `ui` beat finalizes the group in the panel, like PR-2's `render_ui`), record the
  event `id` in a `pendingUi` set, and emit only the flushed beats (no `act`, no
  `ui` yet — the message isn't built until the result).
- **`tool_result`** whose `id` is in `pendingUi`: remove the id, then
  `a2ui = typeof output === "string" ? JSON.parse(output) : output`, and emit
  `{ kind: "ui", a2ui }`. A `JSON.parse` failure is caught and emits nothing
  (defensive; the `-e` tools always return valid JSON). Non-pending `tool_result`s
  keep returning `[]` as today.
- `reset()` clears `pendingUi` alongside the existing turn state.
- `a2ui` stays `unknown` (opaque) — the daemon does not inspect the shape.

## Data flow

```text
agent → render_table({ columns, rows })
  -e tool: buildTable(...) → {type:"table",…}; returns JSON.stringify(message)
  ▼
Pi AgentEvent stream
  tool_use(id, name=render_table, input)  → mapper: flush text, groupOpen=false,
                                            pendingUi.add(id)   (no beat yet)
  tool_result(id, output=JSON string)     → mapper: JSON.parse → {kind:"ui", a2ui}
  ▼
conversation → WS (unchanged) → extension conversationClient (opaque) → panel
  → reduce(ui) → A2UIView (PR-1)
```

## Error handling

- Malformed/missing args are caught by the tool's TypeBox schema before `execute`.
- A `tool_result` for a `render_*` tool whose `output` isn't parseable JSON →
  the mapper emits nothing (no crash, no beat). Won't occur with the `-e` tools
  but guarded because `output` is opaque `unknown`.
- A built message that is structurally odd still renders via the panel's PR-1
  wire-data guards (unknown type, missing arrays, etc.) — no daemon-side checks.

## Testing

- **Builders** (`-e` script): pure-function unit tests — `buildTable`/`buildChart`/
  `buildList` produce the expected A2UI object for representative args, including
  the `title` mappings (table→`caption`, chart→native `title`, list→`card` wrap)
  and the title-absent shapes.
- **`beatMapper`** (daemon): a `tool_use(render_table)` + `tool_result(id, JSON)`
  pair → one `{kind:"ui", a2ui}` beat with the parsed message; buffered text
  flushes to a `say` before it; a following page tool opens a fresh action group
  (groupOpen cleared); a non-pending `tool_result` → `[]`; a parse-failure result
  → `[]`; `render_ui` still emits via the args path; `reset()` clears pending ids.
  Daemon ≥90% coverage gate.

## Sequencing

Single PR (PR-3). After this lands, the generative-UI track is complete; remaining
deferred items (UI→agent interactivity, full A2UI v0.8 adjacency-list, full
AG-UI/CopilotKit) keep their own future specs.
