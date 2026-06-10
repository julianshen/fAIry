# End-to-end happy path (M6-2) — design

**Status:** approved (design phase) · **Date:** 2026-06-10 · **Component:** `packages/extension/e2e` · **Builds on:** the M4 Playwright pairing E2E, the full tool layer, and M6-1's `FAIRY_PI_BIN` seam · **Part of:** M6 (packaging & integration), sub-project 2 of 3.

## Context

The roadmap's M6 calls for "the design's flight-booking flow on a real site" — an end-to-end run of the whole stack: panel → conversation WS → daemon → Pi → piBridge → bridge WS → extension → CDP → a real page. M4 already built a Playwright E2E harness (`packages/extension/e2e/pairing.spec.ts`) that spawns a real daemon, side-loads the built MV3 extension into Playwright's bundled Chromium, and pairs. M6-1 gave the daemon the `FAIRY_PI_BIN` env seam (it spawns whatever binary that names, exactly as it spawns Pi).

A *full* agent happy path needs an LLM provider key and is inherently non-deterministic (an agent doesn't click the same buttons every run) — unsuitable as a CI gate. But the `FAIRY_PI_BIN` seam permits a **deterministic** companion: a fake Pi that speaks the piBridge protocol and replays a fixed tool script, exercising the entire daemon↔extension↔CDP path with no LLM.

## Goal & non-goals

**Goal:** a deterministic local **demo flight site**, a shared e2e **harness**, and two end-to-end specs through the same seam: **`tools.spec.ts`** (deterministic — a scripted `fake-pi` books a flight on the demo site; runs and passes HERE) and **`agent.spec.ts`** (LLM-gated — the real bundled `fairy-pi` books it from a natural-language task; self-skips without a provider key; the user's credentialed run and the functional validation of M6-1's compiled Pi).

**Non-goals:** a CI release workflow (M6-3); testing against a real *external* website (non-deterministic, rate-limited, fragile — the demo site is the controlled stand-in); multi-turn conversations, proposals, or workflows (the happy path is one task to completion); any daemon or Swift change (M6-2 lives entirely in `packages/extension/e2e/`).

**Verification boundary:** `tools.spec` runs here end-to-end (it self-skips only when the browser cannot side-load the extension — the existing pairing-spec condition). `agent.spec` is authored + self-skipping here (no LLM key in this environment); the user runs it with `FAIRY_E2E_PROVIDER_KEY` to validate the bundled Pi. **Feasibility derisk first:** the plan's first task stands the harness up and round-trips ONE tool call through fake-pi → daemon → extension → CDP before building the full booking script — if bundled Chromium blocks `chrome.debugger`-based tools, that's discovered immediately, not after the fixture is built.

## Decisions (and why)

1. **Drive both specs through `FAIRY_PI_BIN`** — the daemon spawns the named binary with `FAIRY_PI_BRIDGE_PORT`/`FAIRY_PI_BRIDGE_TOKEN` injected, so anything that connects back and speaks the piBridge protocol *is* Pi to the daemon. The deterministic spec points it at a scripted `fake-pi`; the agent spec points it at the bundled `fairy-pi`. One mechanism, two fidelities; zero daemon changes; and the deterministic run also proves the M6-1 spawn path end-to-end. Rejected: a side-channel test API into the daemon (new surface, not production-representative); driving tools directly over the bridge WS from the test (bypasses the daemon's Pi-spawn path — exactly the integration M6-2 should cover).
2. **A local, offline demo flight site as the fixture.** Semantic HTML (labeled from/to/date inputs, Search → fixed results → Select → Book → confirmation with a booking reference), no network, fully reproducible — served by a tiny static server in the harness. Rejected: a real airline site (non-deterministic, anti-bot, slow, ToS-fraught); porting the POC's demo site wholesale (only the minimal page the flow needs — YAGNI).
3. **Extract a shared `_harness.ts` from `pairing.spec.ts`** — serve the fixture, spawn the daemon (per-test env), pair, open the panel page, bind the tab. The pairing spec keeps working on top of it. Rejected: copy-pasting the setup into each spec (three copies of subtle daemon/extension boot logic).
4. **Lenient, slow-tolerant assertions in `agent.spec`** — generous timeout, asserts the *outcome* (the confirmation state) rather than the click path, because LLM runs vary. It is explicitly not a CI gate; `tools.spec` is the deterministic gate.

## Architecture & components

All under `packages/extension/e2e/`:

- **`fixtures/flight-site/index.html` + `fixtures/flight-site/app.js`** — the demo site: a search form (`#from`, `#to`, `#date`, labeled), **Search** reveals a deterministic results list (3 fixed flights), each with a **Select** button → a summary + **Book** button → `#confirmation` with a fixed-format booking reference (`FAIRY-XXXXXX` derived deterministically). Plain DOM, no framework, no network.
- **`_harness.ts`** — exported helpers shared by all specs:
  - `serveFixture(dir) → { url, close }` — `node:http` static server on an ephemeral port.
  - `startDaemon(env) → { home, pairingCode, stop }` — the pairing-spec logic, parameterized with extra env (`FAIRY_PI_BIN`, …).
  - `launchWithExtension() → { context, extensionLoaded }` — the bundled-Chromium side-load + probe.
  - `pairAndOpenPanel(context, code) → panelPage` — drive the options page to pair, then open the side-panel page (`chrome-extension://<id>/src/panel/index.html`) as a tab.
  - `pairing.spec.ts` is refactored onto these helpers (behavior unchanged).
- **`fake-pi.ts`** — the scripted Pi stand-in (run via `bun`): connects to `127.0.0.1:$FAIRY_PI_BRIDGE_PORT`, authenticates with `$FAIRY_PI_BRIDGE_TOKEN` (the same line-framed protocol the real `-e` bridge uses — mirrored from `piBrowserExtension.test.ts` / the `-e` script), then issues the fixed sequence: `browser_navigate(<fixture url>)` → `browser_type(#from, "SFO")` → `browser_type(#to, "JFK")` → `browser_type(#date, …)` → `browser_click(Search)` → `browser_click(first Select)` → `browser_click(Book)`, each awaiting its result; exits 0 on success, non-zero with a message on any failed step. (Exact tool names/arg shapes per the `-e` contract — pinned in the plan from the source.)
- **`tools.spec.ts`** — the deterministic e2e: harness up with `FAIRY_PI_BIN` = a `bun fake-pi.ts` wrapper; send a task from the panel (the task text is ignored by fake-pi — it always books); assert the demo page reaches `#confirmation` with a `FAIRY-` reference, and the panel shows a completed run. Skips only if `!extensionLoaded`.
- **`agent.spec.ts`** — the LLM-gated e2e: requires `FAIRY_E2E_PROVIDER_KEY` (else `test.skip`); writes the key into the daemon's config (the settings store / `PUT /settings`) so Pi can call the LLM; `FAIRY_PI_BIN` = the bundled `packages/pi-daemon/dist/fairy-pi` when present (else PATH `pi`); sends "Book a flight from SFO to JFK on the demo site at <url> and confirm it"; waits (generous timeout, e.g. 5 min) for `#confirmation` to appear. Lenient: outcome-only assertions.
- **`package.json`** — `test:e2e` unchanged (runs all specs; the new ones self-skip where they must).

## Data flow

```text
harness: serve flight-site → http://127.0.0.1:<p> · spawn daemon (FAIRY_HOME tmp, FAIRY_PI_BIN per spec)
         · pair via the options page · open the panel page · bind the fixture tab

tools.spec (deterministic, runs here):
  panel "start task" → daemon spawns FAIRY_PI_BIN=fake-pi
  fake-pi --(piBridge TCP, token auth)--> daemon --(bridge WS)--> extension --(CDP)--> demo site
    navigate → type SFO/JFK/date → click Search → click Select → click Book
  assert: #confirmation visible with FAIRY-… reference; panel run completed

agent.spec (LLM-gated, the user runs):
  provider key → daemon settings; FAIRY_PI_BIN = bundled fairy-pi
  panel task "Book a flight SFO→JFK …" → real Pi reasons + drives the same tools
  assert (lenient, 5-min budget): #confirmation appears
```

## Error handling

- **Browser can't side-load the extension** → both specs skip (the existing pairing-spec pattern) — green suite, honest skip.
- **No `FAIRY_E2E_PROVIDER_KEY`** → `agent.spec` skips with a message naming the env var.
- **fake-pi step fails** (tool error / element missing) → it exits non-zero with the failing step; the spec fails with that context.
- **Agent run exceeds the budget** → standard Playwright timeout; documented as "LLM runs vary — re-run / raise the budget", not a product bug per se.
- **Fixture server port collisions** → ephemeral ports throughout.

## Testing

`tools.spec.ts` IS the deterministic end-to-end test (real daemon, real extension, real CDP, real page). `fake-pi.ts` and the demo site are fixtures (deterministic by construction; not separately unit-tested). `agent.spec.ts` is the credentialed validation of the bundled Pi. The existing vitest suites and `pairing.spec.ts` (now on the shared harness) stay green. No daemon/Swift changes.

## Sequencing

M6 sub-project 2 (this). The plan derisks the harness + one fake-pi tool round-trip FIRST (task 1), then builds the fixture site, the full booking script, and the two specs. After: **M6-3** — the CI release workflow (wiring the M5-5c scripts + secrets), where `tools.spec` can become a CI gate and `agent.spec` stays a manual/nightly credentialed job.
