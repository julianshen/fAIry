# fAIry — Roadmap

> Living document. Each unchecked task is a feature branch → PR → merge unit,
> built TDD (≥90% coverage). Reorder freely; the **Non-goals** section is the
> guardrail against scope drift.

## Status

| Package | Module | State |
| --- | --- | --- |
| `agent-panel` | full panel UI (engine, components, controller, styles, harness) | ✅ merged (#1) |
| `pi-daemon` | `paths` — isolated per-OS workspace/config dirs | ✅ merged (#2) |
| `pi-daemon` | `ndjson` — newline-delimited JSON framing codec | ✅ merged (#4) |
| `pi-daemon` | `jsonLineProcess` — injectable subprocess NDJSON transport | ✅ merged (#5) |

Transport stack is complete: `paths` → `ndjson` → `jsonLineProcess`.

## Milestones

### M1 — Daemon core (in progress)

- [x] Isolated paths (`paths.ts`)
- [x] NDJSON framing (`ndjson.ts`)
- [x] Subprocess transport (`jsonLineProcess.ts`)
- [ ] **`PiSession`** — Pi RPC semantics over `JsonLineProcess`: send
      prompt/abort/compact; parse `agent_start` / `message_update` (text deltas)
      / `tool_execution_*` / `turn_end` / `agent_end`; surface a typed event
      stream; handle the "already processing" steer-retry and error/auto-retry
      cases. (Port of POC `PiSession`, on the new transport.)
- [ ] **Pi config writer** — materialize `settings.json` / `auth.json` under
      `piAgentDir`; multi-provider, secrets `0600`, reconcile only fAIry-managed
      keys. (Port of POC `PiConfigWriter`.)

### M2 — Browser bridge

- [ ] **Bridge protocol types** — `ToolRequest` / `ToolResponse` schema (shared,
      framework-agnostic).
- [ ] **Bridge server** — loopback server in the daemon that routes tool
      requests to the connected Chrome extension and correlates responses.
- [ ] **Pi browser extension** — the `-e` extension registering the `browser`
      tool that calls the bridge. (Port/adapt POC `horizon-bridge.ts`.)
- [ ] Port **all 27 POC browser tools** to the bridge (v1).

### M3 — Daemon ↔ clients API

- [ ] **Transport** — WebSocket for the conversation/event stream + extension
      tool bridge; HTTP REST for settings/status.
- [ ] **Auth** — daemon mints a per-session token; one-time pairing approved in
      the Settings UI; the token gates all requests.
- [ ] Conversation API (start task, stream beats, answer confirm, pause, take
      over, stop) — a **single conversation bound to the active tab**.
- [ ] Settings/status API (providers/models, daemon health).
- [ ] Map the Pi event stream → panel **beat model** (the `agent-panel` contract).

### M4 — Chrome extension

- [ ] MV3 scaffold; connect to the daemon at `localhost`.
- [ ] Browser-tool backend: execute `navigate`/`click`/`type`/`screenshot`/CDP
      via `chrome.debugger` / `chrome.tabs` / `chrome.scripting`.
- [ ] Host the `agent-panel` as the side-panel UI, wired to the daemon.

### M5 — macOS shell (Swift)

- [ ] Menu-bar tray app; spawn/monitor/restart the daemon.
- [ ] **Native macOS Settings UI** (providers/models) from the tray → daemon HTTP API.
- [ ] **WKWebView Conversation window** hosting the `agent-panel`.
- [ ] Login-item / LaunchAgent install.
- [ ] **Code-signing + notarization + Sparkle auto-update** (built in from v1).

### M6 — Packaging & integration

- [ ] Bundle Pi (`bun build --compile`) + ship with the app.
- [ ] End-to-end happy path (the design's flight-booking flow) on a real site.
- [ ] Release pipeline (DMG + update feed) wiring the M5 signing/Sparkle setup.

## Non-goals (scope guardrails)

To keep us from "going elsewhere," fAIry explicitly does **not** aim to:

- **Ship a browser.** We drive the user's existing Chrome via an extension; we
  do not build or fork a browser engine (that was the POC's approach).
- **Replace Pi.** Pi is the agent runtime; we orchestrate and host it, we don't
  reimplement an agent loop or LLM client.
- **Be cross-platform-first.** macOS is the first-class shell target. Linux/
  Windows daemon support is incidental (the code stays portable, but no native
  shell for them in v1).
- **Build a general plugin/extension marketplace**, multi-user/cloud sync, or a
  mobile client.
- **Port the POC's prototype scaffolding** — the fake browser, demo flight site,
  and live "Tweaks" design editor are not shipped (a dev harness replays states).
- **Add browser-automation surface beyond what the agent needs** — no general
  scraping framework, no record-everything; tools exist to serve agent tasks.
- **Gold-plate before the design is proven** — modules land design-agnostic and
  TDD'd; protocol shapes (bridge tools, daemon API) are decided at their
  milestone, not speculatively up front.

## Decision log

| Date | Decision |
| --- | --- |
| 2026-06-01 | Three components: Chrome extension + Bun pi-daemon + Swift macOS shell; Bun-workspaces monorepo. |
| 2026-06-01 | Native shell = Swift menu-bar app (over Tauri / Electron / Bun-native). |
| 2026-06-01 | agent-panel built as a controlled, presentational React package driven by a typed beat model. |
| 2026-06-02 | Trunk is `main`. Workflow: feature branch → PR → simplify/review → fix comments → wait for bot reviews → merge. |
| 2026-06-02 | Daemon spawns Pi through `node:child_process` (Bun node-compat), not `Bun.spawn`. |
| 2026-06-02 | **v1 scope set**: all 27 browser tools; daemon API = WebSocket (stream + bridge) + HTTP (settings/status); per-session token + one-time pairing auth; one conversation on the active tab; provider config via a **native macOS Settings UI from the tray**; shell **code-signed + notarized + Sparkle auto-update from v1**. |
