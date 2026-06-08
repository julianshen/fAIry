# macOS shell — tray + daemon lifecycle — design

**Status:** approved (design phase) · **Date:** 2026-06-08 · **Component:** NEW `packages/mac-shell` (Swift / SPM) · **Builds on:** the daemon's loopback HTTP control plane (`GET /status`) + `token.json` + `main.ts` entry · **Part of:** M5 (macOS shell), sub-project 1 of 5.

## Context

The Chrome extension + Bun pi-daemon are complete (M4). M5 adds the **Swift macOS shell**: a menu-bar app that manages the daemon and hosts native Settings + a WKWebView panel. M5 is decomposed into 5 sequenced sub-projects, each its own spec→plan→PR: **(1) tray + daemon lifecycle** (this), (2) pairing surface, (3) native Settings UI, (4) WKWebView conversation panel, (5) packaging (sign/notarize/Sparkle/login-item).

This first slice is the **runnable skeleton**: a menu-bar app that spawns/adopts the daemon, monitors its health via `GET /status`, surfaces running/starting/failed in the menu, and stops it on quit — the foundation the later sub-projects build on (mirrors how M4 started with scaffold + a thin vertical slice).

## Goal & non-goals

**Goal:** launching the app shows a menu-bar item that brings the daemon up (spawning it, or adopting an already-running one), reflects its health, offers Restart, and cleanly stops the daemon on Quit.

**Non-goals (this sub-project):** the pairing-code display, Settings UI, the WKWebView conversation panel, login-item, and code-signing/notarization/Sparkle (later M5 sub-projects / M6). A shipped bundled-daemon binary is M6; here the daemon launch is the dev command (`bun` + the pi-daemon entry), configurable.

## Decisions (and why)

1. **Swift Package Manager, library + executable split.** A `FairyShell` **library target** holds the testable logic (lifecycle state machine, status client); a thin `fairy-shell` **executable target** holds the AppKit glue (`NSApplication` accessory + `NSStatusItem`). `swift test --enable-code-coverage` runs headlessly — ideal for TDD + the ≥90% gate on the library; the AppKit/Process glue is coverage-excluded (mirrors the TS convention: pure logic tested, `chrome.*`/`main.ts` excluded). A signed `.app` bundle is assembled at packaging (M5-5/M6); SPM emits a raw binary, which is fine for dev.
2. **Dependency-injected `DaemonController` state machine.** The launcher (`DaemonLauncher`) and the health probe (`StatusClient`) are protocols injected into `DaemonController`, plus an injected clock for polling — so the state machine is fully unit-tested without spawning processes or real HTTP. Real implementations (`Process`-based launcher, `URLSession`-based client) are thin glue.
3. **Adopt-or-spawn.** On `start()`, first probe `/status`; if a daemon is already healthy (e.g. started manually, or a prior shell), **adopt** it (state `.running`, do not spawn) rather than fight the daemon's single-instance lock (`daemon.lock`); otherwise launch and poll.
4. **Read `token.json` for `/status`.** `/status` is bearer-authenticated (only `POST /pair` is unauthenticated). The daemon writes `token.json` for the trusted local shell; `StatusClient` reads it and sends `Authorization: Bearer`. `token.json` appears shortly after spawn, so an early missing/again-unreadable token is treated as "not ready yet" (keep polling), not a failure.

## Architecture & components

New package `packages/mac-shell/` (its own `Package.swift`; not part of the Bun workspace — Bun ignores it):

```
packages/mac-shell/
  Package.swift                       # FairyShell (lib) + fairy-shell (exe) + FairyShellTests
  Sources/FairyShell/                 # TESTED
    DaemonLaunchConfig.swift
    DaemonLauncher.swift              # protocol + ProcessDaemonLauncher (real)
    StatusClient.swift                # token.json + GET /status (transport injected)
    DaemonController.swift            # the state machine (DI'd)
  Sources/fairy-shell/                # GLUE (coverage-excluded)
    main.swift
    AppDelegate.swift                 # NSApplication accessory + NSStatusItem + menu
  Tests/FairyShellTests/
    DaemonControllerTests.swift
    StatusClientTests.swift
```

### Library (tested)

- **`DaemonLaunchConfig`** — `{ executable: String; arguments: [String]; workdir: URL; environment: [String:String] }`. Dev default builds `bun` + the repo's `packages/pi-daemon` entry (`src/main.ts`); HTTP base `http://127.0.0.1:51789`. (The bundled-binary launch is M6.)
- **`DaemonLauncher`** (protocol) — `func launch(_ config: DaemonLaunchConfig) throws -> DaemonHandle`, `func terminate(_ handle: DaemonHandle)`, and an exit signal (`onExit: (DaemonHandle) -> Void` or the handle exposes a termination callback). `ProcessDaemonLauncher` is the Foundation `Process` implementation (real; thin). Tests inject a fake recording launches/terminations and simulating exit.
- **`StatusClient`** — `func probe() async -> DaemonHealth` where `DaemonHealth = .healthy | .unreachable | .unauthorized`. Reads `token.json` from the app-data dir, issues `GET /status` with `Authorization: Bearer <token>`. The transport is injected (`(URLRequest) async -> (Data, HTTPURLResponse)?` or a small `HTTPTransport` protocol) so tests feed canned responses; a missing/unreadable token → `.unreachable` (not-ready). 
- **`DaemonController`** — owns `DaemonState = .stopped | .starting | .running | .failed(String)`; deps: `launcher`, `status` (StatusClient), a `clock`/`sleep` seam, and config. API: `start()`, `restart()`, `stop()`, and `onState: (DaemonState) -> Void`.
  - `start()`: probe `/status` → if `.healthy`, adopt → `.running`. Else `.starting`, `launcher.launch`, then poll `/status` every interval; first `.healthy` → `.running`; spawn throw or `maxStartupPolls` without health → `.failed`; a launcher exit during `.starting`/`.running` → `.failed`.
  - `restart()`: `stop()` then `start()`. `stop()`: terminate the handle (if we spawned it) → `.stopped`. (An adopted daemon is left running on stop — we didn't start it; documented.)

### Executable (glue, coverage-excluded)

- **`main.swift`** — create `NSApplication`, set `.accessory`, instantiate `AppDelegate`, run.
- **`AppDelegate`** — build a `DaemonController` (real launcher + client), set `onState` to update the `NSStatusItem` icon (● running / ◌ starting / ⚠ failed / ○ stopped) and the menu's status line; menu items: status line, **Restart daemon** → `controller.restart()`, **Quit Fairy** → `controller.stop()` then `NSApp.terminate`. Call `controller.start()` on launch.

## Data flow

```text
launch → AppDelegate → DaemonController.start()
   probe GET /status (token.json bearer)
     healthy?  → adopt → .running
     else      → .starting → launcher.launch(config) → poll /status …
                   first healthy → .running
                   spawn fail / timeout / early exit → .failed(reason)
   onState → NSStatusItem icon + menu status line
Quit → controller.stop() → terminate (if spawned) → .stopped → NSApp.terminate
```

## Error handling

- `launcher.launch` throws (e.g. `bun` not found) → `.failed("could not start the daemon: …")`; the menu shows it + Restart.
- `/status` unreachable through `maxStartupPolls` (a bounded count over the injected clock) → `.failed("daemon did not become healthy")`.
- Daemon process exits unexpectedly (while `.starting`/`.running`) → `.failed("daemon exited")`.
- `token.json` missing/unreadable early → `.unreachable` from the probe → keep polling within the startup budget (not an immediate failure).
- `.unauthorized` (token mismatch — stale token vs a different daemon) → `.failed("daemon rejected the shell token")` (rare; surfaced rather than looping).
- Quit always attempts `terminate`; a terminate error is logged, not fatal.

## Testing

`swift test` (XCTest), coverage via `swift test --enable-code-coverage` measured on `FairyShell` (≥90%). The executable target is AppKit glue (runtime-verified by launching the app; not unit-tested) — analogous to the extension's coverage-excluded `background.ts`/`main.tsx`.

- **DaemonControllerTests** (fake launcher + fake StatusClient + injected clock): adopt when `/status` already healthy (no launch); spawn → `.running` on the first healthy poll; spawn throw → `.failed`; `maxStartupPolls` exhausted → `.failed`; unexpected exit → `.failed`; `restart()` re-launches; `stop()` terminates a spawned handle → `.stopped`; `stop()` leaves an adopted daemon running. Assert the `onState` sequence.
- **StatusClientTests** (fake transport + a temp `token.json`): builds `GET /status` with the bearer token; 200 → `.healthy`; 401 → `.unauthorized`; connection error/no token → `.unreachable`.

## Sequencing

M5 sub-project 1 (this). Next: **(2) pairing surface** — surface the pairing code (from `pairing.json`) in the menu so the Chrome extension can pair. Then (3) Settings UI, (4) WKWebView panel, (5) packaging. CI for the Swift package (a `swift test` lane) can be added alongside this sub-project or with packaging.
