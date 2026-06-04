# Generative UI in the conversation (A2UI) — design

**Status:** approved (design phase) · **Date:** 2026-06-03

## Context

fAIry's conversation surface is the custom React panel `@fairy/agent-panel`: the
daemon's `ConversationServer` streams `Beat` frames over a WebSocket, the panel's
`engine` folds them into a feed, and `FeedItems` render them. Pi's `AgentEvent`
stream becomes beats via the daemon's `beatMapper`.

The Pi `-e` script already registers a `render_ui` tool that "renders rich UI …
using A2UI v0.8" — but it is **scaffolded-only**: the tool echoes its `message`
back, and **nothing in the panel renders it** (there is no A2UI renderer, and no
`ui` beat). So this feature largely *finishes what `render_ui` started*.

**The ask:** let the agent display **tables, lists, and charts** in the
conversation to present information ("support A2UI / AG-UI with CopilotKit; add
table/list UI and charts; add related tools if needed").

## Goal & non-goals

**Goal:** the agent can render **tables, lists, and charts** (plus text/card
containers) into the conversation, using the **A2UI** component format, rendered
by the existing panel.

**Non-goals (v1):**
- No AG-UI transport / CopilotKit runtime (see Decisions).
- No UI→agent interactivity (clickable widgets calling back to Pi) — display
  first; the seam is noted for a later PR.
- No full A2UI v0.8 adjacency-list model — a pragmatic nested-tree subset of its
  component types (see Schema). Full-spec parsing is a future enhancement.

## Decisions (and why)

These were settled through a scoping funnel; recording the rationale because the
landing differs from the literal phrasing of the original ask.

1. **Generative UI lives in the existing panel** (not a new framework).
2. **A2UI is the message format** — the open spec `render_ui` already targets,
   and the format the CopilotKit ecosystem renders (so we stay interoperable).
3. **Hybrid, keep the panel shell** — preserve the bespoke multi-agent feed
   (plan/act/handoff/takeover + its ~97 tests); add A2UI rendering alongside it.
4. **Keep the WS + `Beat` transport** — carry A2UI as a `ui` beat. We do **not**
   adopt AG-UI as the transport (that would re-architect the merged conversation
   layer + need a Pi→AG-UI adapter + a runtime; large, and unnecessary for a
   display feature).
5. **Custom A2UI renderer (no CopilotKit dependency).** Research finding:
   CopilotKit's A2UI renderer (`createA2UIMessageRenderer` / `A2UIRenderer`) is
   coupled to `CopilotKitProvider`/its runtime, so using it would drag back the
   AG-UI/runtime rework decision (4) ruled out. We instead render the same A2UI
   format with a small custom renderer. Charts are an A2UI **extension** (A2UI
   core has no chart type) backed by **recharts**.

Net: we honor the intent (A2UI-based generative UI: tables/lists/charts) without
the disproportionate CopilotKit/AG-UI rearchitecture. Full AG-UI + the CopilotKit
renderer remain a possible future direction if real bidirectional interactivity
is needed.

## Architecture & data flow

```text
Pi calls render_ui({ message })            (existing -e tool — pure echo)
  │   (or a convenience tool: render_table/render_chart/render_list, which
  │    BUILD the A2UI message and return it)
  ▼
Pi AgentEvent stream
  ▼
daemon beatMapper  — detects the render_ui-family tool call by name,
  │                  emits { kind: "ui", a2ui: <message> } (a new PanelBeat)
  ▼
conversation WebSocket (UNCHANGED)
  ▼
panel engine  — folds the ui beat into a `ui` FeedItem
  ▼
<A2UIView message>  — renders the A2UI tree:
       text / card / list / table  → React components
       chart                       → recharts
```

The daemon is **A2UI-agnostic**: it passes `a2ui` through opaquely (typed
`unknown`/`Record`), so the A2UI schema + renderer live entirely in the panel.
No cross-package type coupling; no transport change.

## Components

### `@fairy/agent-panel/src/a2ui/` (new)
- `types.ts` — the supported A2UI node union (see Schema).
- `renderA2UI.tsx` — a pure `A2UIView({ message })` that switches on node type
  and renders React; unknown types render a small "unsupported component" note
  (forward-compatible, never throws).
- Widgets: `A2UITable`, `A2UIList`, `A2UICard`, `A2UIText`, `A2UIChart`
  (`A2UIChart` wraps **recharts** — bar/line/area/pie).
- All pure/presentational → unit-tested by feeding hand-written A2UI messages and
  asserting the rendered structure.

### `@fairy/agent-panel` wiring
- `types.ts` — add `{ kind: "ui"; a2ui: A2UIMessage }` to `Beat`, and a `ui`
  `FeedItem` (mirrors the existing `result` beat → `ResultCard` path).
- `engine.ts` — handle the `ui` beat → push a `ui` feed item.
- `components/FeedItems.tsx` — render the `ui` item via `<A2UIView>`.
- `package.json` — add `recharts`.

### `pi-daemon/src/beatMapper.ts`
- Recognize the render_ui tool-name family (`render_ui`, `render_table`,
  `render_chart`, `render_list` — the registered `-e` tool names) in Pi's event
  stream and emit `{ kind: "ui", a2ui }` instead of a generic `act`/`result`.
- **Source the A2UI from the tool RESULT, not the call args** — this is uniform:
  `render_ui` echoes `message` and the convenience tools BUILD the message, but
  all four *return* the A2UI object, whereas only `render_ui` carries it in args.
  So the mapper reads the returned message off the tool-result event.
- **Integration point to verify in PR-2:** confirm Pi's `AgentEvent` stream
  surfaces tool *results* with the payload (the `-e` tool returns
  `{ content:[…text…], details: message }`). If results aren't surfaced richly,
  the fallback is: `render_ui` reads `args.message` (always available), and the
  convenience tools are folded in once the result path is confirmed. `a2ui` is
  passed through untyped. Unit-tested like the existing beat mappings (with a
  synthesized tool-result event).

### `pi-daemon/pi-extension/browser-bridge.ts` (the `-e` script)
- Keep `render_ui({ message })` as the raw A2UI escape hatch.
- **Add convenience tools** that build the A2UI message for the agent (far easier
  than hand-authoring A2UI):
  - `render_table({ title?, columns: string[], rows: (string|number)[][] })`
  - `render_chart({ type: "bar"|"line"|"area"|"pie", title?, data, x, series })`
  - `render_list({ title?, ordered?, items: string[] })`
  Each returns the corresponding A2UI message (same echo shape as `render_ui`).

## A2UI subset (the schema we render)

A pragmatic **nested-tree** subset of A2UI v0.8's component types (not the full
adjacency-list model). A message is a single root node:

```ts
type A2UINode =
  | { type: "text"; text: string; variant?: "body" | "heading" | "caption" }
  | { type: "card"; title?: string; children: A2UINode[] }
  | { type: "group"; children: A2UINode[] }
  | { type: "list"; ordered?: boolean; items: Array<string | A2UINode> }
  | { type: "table"; caption?: string; columns: string[]; rows: Array<Array<string | number>> }
  | { type: "chart"; chart: "bar" | "line" | "area" | "pie"; title?: string;
      data: Array<Record<string, string | number>>; x: string; series: string[] };
type A2UIMessage = A2UINode;
```

`chart` is an fAIry extension over A2UI core. Unknown `type` values render a
fallback note (so future/full-spec messages degrade gracefully rather than
crashing the feed).

## Interactivity (deferred)

Display-first for v1. The seam for later: an A2UI actionable node (e.g. a button
with an `action` id) → the panel sends a new `{ type: "uiEvent", action, value }`
command over the existing conversation WS → `ConversationController` forwards it
to Pi as a follow-up. Not built in v1; recorded so the `ui` beat / command shapes
don't preclude it.

## Testing

- **A2UI renderer** (panel): pure component tests per node type — table renders
  rows/columns; list ordered/unordered; chart maps `data`/`x`/`series` (assert
  the data passed to recharts, not pixel output); unknown type → fallback;
  nested card/group. >90% coverage (panel gate).
- **engine**: `ui` beat → one `ui` feed item.
- **beatMapper** (daemon): a `render_ui`/`render_table`/… tool-call event → a
  `ui` beat carrying the message; non-UI tool calls still map to `act`/`result`.
- The `-e` convenience tools build trivial A2UI objects; their builders are kept
  simple (the renderer + beatMapper carry the tested logic).

## Sequencing (≈3 PRs, each via the standard path: implement → /simplify → bots → merge)

1. **Panel A2UI renderer** — the `a2ui/` module (types + `A2UIView` + table/list/
   card/text/chart widgets) + the `ui` beat/FeedItem/engine wiring + `recharts`.
   Testable standalone with sample messages; delivers the rendering once fed.
2. **Daemon `beatMapper` → `ui` beat** on `render_ui` — now the agent's
   `render_ui` actually shows in the panel end-to-end.
3. **Convenience tools** (`render_table`/`render_chart`/`render_list`) + beatMapper
   recognizes the family.

Deferred (own future specs): UI→agent interactivity; full A2UI v0.8 adjacency-list
support; full AG-UI/CopilotKit adoption.
