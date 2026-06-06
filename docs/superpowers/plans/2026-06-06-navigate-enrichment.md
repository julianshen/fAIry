# navigate-enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich `navigate` results (best-effort) with `domainSkillsAvailable` (daemon-local) + `agentPolicy` (relayed `getAgentPolicy`), caching the policy per origin for the session.

**Architecture:** A daemon-side wrapper around the `navigate` relay (a hybrid). `createDaemon`'s `route` special-cases `navigate` → `enrichNavigate(args, { relay, domainSkills, cache })`, which relays navigate then adds the two fields best-effort. The daemon stays policy-agnostic (`agentPolicy` is opaque `unknown`). A per-origin session cache bounds the per-navigate `/agent.json` fetch.

**Tech Stack:** Bun + TypeScript (strict, `noUncheckedIndexedAccess`), Vitest (daemon ≥90% gate).

**Spec:** `docs/superpowers/specs/2026-06-06-navigate-enrichment-design.md`.

---

## File structure

In `packages/pi-daemon/src/`:
- `policyCache.ts` — **new**; `createPolicyCache()` (Map-backed, session-lifetime).
- `enrichNavigate.ts` — **new**; the best-effort enrichment (deps injected).
- `daemon.ts` — **modify**; create the cache + special-case `navigate` in `route`.
Plus:
- `pi-extension/browser-bridge.ts` — **modify**; re-promise the enriched return in the `browser_navigate` description.

Run from `packages/pi-daemon/`. Single-file test: `bunx vitest run src/<file>.test.ts`. Commit trailer MUST be exactly:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 1: `policyCache`

**Files:**
- Create: `packages/pi-daemon/src/policyCache.ts`
- Test: `packages/pi-daemon/src/policyCache.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/pi-daemon/src/policyCache.test.ts`:

```ts
import { createPolicyCache } from "./policyCache";

describe("policyCache", () => {
  it("returns undefined for an unknown origin", () => {
    expect(createPolicyCache().get("https://x.com")).toBeUndefined();
  });

  it("returns the stored value after set", () => {
    const cache = createPolicyCache();
    const policy = { level: 2, origin: "https://x.com" };
    cache.set("https://x.com", policy);
    expect(cache.get("https://x.com")).toBe(policy);
  });

  it("keys are independent per origin", () => {
    const cache = createPolicyCache();
    cache.set("https://a.com", { level: 1 });
    expect(cache.get("https://b.com")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run src/policyCache.test.ts`
Expected: FAIL — `createPolicyCache` cannot be imported.

- [ ] **Step 3: Implement `policyCache`**

Create `packages/pi-daemon/src/policyCache.ts`:

```ts
/**
 * Per-origin cache of resolved Agent Policies, used by navigate-enrichment so
 * repeated same-host navigations don't re-fetch /agent.json. Opaque values (the
 * daemon is policy-agnostic). Session-lifetime: one instance per daemon process,
 * no TTL/eviction (origins-per-session are few; policies are stable in-session).
 */
export interface PolicyCache {
  get(origin: string): unknown | undefined;
  set(origin: string, value: unknown): void;
}

export function createPolicyCache(): PolicyCache {
  const map = new Map<string, unknown>();
  return {
    get: (origin) => map.get(origin),
    set: (origin, value) => {
      map.set(origin, value);
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run src/policyCache.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + lint, then commit**

Run: `bun run typecheck && bun run lint` (PASS), then:

```bash
cd /Users/julianshen/prj/fAIry
git add packages/pi-daemon/src/policyCache.ts packages/pi-daemon/src/policyCache.test.ts
git commit -F - <<'MSG'
feat(daemon): per-origin policy cache (for navigate-enrichment)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 2: `enrichNavigate`

**Files:**
- Create: `packages/pi-daemon/src/enrichNavigate.ts`
- Test: `packages/pi-daemon/src/enrichNavigate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/pi-daemon/src/enrichNavigate.test.ts`:

```ts
import { enrichNavigate, type Relay } from "./enrichNavigate";
import { createPolicyCache } from "./policyCache";
import { fakeDomainSkills } from "./testFakes";

const POLICY = { level: 2, origin: "https://shop.example", policy: { version: "1.0", site: "shop" } };

/** A relay that records calls and answers per tool. */
function recordingRelay(
  answers: Record<string, (args: Record<string, unknown>) => Promise<unknown>>,
): Relay & { calls: { tool: string; args: Record<string, unknown> }[] } {
  const calls: { tool: string; args: Record<string, unknown> }[] = [];
  const relay = ((tool, args) => {
    calls.push({ tool, args });
    const fn = answers[tool];
    return fn ? fn(args) : Promise.resolve({ ok: true });
  }) as Relay & { calls: typeof calls };
  relay.calls = calls;
  return relay;
}

const okNav = { navigate: () => Promise.resolve({ ok: true }) };

describe("enrichNavigate", () => {
  it("merges domainSkillsAvailable + agentPolicy onto the navigate result", async () => {
    const relay = recordingRelay({ ...okNav, getAgentPolicy: () => Promise.resolve(POLICY) });
    const domainSkills = fakeDomainSkills({ list: () => Promise.resolve(["pricing"]) });
    const res = await enrichNavigate({ url: "https://shop.example/p/1" }, { relay, domainSkills, cache: createPolicyCache() });
    expect(res).toEqual({ ok: true, domainSkillsAvailable: ["pricing"], agentPolicy: POLICY });
  });

  it("uses the landed policy origin for the domain-skills host", async () => {
    const relay = recordingRelay({ ...okNav, getAgentPolicy: () => Promise.resolve(POLICY) });
    let askedHost = "";
    const domainSkills = fakeDomainSkills({ list: (h: string) => { askedHost = h; return Promise.resolve([]); } });
    await enrichNavigate({ url: "https://shop.example/p/1" }, { relay, domainSkills, cache: createPolicyCache() });
    expect(askedHost).toBe("shop.example");
  });

  it("caches the policy per origin: a second same-origin navigate relays getAgentPolicy once", async () => {
    const relay = recordingRelay({ ...okNav, getAgentPolicy: () => Promise.resolve(POLICY) });
    const cache = createPolicyCache();
    const domainSkills = fakeDomainSkills();
    await enrichNavigate({ url: "https://shop.example/a" }, { relay, domainSkills, cache });
    await enrichNavigate({ url: "https://shop.example/b" }, { relay, domainSkills, cache });
    expect(relay.calls.filter((c) => c.tool === "getAgentPolicy")).toHaveLength(1);
  });

  it("re-relays getAgentPolicy for a different origin", async () => {
    const relay = recordingRelay({ ...okNav, getAgentPolicy: () => Promise.resolve(POLICY) });
    const cache = createPolicyCache();
    const domainSkills = fakeDomainSkills();
    await enrichNavigate({ url: "https://a.com/x" }, { relay, domainSkills, cache });
    await enrichNavigate({ url: "https://b.com/x" }, { relay, domainSkills, cache });
    expect(relay.calls.filter((c) => c.tool === "getAgentPolicy")).toHaveLength(2);
  });

  it("omits agentPolicy (and does not cache) when getAgentPolicy fails", async () => {
    const relay = recordingRelay({ ...okNav, getAgentPolicy: () => Promise.reject(new Error("no tab")) });
    const cache = createPolicyCache();
    const domainSkills = fakeDomainSkills({ list: () => Promise.resolve(["x"]) });
    const res = (await enrichNavigate({ url: "https://shop.example/a" }, { relay, domainSkills, cache })) as Record<string, unknown>;
    expect(res.agentPolicy).toBeUndefined();
    expect(res.domainSkillsAvailable).toEqual(["x"]);
    // not cached → a second navigate retries the relay
    await enrichNavigate({ url: "https://shop.example/b" }, { relay, domainSkills, cache });
    expect(relay.calls.filter((c) => c.tool === "getAgentPolicy")).toHaveLength(2);
  });

  it("omits domainSkillsAvailable when domainSkills.list fails", async () => {
    const relay = recordingRelay({ ...okNav, getAgentPolicy: () => Promise.resolve(POLICY) });
    const domainSkills = fakeDomainSkills({ list: () => Promise.reject(new Error("io")) });
    const res = (await enrichNavigate({ url: "https://shop.example/a" }, { relay, domainSkills, cache: createPolicyCache() })) as Record<string, unknown>;
    expect(res.domainSkillsAvailable).toBeUndefined();
    expect(res.agentPolicy).toEqual(POLICY);
  });

  it("propagates a failed navigate (no enrichment)", async () => {
    const relay = recordingRelay({ navigate: () => Promise.reject(new Error("nav failed")) });
    await expect(
      enrichNavigate({ url: "https://shop.example/a" }, { relay, domainSkills: fakeDomainSkills(), cache: createPolicyCache() }),
    ).rejects.toThrow(/nav failed/);
    expect(relay.calls.filter((c) => c.tool === "getAgentPolicy")).toHaveLength(0);
  });

  it("returns a non-object navigate result unchanged (no enrichment)", async () => {
    const relay = recordingRelay({ navigate: () => Promise.resolve("ok-string") });
    const res = await enrichNavigate({ url: "https://shop.example/a" }, { relay, domainSkills: fakeDomainSkills(), cache: createPolicyCache() });
    expect(res).toBe("ok-string");
    expect(relay.calls.filter((c) => c.tool === "getAgentPolicy")).toHaveLength(0);
  });

  it("returns the base result unchanged for an unparseable/non-http url", async () => {
    const relay = recordingRelay({ ...okNav, getAgentPolicy: () => Promise.resolve(POLICY) });
    const res = await enrichNavigate({ url: "not a url" }, { relay, domainSkills: fakeDomainSkills(), cache: createPolicyCache() });
    expect(res).toEqual({ ok: true });
    expect(relay.calls.filter((c) => c.tool === "getAgentPolicy")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run src/enrichNavigate.test.ts`
Expected: FAIL — `enrichNavigate` cannot be imported.

- [ ] **Step 3: Implement `enrichNavigate`**

Create `packages/pi-daemon/src/enrichNavigate.ts`:

```ts
import type { DomainSkills } from "./domainSkills";
import type { PolicyCache } from "./policyCache";

/** Relay a tool to the browser executor (createDaemon's relayToBrowser). */
export type Relay = (tool: string, args: Record<string, unknown>) => Promise<unknown>;

export interface EnrichDeps {
  relay: Relay;
  domainSkills: DomainSkills;
  cache: PolicyCache;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The http(s) origin of a URL string, or null if not a parseable http(s) URL. */
function httpOrigin(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

function hostOf(originOrUrl: string | undefined): string | undefined {
  if (originOrUrl === undefined) return undefined;
  try {
    return new URL(originOrUrl).host;
  } catch {
    return undefined;
  }
}

/** Read `.origin` off an opaque policy result (the daemon doesn't type policies). */
function readOrigin(policy: unknown): string | undefined {
  return isObject(policy) && typeof policy.origin === "string" ? policy.origin : undefined;
}

/**
 * Relay `navigate`, then enrich the result (best-effort, additive) with the landed
 * host's `domainSkillsAvailable` (daemon-local) and `agentPolicy` (relayed
 * getAgentPolicy, cached per origin for the session). A failed navigate propagates;
 * each enrichment field is independent and omitted on failure; getAgentPolicy
 * failures are not cached. The daemon stays policy-agnostic (agentPolicy is opaque).
 */
export async function enrichNavigate(args: Record<string, unknown>, deps: EnrichDeps): Promise<unknown> {
  const base = await deps.relay("navigate", args);
  if (!isObject(base)) return base;
  const origin = httpOrigin(args.url);
  if (origin === null) return base;

  let agentPolicy = deps.cache.get(origin);
  if (agentPolicy === undefined) {
    try {
      agentPolicy = await deps.relay("getAgentPolicy", {});
      deps.cache.set(origin, agentPolicy);
    } catch {
      agentPolicy = undefined; // best-effort; don't cache failures
    }
  }

  const host = hostOf(readOrigin(agentPolicy)) ?? hostOf(origin);
  let domainSkillsAvailable: string[] | undefined;
  if (host !== undefined) {
    try {
      domainSkillsAvailable = await deps.domainSkills.list(host);
    } catch {
      domainSkillsAvailable = undefined; // best-effort
    }
  }

  return {
    ...base,
    ...(domainSkillsAvailable !== undefined ? { domainSkillsAvailable } : {}),
    ...(agentPolicy !== undefined ? { agentPolicy } : {}),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run src/enrichNavigate.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Typecheck + lint, then commit**

Run: `bun run typecheck && bun run lint` (PASS), then:

```bash
cd /Users/julianshen/prj/fAIry
git add packages/pi-daemon/src/enrichNavigate.ts packages/pi-daemon/src/enrichNavigate.test.ts
git commit -F - <<'MSG'
feat(daemon): enrichNavigate — add domainSkillsAvailable + agentPolicy (best-effort)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 3: Wire into the daemon + re-promise the navigate tool

**Files:**
- Modify: `packages/pi-daemon/src/daemon.ts`
- Test: `packages/pi-daemon/src/daemon.test.ts`
- Modify: `packages/pi-daemon/pi-extension/browser-bridge.ts`

- [ ] **Step 1: Write the failing daemon-wiring test**

In `packages/pi-daemon/src/daemon.test.ts`, the existing imports include `createDaemon`, `WebSocket`, `once`, `TOKEN`, `fakeStore`/`fakeSkills`/`fakeHelpers`/`fakeDomainSkills`/`fakeRecorder`/`silentSpawn`, and `lineClient`. Add this test inside the `describe("createDaemon", …)` block (after the existing "relays a Pi tool call…" test):

```ts
  it("enriches a navigate result with domainSkillsAvailable + agentPolicy", async () => {
    const daemon = await createDaemon({
      token: TOKEN,
      settings: fakeStore(),
      skills: fakeSkills(),
      helpers: fakeHelpers(),
      domainSkills: fakeDomainSkills({ list: () => Promise.resolve(["pricing-quirks"]) }),
      recorder: fakeRecorder(),
      spawnPi: silentSpawn,
    });
    try {
      const chrome = new WebSocket(`ws://127.0.0.1:${daemon.ports.bridge}`);
      await once(chrome, "open");
      chrome.send(JSON.stringify({ type: "auth", token: TOKEN }));
      await once(chrome, "message"); // auth_ok
      chrome.on("message", (raw: Buffer) => {
        const req = JSON.parse(raw.toString()) as { id?: string; tool?: string };
        if (!req.id || !req.tool) return;
        const result =
          req.tool === "getAgentPolicy"
            ? { level: 2, origin: "https://shop.example", policy: { version: "1.0", site: "shop" } }
            : { ok: true };
        chrome.send(JSON.stringify({ id: req.id, ok: true, result }));
      });

      const pi = lineClient(daemon.ports.piBridge);
      await once(pi.socket, "connect");
      pi.send({ type: "auth", token: TOKEN });
      expect(await pi.next()).toEqual({ type: "auth_ok" });
      pi.send({ id: "1", tool: "navigate", args: { url: "https://shop.example/p/1" } });
      expect(await pi.next()).toEqual({
        id: "1",
        ok: true,
        result: {
          ok: true,
          domainSkillsAvailable: ["pricing-quirks"],
          agentPolicy: { level: 2, origin: "https://shop.example", policy: { version: "1.0", site: "shop" } },
        },
      });

      chrome.close();
      pi.socket.destroy();
    } finally {
      await daemon.close();
    }
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run src/daemon.test.ts -t "enriches a navigate"`
Expected: FAIL — the result is `{ ok: true }` (no enrichment yet); `domainSkillsAvailable`/`agentPolicy` are missing.

- [ ] **Step 3: Wire `enrichNavigate` + the cache into `daemon.ts`**

Add the imports near the top of `packages/pi-daemon/src/daemon.ts` (with the other local imports):

```ts
import { createPolicyCache } from "./policyCache";
import { enrichNavigate } from "./enrichNavigate";
```

Find the relay + route region:

```ts
  // Relay a tool to the active Chrome executor (or fail if none is connected).
  const relayToBrowser = (tool: string, args: Record<string, unknown>): Promise<unknown> =>
    chrome ? chrome.requestTool(tool, args) : Promise.reject(new Error("no browser connected"));
```

Insert directly after it:

```ts

  // Per-origin Agent Policy cache so navigate-enrichment doesn't re-fetch
  // /agent.json on every same-host navigation (session-lifetime).
  const policyCache = createPolicyCache();
```

Then find `route`:

```ts
  function route(tool: string, args: Record<string, unknown>): Promise<unknown> {
    return router.owns(tool) ? router.handle(tool, args) : relayToBrowser(tool, args);
  }
```

Replace with:

```ts
  function route(tool: string, args: Record<string, unknown>): Promise<unknown> {
    if (tool === "navigate") {
      // Hybrid: relay navigate, then enrich the result (best-effort) with the
      // landed host's domain skills + agent policy. Enrichment never breaks navigate.
      return enrichNavigate(args, { relay: relayToBrowser, domainSkills: opts.domainSkills, cache: policyCache });
    }
    return router.owns(tool) ? router.handle(tool, args) : relayToBrowser(tool, args);
  }
```

- [ ] **Step 4: Run the wiring test to verify it passes**

Run: `bunx vitest run src/daemon.test.ts -t "enriches a navigate"`
Expected: PASS.

- [ ] **Step 5: Re-promise the enriched return in the `-e` navigate tool**

In `packages/pi-daemon/pi-extension/browser-bridge.ts`, find the `browser_navigate` registration's `description` and update it to mention the enriched return. Find (the navigate tool — its current description string), and replace the description with one that ends with a note like:

```ts
    description:
      "Navigate the agent's tab to a URL (http/https). Returns { ok } plus, when " +
      "available, `domainSkillsAvailable` (saved notes for the landed host) and " +
      "`agentPolicy` (the site's /agent.json contract) so you can adapt immediately.",
```

(Match the existing `name: "browser_navigate"` block; change ONLY its `description`. If the current wording differs, preserve the intent and append the enriched-return sentence.)

- [ ] **Step 6: Run the full daemon suite + coverage + typecheck + lint**

Run: `bun run test && bun run typecheck && bun run lint`
Expected: PASS. The existing "relays a Pi tool call…" navigate test still passes — its fake chrome returns a string result (`"did:navigate"`), which `enrichNavigate` returns unchanged (non-object base), and never relays getAgentPolicy. ≥90% coverage holds (policyCache + enrichNavigate fully tested; the route branch covered by the new wiring test).

- [ ] **Step 7: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/pi-daemon/src/daemon.ts packages/pi-daemon/src/daemon.test.ts packages/pi-daemon/pi-extension/browser-bridge.ts
git commit -F - <<'MSG'
feat(daemon): enrich navigate with domainSkillsAvailable + agentPolicy

route() special-cases navigate → enrichNavigate (relay + best-effort enrichment),
with a per-origin session policy cache. Re-promises the enriched return in the
browser_navigate tool description (de-promised in PR3c).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

## Self-Review

**1. Spec coverage.**
- Daemon-side wrapper around the navigate relay → Task 3 `route` branch + Task 2 `enrichNavigate`.
- `domainSkillsAvailable` (daemon-local `domainSkills.list`, landed host) + `agentPolicy` (relayed getAgentPolicy) → Task 2 (+ tests).
- Per-origin session cache; cache hit skips the getAgentPolicy relay; failures not cached → Task 1 `policyCache` + Task 2 (cache-hit + failure-not-cached tests).
- Best-effort / additive: failed navigate propagates; each field independent → Task 2 (propagate + per-field-failure tests).
- Policy-agnostic daemon (opaque agentPolicy; only `.origin` read) → Task 2 `readOrigin`.
- Cache key = requested origin; non-object base / unparseable url → base unchanged → Task 2 (tests).
- Re-promise the navigate tool description → Task 3 Step 5.
- Daemon wiring → Task 3 (route branch + integration test).
  No spec requirement is left without a task.

**2. Placeholder scan.** No "TBD"/"TODO"/"handle edge cases"/"similar to Task N". Every code step shows complete code; tests are full; commands have expected outcomes; the existing-navigate-test-still-passes interaction is explained. The only adaptive step is the `-e` description edit (the exact current wording isn't pinned), with explicit intent + constraints — acceptable for a doc string. ✓

**3. Type consistency.** `PolicyCache` (`get(origin): unknown | undefined; set(origin, value): void`) defined in Task 1, consumed by `enrichNavigate`'s `EnrichDeps` (Task 2) and `createPolicyCache()` in `daemon.ts` (Task 3). `Relay = (tool, args) => Promise<unknown>` matches `relayToBrowser`'s signature. `enrichNavigate(args, { relay, domainSkills, cache })` matches the `route` call site (Task 3) and the tests (Task 2). `DomainSkills` is imported from `./domainSkills` (its `list(host): Promise<string[]>` is what `enrichNavigate` calls and `fakeDomainSkills({ list })` overrides). ✓
