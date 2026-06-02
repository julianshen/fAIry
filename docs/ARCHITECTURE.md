# fAIry — Architecture

> Status: living document. Captures decisions made so far; sections marked
> **(open)** are not yet decided — don't treat them as settled.

## 1. What fAIry is

A browser agent you talk to. **Fairy** pairs a Chrome extension with a local,
standalone agent daemon so a team of specialist agents can perceive the page,
drive it, read it, and fill things in — while you watch and stay in control.

It is the production reimplementation of an earlier Electron proof-of-concept
(*Horizon Browser*, at `../mybrowser`). Instead of shipping a whole browser,
fAIry runs as three cooperating processes on the user's machine.

The product identity is a **multi-agent team**, not a single chatbot: four named
specialists hand work off to each other, visibly.

| Agent | Role | Does |
| --- | --- | --- |
| **Shaka** | Orchestrator | Reads the goal, writes the plan, routes each step |
| **Atlas** | Navigator | Opens pages, clicks, scrolls, applies filters |
| **Pythagoras** | Reader | Scans the DOM, extracts/ranks structured data |
| **Edison** | Operator | Fills forms, completes flows, pauses for anything sensitive |

## 2. System overview

Three components, all talking over `localhost`. A Bun-workspaces monorepo
(`packages/*`).

```
┌─────────────────────┐     localhost      ┌──────────────────────┐
│  Swift menu-bar app │◄──── HTTP/WS ──────►│   pi-daemon (Bun)    │
│  • tray icon        │                     │  • spawns pi --rpc   │
│  • login-item launch│                     │  • bridge server     │
│  • WKWebView:       │                     │  • app-local workspace│
│    Settings + Chat  │                     │  • multi-provider cfg │
│  • manages daemon   │                     └──────────┬───────────┘
└─────────────────────┘                                │ localhost WS
                                            ┌───────────▼───────────┐
                                            │   Chrome extension    │
                                            │  • chrome.debugger/   │
                                            │    tabs/scripting     │
                                            │  • executes browser   │
                                            │    tools on live tab  │
                                            │  • hosts Fairy panel  │
                                            └───────────────────────┘
```

| Component | Stack | Package | Responsibility |
| --- | --- | --- | --- |
| **Chrome extension** | TypeScript (MV3) | `chrome-extension` *(planned)* | The browser surface. Executes agent actions on the live tab via `chrome.debugger` / `chrome.tabs` / `chrome.scripting`. Hosts the Fairy agent panel UI. |
| **pi-daemon** | Bun + TypeScript | `pi-daemon` | Standalone local agent. Spawns the Pi coding agent (`pi --mode rpc`), bridges browser tools, owns an app-local workspace + isolated config, supports multiple providers/models. Launched at login. |
| **macOS shell** | Swift | *(planned)* | Menu-bar tray app. Manages the daemon lifecycle and hosts native (WKWebView) Settings + Conversation windows. |
| **agent-panel** | React + TS | `agent-panel` | The conversation/activity UI (header + feed + composer), consumed by the extension and the native Conversation window. **Built.** |

## 3. The Pi agent

The agent runtime is **Pi** (`@earendil-works/pi-coding-agent`), run as a
subprocess in `--mode rpc`. It speaks newline-delimited JSON over stdin/stdout:

- We send: `{"type":"prompt","message":"…"}`, `{"type":"abort"}`, `{"type":"compact"}`, …
- Pi emits: `agent_start`, `message_update` (text deltas), `tool_execution_start`,
  `tool_execution_end`, `turn_end`, `agent_end`, `extension_ui_request`, …

Pi's built-in tools run *inside* Pi. To expose the browser as agent tools, a Pi
extension (loaded via `-e`) registers a `browser` tool that bridges back to the
daemon — which forwards to the Chrome extension. (This is the prod evolution of
the POC's `pi-extension/horizon-bridge.ts`.)

## 4. Key flows

### 4.1 Conversation

```
user types in panel ─▶ daemon ─▶ pi (prompt) ─▶ event stream ─▶ daemon ─▶ panel beats
```

The panel renders a stream of **beats** (`say` / `plan` / `act` / `handoff` /
`confirm` / `takeover` / …). Pi's event stream maps onto this beat model, so the
panel is driven identically whether by the live daemon or (in dev) a script.

### 4.2 Browser tool execution

```
pi calls browser tool ─▶ pi-extension ─▶ daemon bridge ─▶ Chrome extension
   ─▶ chrome.debugger/tabs/scripting on the live tab ─▶ result ─▶ back up the chain
```

The bridge is the load-bearing **seam**: Pi only knows "there's a browser tool
server." Swapping the POC's Electron `BrowserView` for the user's real Chrome
means reimplementing only the *backend* of that seam (the extension), not Pi or
the tool protocol.

### 4.3 Control & safety

The user can **pause**, **take over** the browser, or **confirm/decline**
sensitive steps from the panel at any time. Risky tools (anything
state-mutating) are gated; payment and similar always hand control back.

## 5. Protocols & seams

| Seam | Shape | Status |
| --- | --- | --- |
| **NDJSON framing** | one JSON value per line; partial-line buffering, CRLF, blank-line skipping | **Built** (`pi-daemon/ndjson.ts`) |
| **Subprocess transport** | write values to stdin / receive parsed values from stdout; lifecycle | **Built** (`pi-daemon/jsonLineProcess.ts`) |
| **Pi RPC** | prompt/abort/compact ⟷ agent/tool/turn events | **(open)** — `PiSession`, next |
| **Browser bridge** | `ToolRequest {id, tool, args}` ⟷ `ToolResponse {id, ok, result?, error?}` | **(open)** — daemon ↔ extension |
| **Panel beat model** | typed `Beat` / `FeedItem` reducer | **Built** (`agent-panel/engine.ts`) |
| **Daemon ↔ shell/extension API** | localhost HTTP/WS — conversation I/O, settings, status | **(open)** |

## 6. Isolation & configuration

A hard requirement: the daemon must **not** touch the user's global `~/.pi`.

- **Workspace + config** live under a per-OS app-data directory
  (`pi-daemon/paths.ts`): macOS `Application Support/fAIry`, Windows `%APPDATA%`,
  else XDG. `FAIRY_HOME` overrides. `piAgentDir` → `PI_CODING_AGENT_DIR`.
- **Multiple providers/models** are configured per-instance via Pi's
  `settings.json` / `auth.json` under `piAgentDir` (evolution of the POC's
  `PiConfigWriter`). Secrets are written `0600`. **(open: provider-config UX/API.)**
- The daemon is **launched at login** (macOS LaunchAgent, managed by the shell).

## 7. Reuse from the Horizon POC

| POC piece | Prod role |
| --- | --- |
| `PiSession` (spawn `pi --mode rpc`, JSON-line RPC) | Reused/ported on top of `JsonLineProcess` |
| `PiConfigWriter` / `piConfig` (settings/auth, multi-provider) | Reused — gives isolated config + provider switching |
| `HorizonBridgeServer` (loopback JSON-line tool server) | Adapted — browser backend becomes the Chrome extension |
| `pi-extension/horizon-bridge.ts` (Pi-side tool registration) | Reused/adapted |
| The agent-panel design | **Ported** to `packages/agent-panel` |

## 8. Conventions

See [`CONTRIBUTING`/README] and project memory. In short: **Bun** toolchain;
**TDD** (red→green→refactor); **≥90% coverage** enforced per package; all work on
**feature branches via PRs** into `main`; pure/injectable design for testability
(`resolvePaths`, `JsonLineProcess`'s injected spawner) is the house style.

## 9. Open questions (to resolve before the relevant milestone)

- **Bridge protocol**: exact tool set and `ToolRequest`/`ToolResponse` schema for
  the Chrome-extension backend (the POC had 27 tools; which ship in v1?).
- **Daemon ↔ clients API**: HTTP vs WebSocket; endpoints for conversation,
  settings, status, multi-session.
- **Provider/model config**: the settings UX and the daemon API behind it.
- **Extension ↔ daemon auth**: loopback is OS-isolated, but do we need a
  per-session token to stop other local apps connecting?
- **Multi-tab / multi-session**: one conversation per tab? per window? global?
- **Swift shell specifics**: LaunchAgent install, auto-update, code-signing.
- **Pi `extension_ui_request`** handling (dialogs/confirms) in the prod UI.
