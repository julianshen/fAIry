# navigate-enrichment — design

**Status:** approved (design phase) · **Date:** 2026-06-06 · **Component:** pi-daemon (tool-router relay) · **Builds on:** getAgentPolicy (#42) + invokeStructuredAction (#43) + the daemon domain-skills store · **Part of:** M4 "PR4" decomposition.

## Context

When the agent navigates, it would benefit from immediately knowing two things
about where it landed: (1) **`domainSkillsAvailable`** — the names of the per-host
notes the user/agent saved (the daemon's `domainSkills` store), and (2)
**`agentPolicy`** — the site's `/agent.json` contract (`getAgentPolicy`). Today
`browser_navigate` returns just `{ ok: true }`. (`SKILL.md` was de-promised in PR3c
to stop claiming navigate surfaces these; this re-adds it for real.)

`domainSkillsAvailable` is daemon-local (`domainSkills.list(host)`); `agentPolicy`
requires a page-side fetch via the extension's `getAgentPolicy`. So enrichment is a
**daemon-side wrapper** around the `navigate` relay — a hybrid, like `callHelper`.
The daemon already routes `navigate` to the extension via `relayToBrowser` and owns
`domainSkills`; it can also relay `getAgentPolicy`.

## Goal & non-goals

**Goal:** `navigate` results are enriched (best-effort) with `domainSkillsAvailable`
and `agentPolicy`, with the resolved policy **cached per origin** for the session so
repeated same-host navigations don't re-fetch `/agent.json`.

**Non-goals (v1) — noted:**
- **No TTL / ETag / eviction.** The cache is session-lifetime (the daemon process is
  per-session; origins-per-session are few; policies are stable in-session).
- **Cache not shared with explicit `getAgentPolicy`.** A direct `getAgentPolicy`
  call stays a fresh relay; only navigate-enrichment reads/writes the cache.
- Enrichment applies to `navigate` only (not other navigation paths).
- The daemon stays **policy-agnostic**: `agentPolicy` is opaque (`unknown`) — it's
  cached + passed through; only `.origin` is read (defensively) for the host.

## Decisions (and why)

1. **Daemon-side enrichment** (not the extension's `navigate` handler). The two
   enrichment sources split across processes (`domainSkills` is daemon-local;
   `getAgentPolicy` is extension-side), and the daemon relay is the one place that
   sees both. The extension's `navigate` handler is unchanged.
2. **Best-effort, additive.** A failed `navigate` propagates (never enriched). Each
   field is independent: a `getAgentPolicy` or `domainSkills.list` failure omits that
   field; the base `navigate` result is never broken by enrichment. `getAgentPolicy`
   failures are **not** cached (so a transient failure doesn't poison the cache).
3. **Per-origin session cache** keyed by the **requested** URL's origin. (A cross-
   origin redirect would cache the landed policy under the requested origin —
   bounded and acceptable; the returned `agentPolicy.origin` still reports the true
   landed origin, and re-navigating the requested origin redirects to the same place.)
4. **Policy-agnostic daemon.** No import of the extension's policy types — the daemon
   treats the relayed `getAgentPolicy` result as opaque.

## Architecture & components

In `packages/pi-daemon/src/`:

- **`policyCache.ts`** (new) — `createPolicyCache(): PolicyCache` where
  `PolicyCache = { get(origin: string): unknown | undefined; set(origin: string, value: unknown): void }`,
  backed by a `Map<string, unknown>`. Session-lifetime, no TTL/eviction. Pure.
- **`enrichNavigate.ts`** (new) — `enrichNavigate(args, deps): Promise<unknown>` with
  `deps = { relay: Relay; domainSkills: DomainSkills; cache: PolicyCache }` and
  `Relay = (tool: string, args: Record<string, unknown>) => Promise<unknown>`.
  Relays `navigate`, then enriches. Deps injected → unit-testable without a daemon.
- **`daemon.ts`** (modify) — create the cache once in `createDaemon`; in `route`,
  special-case `tool === "navigate"` →
  `enrichNavigate(args, { relay: relayToBrowser, domainSkills: opts.domainSkills, cache })`.
- **`pi-extension/browser-bridge.ts`** (modify) — update the `browser_navigate` tool
  description to re-promise the enriched return (`domainSkillsAvailable` +
  `agentPolicy`).

## Data flow

```text
route("navigate", { url })  →  enrichNavigate({ url }, { relay, domainSkills, cache })

  base = await relay("navigate", { url })        // {ok:true}; if it THROWS → propagate (no enrich)
  if (!isObject(base)) return base               // defensive
  const origin = httpOrigin(url)                 // http(s) origin of args.url; null → return base

  // agentPolicy — cached per origin, best-effort
  let agentPolicy = cache.get(origin)
  if (agentPolicy === undefined) {
    try { agentPolicy = await relay("getAgentPolicy", {}); cache.set(origin, agentPolicy) }
    catch { agentPolicy = undefined }            // do NOT cache failures
  }

  // domainSkillsAvailable — best-effort; landed host preferred, else requested host
  const host = hostOf(readOrigin(agentPolicy)) ?? hostOf(url)
  let domainSkillsAvailable: string[] | undefined
  try { domainSkillsAvailable = await domainSkills.list(host) } catch { domainSkillsAvailable = undefined }

  return {
    ...base,
    ...(domainSkillsAvailable !== undefined ? { domainSkillsAvailable } : {}),
    ...(agentPolicy !== undefined ? { agentPolicy } : {}),
  }
```

Helpers (in `enrichNavigate.ts`): `httpOrigin(url)` → `new URL(url).origin` if
`http:`/`https:`, else `null` (try/catch); `hostOf(originOrUrl)` →
`new URL(...).host` or `null`; `readOrigin(policy)` → `policy.origin` if `policy` is
an object with a string `origin`, else `undefined`; `isObject(v)`.

## Caching semantics

- Key: the **requested** URL's origin (`httpOrigin(args.url)`).
- Hit → reuse the cached `agentPolicy`, skipping the `getAgentPolicy` relay (the cost
  bound the design exists for).
- Miss → relay `getAgentPolicy`, cache the result (even a `level: 0` "no policy"
  result is cached — a 404 is a valid, cacheable answer). Failures (thrown) are not
  cached.
- Lifetime: the `createDaemon` process (one cache instance per daemon). No eviction.

## Error handling

- `relay("navigate")` throws → `enrichNavigate` rejects with that error (a failed
  navigation surfaces as-is; no enrichment).
- `base` not an object → returned unchanged (no enrichment).
- `httpOrigin(url)` null (relative/non-http) → `base` returned unchanged. (In practice
  `navigate` already gates http(s), so this is defensive.)
- `getAgentPolicy` relay throws → `agentPolicy` omitted, not cached; navigate result
  still returned (possibly still with `domainSkillsAvailable`).
- `domainSkills.list` throws → `domainSkillsAvailable` omitted. (It already returns
  `[]` for an invalid host rather than throwing, so this is belt-and-suspenders.)

## Testing

- **`policyCache`** (pure): `get` miss → `undefined`; `set` then `get` → value; keys
  are independent.
- **`enrichNavigate`** (injected fakes — a recording `relay`, a fake `domainSkills`,
  a real `createPolicyCache`):
  - merges both fields onto the base result for a normal navigate.
  - **cache hit:** two navigates to the same origin relay `getAgentPolicy` exactly
    once (assert the relay call count).
  - a different origin re-relays `getAgentPolicy` (separate cache key).
  - `getAgentPolicy` relay rejects → result has no `agentPolicy`, still has
    `domainSkillsAvailable`, and the failure is **not** cached (a later navigate
    retries the relay).
  - `domainSkills.list` rejects → result has no `domainSkillsAvailable`.
  - `relay("navigate")` rejects → `enrichNavigate` rejects (propagated).
  - host for `domainSkills.list` comes from the policy's `origin` when present, else
    the requested URL's host (assert the host passed to `domainSkills.list`).
  - non-object base / unparseable url → base returned unchanged.
- **`daemon.ts` wiring**: a `createDaemon`-level test that a `navigate` requestTool
  call returns an enriched result (the existing daemon tests already fake the chrome
  relay + provide `domainSkills`); assert `domainSkillsAvailable`/`agentPolicy` appear.

## Sequencing

Single PR (this sub-project). Remaining M4-PR4: `proposeSave` (+ panel toast) and the
group-2 finishers (`reader_extract`, `waitFor` networkIdle). Policy-cache TTL/ETag and
sharing the cache with `getAgentPolicy` remain future enhancements.
