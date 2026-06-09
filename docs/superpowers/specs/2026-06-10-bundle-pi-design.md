# Bundle the Pi agent (M6-1) — design

**Status:** approved (design phase) · **Date:** 2026-06-10 · **Component:** `packages/pi-daemon` + `packages/mac-shell` · **Builds on:** the bundled `Fairy.app` (M5-5a) + the release pipeline (M5-5c) · **Part of:** M6 (packaging & integration), sub-project 1 of 3.

## Context

The shipped `Fairy.app` bundles the daemon (`fairy-daemon`) but still spawns the external **Pi agent** as a bare `spawn("pi", …)` resolved on `PATH` — so the released app is not self-contained (the user must `npm i -g @earendil-works/pi-coding-agent`). Pi is `@earendil-works/pi-coding-agent` v0.78.1, an **MIT-licensed Node CLI** (`#!/usr/bin/env node`), 151 MB installed (138 MB of `node_modules`, 17 deps). A derisk confirmed `bun build --compile` turns its `dist/cli.js` into a **running 68 MB self-contained binary** (no `node` needed). This sub-project bundles that compiled Pi into the `.app` and points the daemon at it.

## Goal & non-goals

**Goal:** the `.app` ships a `fairy-pi` binary (Pi, `bun --compile`d) and the daemon spawns it via a `FAIRY_PI_BIN` override, so a packaged app needs no external `pi` on `PATH`. Pi's version is pinned via a devDependency for reproducible builds; its MIT attribution is bundled.

**Non-goals (→ M6-2 / M6-3):** an end-to-end agent conversation against a real site (M6-2 — that's where the *compiled* Pi's full functionality is exercised with credentials); the CI release workflow (M6-3); bundling `node` (only needed if the compiled-Pi fallback is taken).

**Verification boundary:** verified here — the `FAIRY_PI_BIN` resolution (`resolveAssetPath`, already tested), the new `DaemonLocator` env entry (Swift unit test), `build:pi` producing a `fairy-pi` that **launches**, and `package.sh` bundling it (structural). NOT verified here — a full Pi `--mode rpc` agent turn from the *compiled* binary (needs LLM credentials + the live daemon/bridge), which is the **M6-2 end-to-end smoke**. The derisk's `--version` → `0.0.0` (Pi resolves its version from a runtime file `bun --compile` doesn't embed) is harmless for the daemon (it never reads Pi's version) but flags that a bun-compiled third-party app can lose runtime-resolved assets; if M6-2 finds the compiled Pi missing something, the documented fallback is bundling Pi's package + a `node` runtime.

## Decisions (and why)

1. **bun-compile Pi into one `fairy-pi` binary** (derisk-proven), mirroring how the daemon was bundled in 5a. ~68 MB, no `node` dependency. Rejected: ship Pi's 151 MB package + a `node` runtime (heavier, ~250 MB — the *fallback* only if the compiled Pi proves functionally broken); keep Pi a `PATH` prerequisite (not self-contained — the status quo this sub-project removes).
2. **Pin Pi via a `devDependency`, build from `node_modules`.** Adding `@earendil-works/pi-coding-agent@0.78.1` as a pi-daemon devDependency makes `build:pi` reproducible (the exact version is installed locally) rather than depending on whatever global `pi` a build machine happens to have.
3. **Reuse `resolveAssetPath` + `DaemonLocator` for the Pi-binary override.** `FAIRY_PI_BIN` is exactly the relocatable-asset pattern already built and tested in 5a (`FAIRY_BROWSER_BRIDGE`/`FAIRY_SKILLS_ROOT`). The daemon reads `resolveAssetPath(process.env, "FAIRY_PI_BIN", "pi")`; the shell's `DaemonLocator` sets it to the bundled path. No new mechanism. Dev (`bun run`) is unchanged — the default is `"pi"` on `PATH`.
4. **Bundle the MIT attribution.** Pi is MIT (redistribution permitted with the license + copyright notice). The package ships no `LICENSE` file, so `package.sh` writes a `THIRD-PARTY-LICENSES.txt` into the `.app` with Pi's MIT text + copyright.

## Architecture & components

**`packages/pi-daemon/`:**
- **`package.json`** (modify) — add `"@earendil-works/pi-coding-agent": "0.78.1"` to `devDependencies`; add a script `"build:pi": "bun build node_modules/@earendil-works/pi-coding-agent/dist/cli.js --compile --outfile dist/fairy-pi"`.
- **`src/main.ts`** (modify) — `const PI_BIN = resolveAssetPath(process.env, "FAIRY_PI_BIN", "pi")` (the helper from 5a), and `piSpawner` spawns `PI_BIN` instead of the literal `"pi"`. No behavior change without the env (default `"pi"`).

**`packages/mac-shell/`:**
- **`Sources/FairyShell/DaemonLocator.swift`** (modify) — the bundled-config `environment` gains `"FAIRY_PI_BIN": resources.appendingPathComponent("fairy-pi").path`, alongside the existing `FAIRY_BROWSER_BRIDGE`/`FAIRY_SKILLS_ROOT`. (Dev config still has an empty environment.)
- **`Tests/FairyShellTests/DaemonLocatorTests.swift`** (modify) — assert the bundled config's `FAIRY_PI_BIN` = `…/Contents/Resources/fairy-pi`.
- **`scripts/package.sh`** (modify) — before assembling: `( cd pi-daemon && bun run build:pi )`; copy `packages/pi-daemon/dist/fairy-pi` → `Contents/Resources/fairy-pi` (chmod +x); write `Contents/Resources/THIRD-PARTY-LICENSES.txt` (Pi's MIT notice).

## Data flow

```text
build:pi (pi-daemon):  bun build node_modules/@earendil-works/pi-coding-agent/dist/cli.js
                       --compile → packages/pi-daemon/dist/fairy-pi (~68 MB)
package.sh:            cp fairy-pi → Fairy.app/Contents/Resources/fairy-pi (+ THIRD-PARTY-LICENSES.txt)
runtime (bundled):     DaemonLocator → daemon env FAIRY_PI_BIN = …/Resources/fairy-pi
                       main.ts: spawn(PI_BIN=…/Resources/fairy-pi, "--mode","rpc","-e",<bundled bridge>)
                       → no external `pi` on PATH needed → self-contained
runtime (dev):         FAIRY_PI_BIN unset → PI_BIN="pi" → spawn("pi") on PATH (unchanged)
```

## Error handling

- **Dev unaffected** — with no `FAIRY_PI_BIN`, `resolveAssetPath` returns `"pi"`; the daemon spawns the PATH Pi exactly as today.
- **Missing `fairy-pi` at build time** — `package.sh` fails fast (set -euo pipefail) if `bun run build:pi` didn't produce `dist/fairy-pi`.
- **Compiled-Pi runtime gaps** — if M6-2's end-to-end finds the compiled Pi missing a runtime asset (the `0.0.0` version is the known-harmless instance), the fallback is the ship-package+node approach; this is an M6-2 finding, not an M6-1 blocker.

## Testing

- **`DaemonLocator`** (XCTest) — extend the existing bundled-present test to assert `cfg.environment["FAIRY_PI_BIN"] == "/App/Contents/Resources/fairy-pi"`; the dev tests still assert an empty environment.
- **`resolveAssetPath` for `PI_BIN`** — covered by the existing `assetPath.test.ts` (the helper is unchanged); the `main.ts` wiring is entry glue (coverage-excluded), exercised by the daemon's existing real-`pi` smoke (which now resolves via the helper, default `"pi"`).
- **`build:pi`** — run it; assert `dist/fairy-pi` exists, is executable, and `--version` runs (launch check; the derisk confirmed this).
- **`package.sh`** — re-run; assert `Contents/Resources/fairy-pi` present + executable and `THIRD-PARTY-LICENSES.txt` present.
- The mac-shell Swift suite + the pi-daemon vitest suite stay green. The **full agent turn** from the compiled binary is the M6-2 smoke, not an M6-1 unit test.

## Sequencing

M6 sub-project 1 (this). Then **M6-2** — the end-to-end happy path on a real site, which runs the bundled (compiled) Pi with real credentials and is the true functional test of this PR's binary. Then **M6-3** — the CI release workflow wiring the M5-5c scripts + GitHub secrets.
