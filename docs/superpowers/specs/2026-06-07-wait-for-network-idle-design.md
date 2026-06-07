# waitFor networkIdle — design

**Status:** approved (design phase) · **Date:** 2026-06-07 · **Component:** extension (`handlers/page.ts` `waitFor`) · **Builds on:** the existing `waitFor` poll loop · **Part of:** M4 "PR4" group-2 finishers (PR-1 of 2; PR-2 = `reader_extract`).

## Context

`waitFor` (extension `handlers/page.ts`) lets the agent wait for a page condition instead of "sleep then retry," polling ~100ms until the condition holds or the deadline passes. It currently supports `selector` (exists + visible), `selectorGone`, `urlMatch` (regex), and `predicate` (arbitrary truthy JS). The `networkIdle` mode was deferred ("arrives with the CDP-event buffer"). This adds it.

## Goal & non-goals

**Goal:** `waitFor` resolves `{ok:true, reason:"networkIdle"}` once the page's network has been quiet — no newly-completed resource for a quiet window (`idleMs`, default 500ms) — or `{ok:false, reason:"timeout"}` at the deadline.

**Non-goals:**
- A precise CDP in-flight request counter (Playwright-style, via the event buffer) — rejected (see Decisions). v1 is a completion-quiescence heuristic.
- `reader_extract` — its own PR-2.
- Changing the other `waitFor` conditions or the poll cadence.

## Decisions (and why)

1. **Detect quiescence via the page's Resource Timing API**, not CDP Network events. Each existing poll tick reads `performance.getEntriesByType('resource').length` through `evaluateExpression`; "idle" = that count hasn't grown for `idleMs`. *Why over the CDP-event-buffer approach:*
   - **No coupling to the worker-wide shared event buffer.** A buffer-based counter would `collect()` (draining) Network events the agent may have subscribed to — the exact bug fixed in `learnPageActions`. The Resource-Timing approach touches nothing shared.
   - **No new wiring.** It drops into the existing `evaluate`-poll loop; `waitFor` keeps its `(cdp, args, clock)` shape (no `events` dep).
   - **Stream-safe.** An open SSE/WebSocket/long-poll never produces a *completed* resource entry, so it doesn't hang the waiter — whereas a strict in-flight counter would wait forever.
   - *Trade-off:* it's "no new resource completed for the quiet window," not a true in-flight count. A lone very-long-pending request with nothing else happening reads as idle. For the real use case ("wait for the page's request burst to settle"), this is correct and robust.
2. **`networkIdle` is another optional condition in the same loop**, not a separate handler — it shares the deadline, clock, and the "return on the first satisfied condition" semantics. Stateful across ticks (tracks `lastCount`/`idleSince` in loop-local vars), unlike the stateless selector/url checks.

## Architecture & components

In `packages/extension/src/handlers/page.ts`, `waitFor`:
- New optional args: `networkIdle?: boolean` (the condition) and `idleMs?: number` (quiet window; default 500, clamped to a sane max e.g. 10_000, non-number → default). `timeoutMs` (existing) is the overall deadline.
- Loop-local state when `networkIdle` is set: `lastCount` (number) and `idleSince` (timestamp), initialized on the first tick.
- Per tick (within the existing `while (clock.now() < deadline)`):
  ```text
  count = resourceCount()                 // number | undefined (undefined on error)
  if (count !== undefined) {
    if (lastCount === undefined || count !== lastCount) { lastCount = count; idleSince = now }  // any change = activity
    else if (now - idleSince >= idleMs) return { ok:true, reason:"networkIdle" }
  }
  // count === undefined → skip this tick (no state change); a transient throw
  // between two stable reads still lets idle resolve on the next good tick.
  ```
  where `resourceCount()` = `Number(await evaluateExpression(cdp, "performance.getEntriesByType('resource').length"))`, returning `undefined` on a thrown eval or `NaN`.
  - **Why `count !== lastCount` (any change), not `count > lastCount` (growth only):** `performance` resource entries are per-document and reset on navigation, so a cross-navigation count *drops*. Growth-only would leave `idleSince` stale and falsely resolve `networkIdle` on the new document's first (lower) read. Treating any change as activity correctly defers idle until the count is truly stable.
- The other conditions are checked in the same tick as today; whichever holds first returns.
- The `-e` `browser_wait_for` tool (`pi-extension/browser-bridge.ts`) description gains the `networkIdle`/`idleMs` mode (the params are pass-through; the `-e` already forwards `args` to `waitFor`).

## Data flow

```text
browser_wait_for { networkIdle: true, idleMs?, timeoutMs? }
  → bridge → waitFor(cdp, args, clock)
      loop ~100ms until deadline:
        count = evaluate("performance.getEntriesByType('resource').length")
        grew?  → reset idleSince
        quiet for idleMs? → { ok:true, reason:"networkIdle" }
      deadline → { ok:false, reason:"timeout" }
```

## Error handling

- `evaluate` throws mid-poll (e.g. the document is navigating) → `resourceCount()` is `undefined`, so the tick is skipped entirely (no state change); the loop continues and resumes counting once the new document is live.
- **Known limitation:** the browser's Resource Timing buffer is capped (~250 entries by default); a page that continuously loads >250 resources can plateau the count and read as idle while still active. Acceptable for v1 (the common case is a finite request burst). Documented, not handled.
- `idleMs` non-number → default 500; clamped to the max.
- Deadline reached without quiescence → `{ok:false, reason:"timeout"}` (existing).
- `networkIdle` composes with other conditions: if `selector` (etc.) is also passed, the first satisfied wins (existing semantics).

## Testing

`waitFor` is unit-tested with a fake `Clock` (deterministic `now`/`sleep`) and `fakeCdp` returning canned `Runtime.evaluate` values. Add to `page.test.ts`:
- Resolves `networkIdle` once the resource count is stable for `idleMs`: fake cdp returns a growing count for a few ticks, then a stable count; assert `{ok:true, reason:"networkIdle"}` after the quiet window elapses on the fake clock.
- Keeps waiting while the count grows (no premature resolve).
- A count that DROPS (navigation reset / cleared timings) is treated as activity — defers idle, doesn't falsely resolve on the new document's first read.
- Times out (`{ok:false, reason:"timeout"}`) if the count never settles before the deadline.
- Respects `idleMs` (a longer window needs more stable ticks before resolving).
- A throwing `evaluate` tick doesn't falsely resolve or reset (treated as no change).
- `networkIdle` + `selector` together: the first satisfied condition wins.
All deterministic via the injected clock; no real timers. No new files.

## Sequencing

PR-1 (this spec). **PR-2:** `reader_extract` — add the missing extension handler that injects a content extractor (settle the Mozilla-Readability-injection / IIFE-bundling vs lighter-heuristic approach there). That completes the M4-PR4 tool layer; then M5 (Swift shell), M6 (packaging).
