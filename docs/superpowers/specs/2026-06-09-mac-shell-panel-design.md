# macOS shell — WKWebView conversation panel — design

**Status:** approved (design phase) · **Date:** 2026-06-09 · **Component:** `packages/mac-shell` (extends M5-1/2/3) + `packages/agent-panel` (new shell host) · **Builds on:** the daemon's conversation WS + `GET /info`, and the M5-1 token/transport plumbing · **Part of:** M5 (macOS shell), sub-project 4 of 5.

## Context

The daemon serves a **conversation WebSocket** (ephemeral port, discovered via the bearer-authenticated `GET /info` → `{ bridgePort, conversationPort }`). A client connects to `ws://127.0.0.1:<conversationPort>`, sends `{ type: "auth", token }` as the first frame, then receives `{ type: "beat", beat }` frames and sends `{ type: "start", task }` / `{ type: "stop" }` / `{ type: "resolveProposal", proposal, accept }`. The Chrome side-panel already consumes this (`packages/extension/src/conversationClient.ts`) and renders it with the React `@fairy/agent-panel` library.

M5-1/2/3 gave the shell a menu-bar app, the pairing surface, and a native Settings window. This sub-project adds a **native conversation panel**: a WKWebView hosting the same `agent-panel`, wired to the daemon's conversation WS, opened from the status menu.

## Goal & non-goals

**Goal:** an "Open Panel" status-menu item opens a window hosting the real `agent-panel` (feed, A2UI, proposal cards, saved-action chips), driven by **its own** conversation over the WS. Start/stop a turn and resolve save-proposals from the native window.

**Non-goals (this sub-project):** mirroring the *extension's* conversation (each WS connection is its own session — cross-session beat broadcast would be a daemon change); Chrome tab-binding from the native shell (it has no tabs — see below); making the panel the primary window or a tray-toggle (it's a menu-opened window, like Settings); the packaging/build-pipeline formalization (M6).

**Known limitation (documented, not solved here):** the native shell can't bind a Chrome tab. Browser tools relay to whatever tab the *extension* bound; a browser task started from the native panel with no extension-bound tab returns the daemon's "no tab bound", surfaced as an error beat. `start`/run-action from the native host therefore just send the task (no `chrome.*` tab-binding, unlike the extension's panel host).

## Decisions (and why)

1. **The native process owns the WS; the WebView is a pure renderer.** The daemon's `isAllowedOrigin` gate **allows a missing Origin** (native clients) but **rejects the `"null"` origin** that a WKWebView's local content (`file://` / custom scheme) presents, and rejects `http(s)://`. So a WebView opening the WS directly would be origin-blocked. A native `URLSessionWebSocketTask` sends no Origin → passes. This also keeps the **token** out of the sandboxed WebView (only the native side reads `token.json`). Beats flow native→JS via `evaluateJavaScript`; commands flow JS→native via `WKScriptMessageHandler`. This mirrors the daemon↔extension trust split: transport/trust in the privileged process, rendering in the sandbox.
   - Rejected: the WebView opens the WS itself (needs a daemon `allowedOrigins` change + a custom `WKURLSchemeHandler` for a stable non-null origin + the token injected into JS — more moving parts, weaker security). Rejected: reimplement the panel in SwiftUI (discards the entire tested `agent-panel`).
2. **Reuse `agent-panel` via a thin shell host.** The panel is a React library (`Panel` + `usePanelController` + `controller.apply(beat)`); a small `shell/main.tsx` mounts it and adapts it to the native bridge (`window.__fairyBridge`). A tested `nativeBridge.ts` unit holds the command-encoding logic; the entry + DOM wiring is glue (coverage-excluded, like the existing `main.tsx`).
3. **Bundle a built panel into the shell's Resources.** A `build:shell` vite target emits a self-contained bundle, copied to `packages/mac-shell/Sources/fairy-shell/Resources/panel/` and bundled via SPM `resources: [.copy("Resources/panel")]`; the WebView `loadFileURL`s it. The built bundle is committed so `swift build` stays hermetic (no node in the Swift build); a regen script rebuilds it, and M6 formalizes the pipeline. (Alternative — load agent-panel's dev server in dev — splits dev/release behavior.)
4. **A menu-opened singleton window**, same pattern as the M5-3 Settings window (re-focus if already open; closing leaves the daemon + tray running).

## Architecture & components

In `packages/mac-shell/`:

**`Sources/FairyShell/` (new, TESTED):**

- **`InfoModels.swift`** — `DaemonInfo { bridgePort: Int, conversationPort: Int }` (Decodable), decoded from `GET /info`.
- **`InfoClient.swift`** — `func fetch() async -> Result<DaemonInfo, SettingsError>`; reads the token via `TokenReader`, bearer `GET /info`, decodes. Reuses the existing `SettingsError` taxonomy (`unreachable`/`unauthorized`/`server`/`decode`) and the `HTTPTransport.get` seam.
- **`ConversationSocket.swift`** — `protocol ConversationSocket: Sendable` with `connect()`, `send(_ text: String)`, `onText(_:)`, `onOpen(_:)`, `onClose(_:)`, `close()` — the injectable WS seam.
- **`ConversationClient.swift`** — the pure protocol logic over an injected `ConversationSocket`: on open, send `{type:"auth",token}` first, then flush a pre-open send queue; decode inbound frames and call a `onBeat: (String) -> Void` for `{type:"beat",beat}` (the beat is passed through as raw JSON for the WebView); `start(_ task:)`, `stop()`, `resolveProposal(_ json:)` encode outbound frames (queued before open). Token via `TokenReader`. Mirrors `connectConversation`'s auth-first + queue semantics.

**`Sources/fairy-shell/` (glue, coverage-excluded):**

- **`URLSessionConversationSocket.swift`** — `ConversationSocket` via `URLSessionWebSocketTask` (receive loop → `onText`; `send` over the task).
- **`PanelBridge.swift`** — an `NSObject & WKScriptMessageHandler` (`@MainActor`) that: receives JS command messages (`{type:"start"|"stop"|"resolveProposal", …}`) and forwards to the `ConversationClient`; exposes `deliver(beatJSON:)` → `webView.evaluateJavaScript("window.__fairyBridge.onBeat(<json>)")` (the beat JSON is a literal, safely encoded).
- **`PanelWindowController.swift`** — `@MainActor`, owns the `NSWindow` + `WKWebView` (+ `WKUserContentController` registering `PanelBridge` under the `"fairy"` handler name), loads the bundled `index.html` via `loadFileURL`, and on open runs `InfoClient.fetch()` → builds the `ConversationClient` (URLSession socket) → connects. Singleton; shows a native "couldn't reach the daemon" overlay with Retry when connect fails.
- **`URLSessionConversationSocket`/`InfoClient`** are constructed with the shared `baseURL`/`tokenURL`/`appData` from `AppDelegate` (already centralized in M5-3).
- **`AppDelegate.swift`** — an **"Open Panel"** menu item (above Settings) owning the `PanelWindowController`.
- SPM **`Package.swift`** — add `resources: [.copy("Resources/panel")]` to the `fairy-shell` target.

In `packages/agent-panel/`:

- **`src/shell/nativeBridge.ts`** (new, TESTED) — `createNativeBridge(post: (msg: unknown) => void)` → `{ start(task), stop(), resolveProposal(json) }`, each calling `post` with a typed command; plus a registration helper so the host can route `window.__fairyBridge.onBeat` into `controller.apply`. Pure; the actual `webkit.messageHandlers` access lives in the entry.
- **`src/shell/main.tsx`** + **`src/shell/index.html`** (new, glue) — mounts `Panel` + `usePanelController`; sets `window.__fairyBridge.onBeat = (beat) => controller.apply(beat)`; wires panel `onSend`/`onStop`/proposal-resolve through `createNativeBridge(msg => window.webkit.messageHandlers.fairy.postMessage(msg))`.
- **`vite.shell.config.ts`** + a `build:shell` script — builds `src/shell/index.html` to a self-contained `dist-shell/`, then a step copies it into the mac-shell Resources. Coverage config excludes `src/shell/main.tsx` (like `src/main.tsx`).

## Data flow

```text
Open Panel → PanelWindowController shows the window, loads bundled index.html
  InfoClient.fetch() → conversationPort       (token.json → GET /info)
  ConversationClient.connect(ws://127.0.0.1:<port>, token)
     → sends {type:auth,token}, then streams beats

  daemon beat  ──WS──▶ ConversationClient(onBeat) ──▶ PanelBridge.deliver
     → webView.evaluateJavaScript("window.__fairyBridge.onBeat(<beatJSON>)")
     → controller.apply(beat)  → panel renders

  panel action (start/stop/resolve)
     → window.webkit.messageHandlers.fairy.postMessage({type,…})
     → PanelBridge → ConversationClient.start/stop/resolveProposal
     → {type:start,task} / {type:stop} / {type:resolveProposal,…} ──WS──▶ daemon
```

The native panel runs its own conversation; `start`/run-action only send the task (no `chrome.*`), so a browser tool with no extension-bound tab returns "no tab bound" as an error beat.

## Error handling

- `token.json` missing / `GET /info` fails / WS won't open → a native overlay "Couldn't reach the daemon — is it running?" with **Retry** (the panel content stays hidden until connected), not a dead WebView.
- WS closes mid-session → the overlay returns with Retry; the daemon closes on bad auth (no `auth_ok` wait, matching the extension client).
- Malformed inbound frames are ignored; the beat JSON injected via `evaluateJavaScript` is a JSON-encoded literal (no interpolation of raw text), so it can't break out of the call.
- The token never enters the WebView — only the native side reads it and owns the socket.

## Testing

`FairyShell` (TDD'd, ≥90% holds):
- **`InfoClient`** (fake transport): `fetch` 200 → `DaemonInfo`; 401 → `.unauthorized`; other non-200 → `.server`; transport nil / missing token → `.unreachable`; bad body → `.decode`; hits `…/info` with the bearer.
- **`ConversationClient`** (fake `ConversationSocket`): auth frame is sent first on open; `start`/`stop`/`resolveProposal` issued before open are queued and flushed (after auth) on open; inbound `{type:"beat",beat}` → `onBeat` with the raw beat JSON; a non-beat / malformed frame → ignored; `close` stops sends.
- **`InfoModels`** decode (with the two ports).

`agent-panel` (vitest, ≥90% holds):
- **`nativeBridge.ts`** (fake `post`): `start("x")` posts `{type:"start",task:"x"}`; `stop()` posts `{type:"stop"}`; `resolveProposal(json)` posts `{type:"resolveProposal",…}`; the `onBeat` registration routes a delivered beat to the handler.

Glue — `URLSessionConversationSocket`, `PanelBridge`, `PanelWindowController`, the WebView, and `src/shell/main.tsx` — is runtime-verified by launching (Open Panel → start a task → watch beats render; daemon-down → the Retry overlay), not unit-tested (consistent with M5-1/2/3 and agent-panel's `main.tsx`).

## Sequencing

M5 sub-project 4 (this). The plan may split into two PRs: **(4a)** the native transport (`InfoClient` + `ConversationClient` + URLSession socket), tested, no UI; **(4b)** the WebView host + the `agent-panel` shell build + bridge + menu wiring. Next: **(5) packaging** (sign/notarize/Sparkle/login-item; formalizes the panel build pipeline). A future enhancement: a daemon broadcast so the native panel can *mirror* the extension's live conversation, and a cross-surface tab-binding handshake so a natively-started task can drive the extension's tab.
