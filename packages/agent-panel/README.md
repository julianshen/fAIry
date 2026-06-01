# @fairy/agent-panel

The **Fairy agent panel** — the React UI for the browser-agent conversation and
activity surface. A faithful, production port of the "Fairy Agent Panel" design,
rebuilt as a typed, tested React + TypeScript component.

It renders a team of specialist agents (orchestrator, navigator, reader,
operator) planning a task, handing work off, acting on the page, asking for
confirmation, and handing control back — driven by a small stream of typed
**beats**.

## Architecture

```
beats ──▶ reduce() ──▶ PanelState ──▶ <Panel/>
(agent or user actions)   (pure)        (presentational)
```

- **`engine.ts`** — a pure `reduce(state, action)`. All behavior (messages,
  plans, action logs, handoffs, confirms, takeovers, and user interactions)
  is expressed here, so the whole panel is reproducible from a list of actions.
- **`usePanelController`** — owns run state + the elapsed timer; exposes bound
  handlers. The *beat source* is the integrator's concern: the dev harness
  feeds it a script; production feeds it the pi-daemon's agent-event stream.
- **`<Panel/>`** — fully controlled and presentational: state in via props,
  every interaction out via callbacks. Header + body (empty state or feed) +
  composer, themed by a `PanelConfig` applied to the panel root.

The design's prototype scaffolding (the fake browser, demo flight site, and
live "Tweaks" editor) is intentionally **not** ported. A dev-only harness under
`src/harness/` replays the design's scripted run so every state can be eyeballed.

## Usage

```tsx
import { Panel, usePanelController } from "@fairy/agent-panel";
import "@fairy/agent-panel/src/styles/index.css";

function App() {
  const ctrl = usePanelController();
  return (
    <Panel
      state={ctrl.state}
      elapsed={ctrl.elapsed}
      onSend={(task) => ctrl.start(task) /* …then feed beats via ctrl.apply */}
      onReset={ctrl.reset}
      onPause={/* wire to your runner */ () => {}}
      onTakeover={() => {}}
      onStop={() => {}}
      onAnswer={ctrl.answer}
      onToggleActions={ctrl.toggleActions}
      onTake={ctrl.take}
    />
  );
}
```

## Commands

```bash
bun run dev            # dev harness (scripted simulation) at localhost:5173
bun run test           # vitest
bun run test:coverage  # coverage, enforces ≥90% on product code
bun run typecheck      # tsc --noEmit
bun run lint           # eslint
bun run build          # typecheck + production build
```

Tests are colocated with sources (`*.test.ts[x]`), written test-first.
