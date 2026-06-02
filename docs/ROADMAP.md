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
| `pi-daemon` | `piSession` — Pi RPC over the transport (typed `AgentEvent` stream) | ✅ merged (#7) |
| `pi-daemon` | `piConfig` — `settings.json`/`auth.json` writer (atomic, `0600`) | ✅ merged (#8) |
| `pi-daemon` | `bridge` — `ToolRequest`/`ToolResponse` + `RequestCorrelator` | ✅ merged (#10) |
| `pi-daemon` | `authenticatedSession` + `bridgeSession` — token handshake base + bridge session | ✅ merged (#11, #17) |
| `pi-daemon` | `wsServer` + `bridgeServer` — generic loopback WS server + bridge adapter | ✅ merged (#12, #18) |
| `pi-daemon` | `beatMapper` — `AgentEvent` → panel beats | ✅ merged (#14) |
| `pi-daemon` | `conversation` + `conversationSession` — controller + WS endpoint logic | ✅ merged (#15, #16) |

**M1 (daemon core) complete** (`paths` → `ndjson` → `jsonLineProcess` →
`piSession` → `piConfig`). **M2 transport complete** and **M3 logic complete**
(`bridge`/sessions/servers, `beatMapper`, `conversation`/`conversationSession`).
Remaining daemon work is integration/wiring — see M2/M3 below (150+ pi-daemon tests).

## Milestones

### M1 — Daemon core ✅

- [x] Isolated paths (`paths.ts`)
- [x] NDJSON framing (`ndjson.ts`)
- [x] Subprocess transport (`jsonLineProcess.ts`)
- [x] **`PiSession`** — Pi RPC over `JsonLineProcess`: prompt/abort/compact;
      `message_update` (text deltas) / `tool_execution_*` / `turn_end` /
      `agent_end` translated to a typed `AgentEvent` stream; "already processing"
      steer-retry + error/auto-retry handling; hardened against malformed output.
- [x] **Pi config writer** (`piConfig.ts`) — atomic `settings.json` / `auth.json`
      under `piAgentDir`; multi-provider, keys trimmed, secrets `0600`. (v1 owns
      the dir wholesale; the POC's sidecar-reconcile + custom base-URLs deferred.)

### M2 — Browser bridge

- [x] **Bridge protocol types** — `ToolRequest` / `ToolResponse` (#10).
- [x] **`RequestCorrelator`** — request/response correlation, timeouts, reject-all (#10).
- [x] **`BridgeSession`** — authenticated connection (token-first, auth timeout) (#11).
- [x] **`BridgeServer`** — loopback adapter over the generic `wsServer` + Origin check (#12, #18).
- [x] **Shared infra** — `authenticatedSession` (token-handshake base, #17) and
      `wsServer` (generic ws accept/lifecycle/origin, #18), reused by both sessions/servers.
- [x] **Pi browser extension** — `pi-extension/browser-bridge.ts`, the self-contained
      `-e` script registering all ~40 `browser_*` tools; each forwards over loopback
      TCP (token-line auth) to the daemon's new **`PiBridgeServer`**, which relays the
      call to the active Chrome `BridgeSession` (the executor) — closing the Pi → bridge
      loop. `createDaemon` wires it in and spawns Pi pointed at the piBridge via env.
      Integration-tested: real `pi --mode rpc -e` load smoke test + an end-to-end relay
      (Chrome WS executor ⟷ daemon ⟷ Pi TCP requester).

> The **27 tool handlers** are extension-side (M4), not daemon work — the bridge
> is generic (`ToolRequest`/`ToolResponse`).

### M3 — Daemon ↔ clients API (detailed)

- [x] **`AgentEvent` → beat mapper** (`beatMapper`, #14) — `PiSession` events →
      panel beats (text deltas buffered → `say`; tools → `actGroup`+`act`;
      `turn_end` → `status`). **Deferred:** v1 attributes all beats to one agent
      (`sage`); multi-agent attribution needs Pi sub-agents or a tool→agent heuristic.
- [x] **Conversation controller** (`conversation`, #15) — owns a `PiSession`,
      pipes mapped beats out; `start`/`stop` (v1: pause/take-over map to stop).
- [x] **WS conversation endpoint** (`conversationSession`, #16) — token handshake,
      commands in / beats out, driving the controller; served via `wsServer`.
- [x] **HTTP settings/status** (`httpServer`) — loopback `node:http` control plane:
      `GET /status`, `GET /settings` (redacted — `redactConfig` collapses each
      key to a `hasKey` flag, secrets never leave the daemon), `PUT /settings`
      (replace, persisted via an injected `SettingsStore`). Bearer-token auth +
      the shared `isAllowedOrigin` guard (extracted from `wsServer`).
- [x] **Token mint + file surface** (`tokenStore`) — per-session 256-bit
      base64url token (`mintToken`); atomically written `0600` to `token.json`
      under `appData` (`writeToken`) for the trusted shell to read and inject.
      Shares the atomic-write helper with `piConfig` via `fsAtomic`.
- [ ] **Extension pairing handshake** — the untrusted Chrome extension can't read
      `token.json`, so it redeems a short-lived, single-use pairing code to obtain
      the token. Needs a client-facing entry point → builds on the HTTP endpoint
      above; the WS auth handshake itself already exists (`authenticatedSession`).
- [x] **Daemon entry wiring** (`daemon` + `main`) — `createDaemon` composes the
      `BridgeServer`, the new `ConversationServer` (`WsServer` + `ConversationSession`
      + `ConversationController`), and the `HttpServer` under one token/Origin policy;
      `createFileSettingsStore` persists a canonical `config.json` and materializes
      Pi's `settings.json`/`auth.json`. `main.ts` mints+surfaces the token, spawns
      real `pi --mode rpc -e <browser-bridge>`, and installs `SIGINT`/`SIGTERM`
      shutdown. *(Pi → bridge tool routing now closed via the Pi extension above.)*
- [ ] **Lifecycle** — single-instance lock, fuller graceful shutdown (basic
      signal-driven `close()` landed with the wiring above).

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
