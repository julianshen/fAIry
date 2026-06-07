# waitFor networkIdle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `waitFor` gains a `networkIdle` condition that resolves once the page's network is quiet — no newly-completed resource for `idleMs` (default 500) — within the existing poll loop.

**Architecture:** Add `networkIdle`/`idleMs` to the existing `waitFor` handler (`handlers/page.ts`). Each poll tick reads `performance.getEntriesByType('resource').length` via `evaluateExpression`; any change to that count (growth OR a navigation reset) is "activity" and resets the quiet timer; a count stable for `idleMs` resolves. No new files, no event-buffer coupling.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), Vitest, Chrome extension MV3 (CDP via `CdpClient`).

**Spec:** `docs/superpowers/specs/2026-06-07-wait-for-network-idle-design.md`.

---

## File structure

- `packages/extension/src/handlers/page.ts` — **modify**; `waitFor` gains the `networkIdle`/`idleMs` condition + a `MAX_IDLE_MS` cap + a `resourceCount()` helper.
- `packages/extension/src/handlers/page.test.ts` — **modify**; networkIdle tests (fake clock + fakeCdp).
- `packages/pi-daemon/pi-extension/browser-bridge.ts` — **modify**; the `browser_wait_for` tool's params schema + description gain `networkIdle`/`idleMs` (pass-through to the handler).

Run from each package's dir. Single test file: `bunx vitest run src/handlers/page.test.ts`. Commit trailer MUST be exactly:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

Key facts (confirmed in the code):
- `waitFor(cdp, args, clock=realClock)` polls `while (clock.now() < deadline)` every `POLL_MS` (100ms), returning `{ok, reason}` on the first satisfied condition.
- `optionalNumber(args, key, fallback)` and `optionalString` are imported from `./args`; there is NO `optionalBoolean` (use `args.networkIdle === true`).
- `evaluateExpression(cdp, expr)` runs `Runtime.evaluate` (returnByValue) and returns the value (or throws on a page exception).
- Test helpers in `page.test.ts`: `fakeCdp(evalValues[])` returns each queued value per `Runtime.evaluate`, **sticking on the last** when the queue is down to one; `fakeClock()` time advances only on `sleep(ms)`.

---

### Task 1: `waitFor` networkIdle condition

**Files:**
- Modify: `packages/extension/src/handlers/page.ts`
- Test: `packages/extension/src/handlers/page.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/extension/src/handlers/page.test.ts`, inside the existing `describe("waitFor", …)` block, add:

```ts
it("resolves networkIdle once the resource count is stable for idleMs", async () => {
  const cdp = fakeCdp([5]); // count stays 5 every poll
  const result = await waitFor(cdp, { networkIdle: true, idleMs: 100 }, fakeClock());
  expect(result).toEqual({ ok: true, reason: "networkIdle" });
});

it("waits through a growing count, then resolves when it settles", async () => {
  const cdp = fakeCdp([1, 2, 2]); // grows 1→2, then stable at 2
  const result = await waitFor(cdp, { networkIdle: true, idleMs: 100 }, fakeClock());
  expect(result).toEqual({ ok: true, reason: "networkIdle" });
  expect(cdp.calls.filter((c) => c.method === "Runtime.evaluate")).toHaveLength(3);
});

it("treats a count DROP (navigation reset) as activity, not idle", async () => {
  // [5,2,2]: a growth-only check would falsely resolve at the drop (2 polls);
  // treating any change as activity defers to the third poll.
  const cdp = fakeCdp([5, 2, 2]);
  const result = await waitFor(cdp, { networkIdle: true, idleMs: 100 }, fakeClock());
  expect(result).toEqual({ ok: true, reason: "networkIdle" });
  expect(cdp.calls.filter((c) => c.method === "Runtime.evaluate")).toHaveLength(3);
});

it("times out if the network never settles", async () => {
  const cdp = fakeCdp([1, 2, 3, 4]); // count changes every poll
  const result = await waitFor(cdp, { networkIdle: true, idleMs: 100, timeoutMs: 250 }, fakeClock());
  expect(result).toEqual({ ok: false, reason: "timeout" });
});

it("a non-number resource read is skipped (no false resolve)", async () => {
  const cdp = fakeCdp([undefined, 5, 5]); // first read NaN → skipped, then stable
  const result = await waitFor(cdp, { networkIdle: true, idleMs: 100 }, fakeClock());
  expect(result).toEqual({ ok: true, reason: "networkIdle" });
});

it("networkIdle composes with other conditions — first satisfied wins", async () => {
  const cdp = fakeCdp([true]); // the selector check evaluates truthy first
  const result = await waitFor(cdp, { selector: ".ready", networkIdle: true }, fakeClock());
  expect(result).toEqual({ ok: true, reason: "selector" });
});
```

- [ ] **Step 2: Run them, expect FAIL**

Run: `cd packages/extension && bunx vitest run src/handlers/page.test.ts -t "networkIdle|resource count|never settles|navigation reset"`
Expected: FAIL — `networkIdle` isn't handled (no resolve / wrong result).

- [ ] **Step 3: Implement in `page.ts`**

Add a cap constant next to the existing ones (after `const MAX_URL_MATCH_LEN = 256;`):
```ts
const MAX_IDLE_MS = 10_000;
```

In `waitFor`, after the existing `const predicate = optionalString(args, "predicate");` line, add:
```ts
  const networkIdle = args.networkIdle === true;
  const idleMs = Math.min(optionalNumber(args, "idleMs", 500), MAX_IDLE_MS);
```

Before the `while` loop (next to `const deadline = …`), add the helper + state:
```ts
  // networkIdle: the page's Resource Timing count, or undefined if it can't be read
  // this tick (navigating page / NaN). Completion-quiescence — a stable count means
  // no new resource finished; stream-safe (open SSE/WS never adds a completed entry).
  const resourceCount = async (): Promise<number | undefined> => {
    try {
      const v = Number(await evaluateExpression(cdp, "performance.getEntriesByType('resource').length"));
      return Number.isFinite(v) ? v : undefined;
    } catch {
      return undefined;
    }
  };
  let lastCount: number | undefined;
  let idleSince = 0;
```

Inside the `while (clock.now() < deadline)` loop, after the `predicate` check and BEFORE `await clock.sleep(POLL_MS);`, add:
```ts
    if (networkIdle) {
      const count = await resourceCount();
      if (count !== undefined) {
        if (lastCount === undefined || count !== lastCount) {
          // any change (growth or a navigation reset that drops the count) = activity
          lastCount = count;
          idleSince = clock.now();
        } else if (clock.now() - idleSince >= idleMs) {
          return { ok: true, reason: "networkIdle" };
        }
      }
    }
```

Update the `waitFor` doc comment line that lists supported conditions to include `networkIdle` (replace the parenthetical "(`networkIdle` arrives with the CDP-event buffer.)" with a mention that `networkIdle` waits for the resource count to be stable for `idleMs`).

- [ ] **Step 4: Run them, expect PASS**

Run: `bunx vitest run src/handlers/page.test.ts`
Expected: PASS (all, incl. the 6 new).

- [ ] **Step 5: Typecheck + lint + commit**

Run: `bun run typecheck && bun run lint`. Then:
```bash
cd /Users/julianshen/prj/fAIry
git add packages/extension/src/handlers/page.ts packages/extension/src/handlers/page.test.ts
git commit -F - <<'MSG'
feat(extension): waitFor networkIdle via Resource Timing quiescence

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 2: Expose `networkIdle`/`idleMs` on the `browser_wait_for` tool

**Files:**
- Modify: `packages/pi-daemon/pi-extension/browser-bridge.ts`

- [ ] **Step 1: Read the current `browser_wait_for` registration**

Open `packages/pi-daemon/pi-extension/browser-bridge.ts` and find `name: "browser_wait_for"`. Note its `parameters: Type.Object({ … })` (the existing fields — `selector`, `selectorGone`, `urlMatch`, `predicate`, `timeoutMs`, all `Type.Optional`) and its `description`, and that `execute` forwards `params` to `bridge("waitFor", …)`. (The `-e` script is a standalone artifact, outside the daemon tsconfig/coverage — verified by the real-`pi` load smoke test, not a unit test.)

- [ ] **Step 2: Add the new params + describe the mode**

Add to the `parameters` `Type.Object({ … })` (matching the existing `Type.Optional` idiom):
```ts
      networkIdle: Type.Optional(Type.Boolean()),
      idleMs: Type.Optional(Type.Number()),
```
Extend the `description` to document the new mode, e.g. append: `" Set networkIdle:true to wait until the page's network is quiet (no new resource for idleMs, default 500ms)."` (Match the file's existing description voice; keep it one string.)

- [ ] **Step 3: Verify the `-e` script still loads + typecheck**

Run from `packages/pi-daemon/`: `bun run test` — the `piBrowserExtension.test.ts` real-`pi` `-e` load smoke test (skips if `pi` is absent) must still pass / not regress. Also `bun run typecheck`.

- [ ] **Step 4: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/pi-daemon/pi-extension/browser-bridge.ts
git commit -F - <<'MSG'
feat(daemon): browser_wait_for exposes networkIdle/idleMs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

## Self-Review

**1. Spec coverage.**
- `networkIdle` resolves on resource-count quiescence; `idleMs` quiet window (default 500, capped) → Task 1 (impl + tests).
- Any change (growth OR navigation-reset drop) = activity (`!==`, not `>`) → Task 1 impl + the "count DROP" test.
- `evaluate` error / NaN → tick skipped (no false resolve/reset) → Task 1 impl (`resourceCount` returns undefined) + the "non-number read" test.
- Times out if never quiet → Task 1 "times out" test (existing `{ok:false, reason:"timeout"}`).
- Composes with other conditions, first satisfied wins → Task 1 "composes" test.
- `idleMs` clamp / non-number default → `Math.min(optionalNumber(...,500), MAX_IDLE_MS)`.
- `-e` `browser_wait_for` exposes the mode → Task 2.
- Resource-buffer-cap limitation → documented in the spec; no code (accepted non-goal).
  No spec requirement is left without a task.

**2. Placeholder scan.** Every step shows complete code; tests are full with exact expected results; the fakeCdp/fakeClock math is worked through (see the test comments). The one adaptive step (Task 2 description wording) is explicit with the required substance. No "TBD"/"add validation"/"similar to Task N".

**3. Type consistency.** `networkIdle` (boolean via `args.networkIdle === true`) and `idleMs` (`optionalNumber`, capped by `MAX_IDLE_MS`) are used identically in the impl and tests; `resourceCount(): Promise<number | undefined>` feeds the `count !== undefined` / `count !== lastCount` checks; the new reason string is exactly `"networkIdle"` in both impl and assertions. The `-e` param names (`networkIdle`/`idleMs`, Task 2) match the handler's arg names (Task 1).
