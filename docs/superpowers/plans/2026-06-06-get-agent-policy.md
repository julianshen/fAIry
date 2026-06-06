# getAgentPolicy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `getAgentPolicy` extension tool that fetches the active page's `/agent.json`, classifies a `level` (0–3), and returns `{ level, origin, policy }` (advisory — no enforcement).

**Architecture:** A thin orchestrator handler runs a page-side same-origin `fetch('/agent.json')` via `evaluate`, then classifies the result with a pure `parseAgentPolicy`. Mirrors the learnPageActions shape (page-side script + pure parser). `parseAgentPolicy` + `fetchPolicyScript` are the reusable resolver for the next sub-projects (`invokeStructuredAction`, navigate-enrichment).

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), Vitest (extension ≥90% gate), the extension CDP handler pattern (`fakeCdp`, `evaluateExpression`).

**Spec:** `docs/superpowers/specs/2026-06-06-get-agent-policy-design.md`.

---

## File structure

New module group `packages/extension/src/handlers/policy/`:
- `policyTypes.ts` — `AgentAction`, `AgentPolicy`, `PolicyFetch`, `AgentPolicyResult` (type-only).
- `parseAgentPolicy.ts` — pure `parseAgentPolicy(fetched: PolicyFetch): AgentPolicyResult`.
- `fetchPolicyScript.ts` — the page-side `fetch('/agent.json')` JS string (untested).
- `getAgentPolicy.ts` — the orchestrator handler.

Modified:
- `packages/extension/src/handlers/registry.ts` — register `getAgentPolicy`.
- `packages/extension/src/handlers/registry.test.ts` — add `getAgentPolicy` to `EXPECTED_TOOLS`.

Conventions: handlers throw named errors on bad args; `noUncheckedIndexedAccess` is on. Run from `packages/extension/`. Single-file test: `bunx vitest run src/handlers/policy/<file>.test.ts`. Commit trailer MUST be exactly:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 1: Types + `parseAgentPolicy`

**Files:**
- Create: `packages/extension/src/handlers/policy/policyTypes.ts`
- Create: `packages/extension/src/handlers/policy/parseAgentPolicy.ts`
- Test: `packages/extension/src/handlers/policy/parseAgentPolicy.test.ts`

- [ ] **Step 1: Create the policy types**

Create `packages/extension/src/handlers/policy/policyTypes.ts`:

```ts
/** Shapes for the Agent Policy (/agent.json) resolver — see the design doc. */

/** A site-declared structured action (level >= 2). */
export interface AgentAction {
  name: string;
  endpoint: string; // "METHOD /path/:id"
  args_schema?: Record<string, unknown>;
  auth?: string; // "none" | "cookie" | ...
  rate_limit?: string; // "N/s" | "N/m" | "N/h"
  idempotent?: boolean;
}

/** The /agent.json document (Agent Policy v1). Typed for what we read; extra keys pass through. */
export interface AgentPolicy {
  version: string; // "1.x"
  site: string;
  summary?: string;
  capabilities?: Record<string, unknown>;
  objectives?: unknown[];
  actions?: AgentAction[];
  requires_human?: unknown[];
  prohibited?: unknown[];
  consent?: Record<string, unknown>;
  safety?: Record<string, unknown>;
  audit?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Raw result of the page-side fetch of /agent.json. */
export interface PolicyFetch {
  origin: string | null;
  status: number; // HTTP status, or 0 on a network/throw error
  body: string | null; // response text when ok, else null
}

/** What getAgentPolicy returns to the agent. */
export interface AgentPolicyResult {
  level: 0 | 1 | 2 | 3;
  origin: string | null;
  policy?: AgentPolicy;
}
```

- [ ] **Step 2: Write the failing test**

Create `packages/extension/src/handlers/policy/parseAgentPolicy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseAgentPolicy } from "./parseAgentPolicy";
import type { PolicyFetch } from "./policyTypes";

const ORIGIN = "https://shop.example";
function fetched(body: string | null, status = 200): PolicyFetch {
  return { origin: ORIGIN, status, body };
}
const json = (o: unknown): string => JSON.stringify(o);

describe("parseAgentPolicy", () => {
  it("returns level 0 on a network failure (status 0)", () => {
    expect(parseAgentPolicy({ origin: ORIGIN, status: 0, body: null })).toEqual({ level: 0, origin: ORIGIN });
  });

  it("returns level 0 on a non-200 (e.g. 404), keeping the origin", () => {
    expect(parseAgentPolicy(fetched(null, 404))).toEqual({ level: 0, origin: ORIGIN });
  });

  it("returns level 0 on an invalid-JSON body", () => {
    expect(parseAgentPolicy(fetched("not json{"))).toEqual({ level: 0, origin: ORIGIN });
  });

  it("returns level 0 when the JSON is not an object", () => {
    expect(parseAgentPolicy(fetched("42")).level).toBe(0);
    expect(parseAgentPolicy(fetched("[]")).level).toBe(0);
  });

  it("returns level 0 when version is missing or not 1.x", () => {
    expect(parseAgentPolicy(fetched(json({ site: "s" }))).level).toBe(0);
    expect(parseAgentPolicy(fetched(json({ version: "2.0", site: "s" }))).level).toBe(0);
  });

  it("returns level 0 for an oversized body", () => {
    const huge = json({ version: "1.0", site: "s", pad: "x".repeat(1_000_001) });
    expect(parseAgentPolicy(fetched(huge)).level).toBe(0);
  });

  it("classifies a basic valid v1 policy as level 1 and returns it", () => {
    const r = parseAgentPolicy(fetched(json({ version: "1.0", site: "shop" })));
    expect(r.level).toBe(1);
    expect(r.origin).toBe(ORIGIN);
    expect(r.policy).toMatchObject({ version: "1.0", site: "shop" });
  });

  it("classifies a policy with declared actions as level 2", () => {
    const r = parseAgentPolicy(
      fetched(json({ version: "1.2", site: "shop", actions: [{ name: "checkout", endpoint: "POST /checkout" }] })),
    );
    expect(r.level).toBe(2);
  });

  it("classifies a policy with governance fields as level 3", () => {
    const r = parseAgentPolicy(fetched(json({ version: "1.0", site: "shop", prohibited: [{ trigger: "scrape" }] })));
    expect(r.level).toBe(3);
  });

  it("treats governance without actions as level 3 (max-wins)", () => {
    const r = parseAgentPolicy(fetched(json({ version: "1.0", site: "shop", consent: { checkout: "always_human" } })));
    expect(r.level).toBe(3);
  });

  it("ignores an empty actions array (stays level 1)", () => {
    const r = parseAgentPolicy(fetched(json({ version: "1.0", site: "shop", actions: [] })));
    expect(r.level).toBe(1);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bunx vitest run src/handlers/policy/parseAgentPolicy.test.ts`
Expected: FAIL — `parseAgentPolicy` cannot be imported.

- [ ] **Step 4: Implement `parseAgentPolicy`**

Create `packages/extension/src/handlers/policy/parseAgentPolicy.ts`:

```ts
import type { AgentPolicy, AgentPolicyResult, PolicyFetch } from "./policyTypes";

/** Don't parse a hostile/huge response — treat it as no usable policy. */
const MAX_BODY_BYTES = 1_000_000;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function nonEmptyArray(v: unknown): boolean {
  return Array.isArray(v) && v.length > 0;
}

/**
 * Parse + classify a fetched /agent.json. Pure, never throws: anything that isn't a
 * usable Agent Policy v1 returns level 0 (with whatever origin the fetch reported).
 * Level is max-wins: 1 = valid basic, 2 = non-empty actions, 3 = governance fields.
 */
export function parseAgentPolicy(fetched: PolicyFetch): AgentPolicyResult {
  const { origin } = fetched;
  if (fetched.status !== 200 || fetched.body === null || fetched.body.length > MAX_BODY_BYTES) {
    return { level: 0, origin };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fetched.body);
  } catch {
    return { level: 0, origin };
  }
  if (!isObject(parsed)) return { level: 0, origin };

  const { version, site } = parsed;
  if (typeof version !== "string" || !/^1\./.test(version) || typeof site !== "string") {
    return { level: 0, origin };
  }
  const policy = parsed as AgentPolicy;

  let level: 1 | 2 | 3 = 1;
  if (nonEmptyArray(policy.actions)) level = 2;
  const hasGovernance =
    nonEmptyArray(policy.requires_human) ||
    nonEmptyArray(policy.prohibited) ||
    isObject(policy.consent) ||
    isObject(policy.safety);
  if (hasGovernance) level = 3;

  return { level, origin, policy };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bunx vitest run src/handlers/policy/parseAgentPolicy.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 6: Typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/extension/src/handlers/policy/policyTypes.ts packages/extension/src/handlers/policy/parseAgentPolicy.ts packages/extension/src/handlers/policy/parseAgentPolicy.test.ts
git commit -F - <<'MSG'
feat(extension): Agent Policy types + parseAgentPolicy (level classifier)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 2: Fetch script + `getAgentPolicy` orchestrator + registry wiring

**Files:**
- Create: `packages/extension/src/handlers/policy/fetchPolicyScript.ts`
- Create: `packages/extension/src/handlers/policy/getAgentPolicy.ts`
- Test: `packages/extension/src/handlers/policy/getAgentPolicy.test.ts`
- Modify: `packages/extension/src/handlers/registry.ts`
- Modify: `packages/extension/src/handlers/registry.test.ts`

- [ ] **Step 1: Create the page-side fetch script**

Create `packages/extension/src/handlers/policy/fetchPolicyScript.ts` (page-side string; not unit-tested, like `markScript.ts`/`collectorScript.ts` — the orchestrator test supplies its result):

```ts
/**
 * Page-side fetch of the origin's /agent.json, run via Runtime.evaluate
 * (returnByValue + awaitPromise). Same-origin, so no extra host permission; uses
 * the page session (harmless for a public policy file, and the mechanism
 * invokeStructuredAction will reuse with cookies). Returns a PolicyFetch shape;
 * a network/throw error becomes { status: 0, body: null }.
 */
export const FETCH_POLICY_JS = `(async () => {
  try {
    const r = await fetch('/agent.json', { headers: { Accept: 'application/agent-policy+json, application/json' } });
    return { origin: location.origin, status: r.status, body: r.ok ? await r.text() : null };
  } catch {
    return { origin: location.origin, status: 0, body: null };
  }
})()`;
```

- [ ] **Step 2: Write the failing test for the orchestrator**

Create `packages/extension/src/handlers/policy/getAgentPolicy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fakeCdp } from "../../cdp/testCdp";
import { NO_TAB_BOUND } from "../../tabs/agentTabs";
import type { CdpClient } from "../../cdp/cdpClient";
import { getAgentPolicy } from "./getAgentPolicy";
import type { PolicyFetch } from "./policyTypes";

/** fakeCdp returns a canned CDP eval result wrapping the page value. */
function cdpReturning(value: unknown) {
  return fakeCdp({ "Runtime.evaluate": { result: { value } } });
}
const policyFetch = (body: string | null, status = 200): PolicyFetch => ({
  origin: "https://shop.example",
  status,
  body,
});

describe("getAgentPolicy", () => {
  it("fetches, parses, and classifies the policy (level 2 with actions)", async () => {
    const body = JSON.stringify({ version: "1.0", site: "shop", actions: [{ name: "x", endpoint: "GET /x" }] });
    const res = await getAgentPolicy(cdpReturning(policyFetch(body)), {});
    expect(res.level).toBe(2);
    expect(res.origin).toBe("https://shop.example");
    expect(res.policy?.site).toBe("shop");
  });

  it("returns level 0 when the page fetch failed (status 0)", async () => {
    const res = await getAgentPolicy(cdpReturning(policyFetch(null, 0)), {});
    expect(res).toEqual({ level: 0, origin: "https://shop.example" });
  });

  it("returns level 0 when the evaluate result is malformed (no value)", async () => {
    // evaluateExpression returns undefined when the eval result has no `result`.
    const res = await getAgentPolicy(fakeCdp({ "Runtime.evaluate": {} }), {});
    expect(res).toEqual({ level: 0, origin: null });
  });

  it("propagates an unbound-tab error", async () => {
    const cdp: CdpClient = { send: () => Promise.reject(new Error(NO_TAB_BOUND)) };
    await expect(getAgentPolicy(cdp, {})).rejects.toThrow(NO_TAB_BOUND);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bunx vitest run src/handlers/policy/getAgentPolicy.test.ts`
Expected: FAIL — `getAgentPolicy` cannot be imported.

- [ ] **Step 4: Implement the orchestrator**

Create `packages/extension/src/handlers/policy/getAgentPolicy.ts`:

```ts
import type { CdpClient } from "../../cdp/cdpClient";
import { evaluateExpression } from "../evaluate";
import { FETCH_POLICY_JS } from "./fetchPolicyScript";
import { parseAgentPolicy } from "./parseAgentPolicy";
import type { AgentPolicyResult, PolicyFetch } from "./policyTypes";

/** Normalize the (page-supplied, untrusted) evaluate result into a PolicyFetch. */
function coerceFetch(v: unknown): PolicyFetch {
  if (typeof v === "object" && v !== null) {
    const o = v as Record<string, unknown>;
    return {
      origin: typeof o.origin === "string" ? o.origin : null,
      status: typeof o.status === "number" ? o.status : 0,
      body: typeof o.body === "string" ? o.body : null,
    };
  }
  return { origin: null, status: 0, body: null };
}

/**
 * Fetch + classify the active page's /agent.json (advisory). Runs a same-origin
 * fetch in the page via evaluate, then classifies with parseAgentPolicy. Takes no
 * parameters (`args` is ignored).
 */
export async function getAgentPolicy(
  cdp: CdpClient,
  _args: Record<string, unknown>,
): Promise<AgentPolicyResult> {
  const fetched = await evaluateExpression(cdp, FETCH_POLICY_JS);
  return parseAgentPolicy(coerceFetch(fetched));
}
```

- [ ] **Step 5: Run the orchestrator test to verify it passes**

Run: `bunx vitest run src/handlers/policy/getAgentPolicy.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Register the tool**

In `packages/extension/src/handlers/registry.ts`, add the import after the `learnPageActions` import line:

```ts
import { learnPageActions } from "./learn/learnPageActions";
import { getAgentPolicy } from "./policy/getAgentPolicy";
```

Register it. Find:

```ts
    // Group 9 (partial) — page understanding.
    learnPageActions: (args) => learnPageActions(cdp, events, sleep, args),
  };
```

Replace with:

```ts
    // Group 9 (partial) — page understanding.
    learnPageActions: (args) => learnPageActions(cdp, events, sleep, args),
    getAgentPolicy: onCdp(getAgentPolicy),
  };
```

- [ ] **Step 7: Update the registry test**

In `packages/extension/src/handlers/registry.test.ts`, add to `EXPECTED_TOOLS`. Find:

```ts
  // group 9 (partial) — page understanding
  "learnPageActions",
];
```

Replace with:

```ts
  // group 9 (partial) — page understanding
  "learnPageActions",
  "getAgentPolicy",
];
```

- [ ] **Step 8: Run the full extension suite + coverage + typecheck + lint**

Run: `bun run test && bun run typecheck && bun run lint`
Expected: PASS. ≥90% coverage holds — `parseAgentPolicy` + `getAgentPolicy` are fully tested; `policyTypes.ts` is type-only (no runtime statements); `fetchPolicyScript.ts` is covered by import (its `const` evaluates) though the page-side string isn't executed.

Note: the registry "dispatches every advertised tool…" smoke test calls `getAgentPolicy({ timeoutMs: 0 })` with the default `fakeCdp()`, whose `Runtime.evaluate` returns `undefined` → `evaluateExpression` rejects → the handler rejects. That test wraps each call in `.catch(() => undefined)`, so the async rejection is expected and fine (it only asserts no *synchronous* throw).

- [ ] **Step 9: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/extension/src/handlers/policy/fetchPolicyScript.ts packages/extension/src/handlers/policy/getAgentPolicy.ts packages/extension/src/handlers/policy/getAgentPolicy.test.ts packages/extension/src/handlers/registry.ts packages/extension/src/handlers/registry.test.ts
git commit -F - <<'MSG'
feat(extension): getAgentPolicy tool — fetch + classify /agent.json (advisory)

The handler runs a page-side same-origin fetch of /agent.json via evaluate and
classifies it with parseAgentPolicy, returning {level, origin, policy}. Advisory
only (the agent reads prohibited/requires_human and self-governs; no enforcement).
Registered as the getAgentPolicy wire tool. parseAgentPolicy + fetchPolicyScript
are the reusable resolver for invokeStructuredAction + navigate-enrichment.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

## Self-Review

**1. Spec coverage.**
- Fetch `/agent.json` via page-side evaluate → Task 2 `fetchPolicyScript` + orchestrator.
- Parse + classify level 0–3 (max-wins; 0 on fetch-fail/non-JSON/non-object/bad-version; 1 basic; 2 actions; 3 governance) → Task 1 `parseAgentPolicy` (+ all level cases tested).
- Return `{ level, origin, policy }`; origin reported even at level 0 → Task 1 + Task 2 (coerceFetch preserves origin).
- Advisory only / no enforcement / no caching → nothing added beyond the tool (by omission); stated in the spec.
- Oversized-body guard → Task 1 `MAX_BODY_BYTES` (+ test).
- Reusable resolver (`parseAgentPolicy` + `fetchPolicyScript`) → both are standalone modules.
- NO_TAB_BOUND propagation → Task 2 (test).
- Registry wiring → Task 2.
  No spec requirement is left without a task.

**2. Placeholder scan.** No "TBD"/"TODO"/"handle edge cases"/"similar to Task N". Every code step shows complete code; test steps show full tests; commands show expected outcomes; the untested-fetch-string and smoke-test interaction are stated explicitly. ✓

**3. Type consistency.** `PolicyFetch` (`{origin, status, body}`), `AgentPolicy`, `AgentPolicyResult` (`{level, origin, policy?}`), `AgentAction` are defined once in Task 1 `policyTypes.ts` and consumed unchanged by `parseAgentPolicy` (Task 1) and `getAgentPolicy`/`coerceFetch` (Task 2). `parseAgentPolicy(fetched: PolicyFetch)` and `getAgentPolicy(cdp, _args)` match every call site (tests + registry `onCdp(getAgentPolicy)`). `evaluateExpression(cdp, expr)` is the real signature from `handlers/evaluate.ts`. The wire name `getAgentPolicy` matches the `-e` script's `bridge("getAgentPolicy", {})` and the registry key. The fetch script returns exactly the `PolicyFetch` fields `coerceFetch`/`parseAgentPolicy` read. ✓
