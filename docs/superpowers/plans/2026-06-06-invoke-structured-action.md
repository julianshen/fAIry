# invokeStructuredAction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `invokeStructuredAction` extension tool that invokes a site-declared `/agent.json` action by name via the page's authenticated session, returning `{ status, ok, body }`.

**Architecture:** The handler resolves the page's Agent Policy (a `resolvePolicy` extracted from `getAgentPolicy`, injected for testability), finds the named action, builds + validates the request with a pure `buildActionRequest`, then `evaluate`s a page-side `fetch` (`credentials:'include'`) built by a pure `buildFetchExpression`. Pure executor (advisory) — declared-action-only, same-origin, `auth` none|cookie; no policy-gating / rate-limit / retry.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), Vitest (extension ≥90% gate), the extension CDP handler pattern (`fakeCdp`, `evaluateExpression`, `args.ts` validators).

**Spec:** `docs/superpowers/specs/2026-06-06-invoke-structured-action-design.md`.

---

## File structure

In `packages/extension/src/handlers/policy/`:
- `resolvePolicy.ts` — **new**; `resolvePolicy(cdp)` extracted from `getAgentPolicy.ts` (+ `coerceFetch`).
- `getAgentPolicy.ts` — **modify**; delegate to `resolvePolicy`.
- `policyTypes.ts` — **modify**; add `ActionRequest`, `InvokeResult`.
- `buildActionRequest.ts` — **new**; pure request builder.
- `invokeStructuredAction.ts` — **new**; orchestrator + pure `buildFetchExpression` + `coerceInvokeResult` + `ResolvePolicy` type.
- `registry.ts` / `registry.test.ts` — **modify**; register `invokeStructuredAction`.

Run from `packages/extension/`. Single-file test: `bunx vitest run src/handlers/policy/<file>.test.ts`. Commit trailer MUST be exactly:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 1: Extract `resolvePolicy` (shared resolver)

**Files:**
- Create: `packages/extension/src/handlers/policy/resolvePolicy.ts`
- Modify: `packages/extension/src/handlers/policy/getAgentPolicy.ts`

This is a refactor — `getAgentPolicy`'s existing tests are the safety net (behavior unchanged), so no new test.

- [ ] **Step 1: Create `resolvePolicy.ts`** (move `coerceFetch` + the fetch/parse chain out of `getAgentPolicy.ts`):

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
 * Resolve + classify the active page's /agent.json (advisory): run a same-origin
 * fetch in the page via evaluate, then classify with parseAgentPolicy. Shared by
 * getAgentPolicy and invokeStructuredAction.
 */
export async function resolvePolicy(cdp: CdpClient): Promise<AgentPolicyResult> {
  const fetched = await evaluateExpression(cdp, FETCH_POLICY_JS);
  return parseAgentPolicy(coerceFetch(fetched));
}
```

- [ ] **Step 2: Refactor `getAgentPolicy.ts` to delegate.** Replace the ENTIRE file with:

```ts
import type { CdpClient } from "../../cdp/cdpClient";
import type { AgentPolicyResult } from "./policyTypes";
import { resolvePolicy } from "./resolvePolicy";

/**
 * Fetch + classify the active page's /agent.json (advisory). Delegates to the
 * shared resolver; takes no parameters (`args` is ignored).
 */
export async function getAgentPolicy(
  cdp: CdpClient,
  _args: Record<string, unknown>,
): Promise<AgentPolicyResult> {
  return resolvePolicy(cdp);
}
```

- [ ] **Step 3: Verify the existing tests still pass** (the refactor's safety net)

Run: `bunx vitest run src/handlers/policy/getAgentPolicy.test.ts && bun run typecheck && bun run lint`
Expected: PASS — `getAgentPolicy`'s 4 tests unchanged (they exercise `resolvePolicy` + `coerceFetch` transitively); typecheck/lint clean.

- [ ] **Step 4: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/extension/src/handlers/policy/resolvePolicy.ts packages/extension/src/handlers/policy/getAgentPolicy.ts
git commit -F - <<'MSG'
refactor(extension): extract resolvePolicy (shared by getAgentPolicy + invoke)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 2: `ActionRequest`/`InvokeResult` types + `buildActionRequest`

**Files:**
- Modify: `packages/extension/src/handlers/policy/policyTypes.ts`
- Create: `packages/extension/src/handlers/policy/buildActionRequest.ts`
- Test: `packages/extension/src/handlers/policy/buildActionRequest.test.ts`

- [ ] **Step 1: Add the types to `policyTypes.ts`** — append at the end:

```ts
/** A validated, ready-to-issue request derived from an AgentAction + args. */
export interface ActionRequest {
  method: string; // GET | POST | PUT | PATCH | DELETE | HEAD
  path: string; // origin-relative, with :params substituted (e.g. "/api/orders/42")
  body?: Record<string, unknown>; // JSON body for write methods; absent for GET/HEAD
}

/** What the page-side fetch returns / invokeStructuredAction returns to the agent. */
export interface InvokeResult {
  status: number; // HTTP status, or 0 on a network/throw error
  ok: boolean; // response.ok (false on 4xx/5xx and on network error)
  body: unknown; // parsed JSON, or raw text, or an error string
}
```

- [ ] **Step 2: Write the failing test**

Create `packages/extension/src/handlers/policy/buildActionRequest.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildActionRequest } from "./buildActionRequest";
import type { AgentAction } from "./policyTypes";

const action = (over: Partial<AgentAction>): AgentAction => ({ name: "a", endpoint: "GET /x", ...over });

describe("buildActionRequest", () => {
  it("builds a GET with no body", () => {
    expect(buildActionRequest(action({ endpoint: "GET /api/items" }), {})).toEqual({
      method: "GET",
      path: "/api/items",
    });
  });

  it("builds a write method with the args as the JSON body", () => {
    expect(buildActionRequest(action({ endpoint: "POST /api/orders" }), { qty: 2 })).toEqual({
      method: "POST",
      path: "/api/orders",
      body: { qty: 2 },
    });
  });

  it("substitutes and URL-encodes path params from args", () => {
    expect(buildActionRequest(action({ endpoint: "GET /api/o/:id" }), { id: "a b" }).path).toBe("/api/o/a%20b");
  });

  it("upper-cases the method", () => {
    expect(buildActionRequest(action({ endpoint: "post /x" }), {}).method).toBe("POST");
  });

  it("throws on a malformed endpoint", () => {
    expect(() => buildActionRequest(action({ endpoint: "nonsense" }), {})).toThrow(/malformed endpoint/);
  });

  it("throws listing missing required args from args_schema", () => {
    expect(() =>
      buildActionRequest(action({ endpoint: "POST /x", args_schema: { email: "string", name: "string" } }), { email: "a@b" }),
    ).toThrow(/missing required args: name/);
  });

  it("throws on a missing path param", () => {
    expect(() => buildActionRequest(action({ endpoint: "GET /o/:id" }), {})).toThrow(/missing path param "id"/);
  });

  it("throws on unsupported auth", () => {
    expect(() => buildActionRequest(action({ endpoint: "GET /x", auth: "bearer" }), {})).toThrow(/not supported in v1/);
  });

  it("allows none/cookie/undefined auth", () => {
    expect(buildActionRequest(action({ endpoint: "GET /x", auth: "cookie" }), {}).method).toBe("GET");
    expect(buildActionRequest(action({ endpoint: "GET /x", auth: "none" }), {}).method).toBe("GET");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bunx vitest run src/handlers/policy/buildActionRequest.test.ts`
Expected: FAIL — `buildActionRequest` cannot be imported.

- [ ] **Step 4: Implement `buildActionRequest`**

Create `packages/extension/src/handlers/policy/buildActionRequest.ts`:

```ts
import type { ActionRequest, AgentAction } from "./policyTypes";

const ENDPOINT_RE = /^(GET|POST|PUT|PATCH|DELETE|HEAD)\s+(\/\S*)$/i;
const PARAM_RE = /:([A-Za-z_][A-Za-z0-9_]*)/g;

/**
 * Turn a declared AgentAction + call args into a validated, origin-relative
 * request. Pure; throws a clear Error on any invalid input (malformed endpoint,
 * missing required args, unmet path param, unsupported auth).
 */
export function buildActionRequest(action: AgentAction, args: Record<string, unknown>): ActionRequest {
  const m = ENDPOINT_RE.exec(action.endpoint);
  if (!m) throw new Error(`invokeStructuredAction: malformed endpoint "${action.endpoint}"`);
  const method = m[1]!.toUpperCase();
  const rawPath = m[2]!;

  if (action.auth !== undefined && action.auth !== "none" && action.auth !== "cookie") {
    throw new Error(`invokeStructuredAction: auth "${action.auth}" not supported in v1`);
  }

  if (action.args_schema) {
    const missing = Object.keys(action.args_schema).filter((k) => !(k in args));
    if (missing.length > 0) {
      throw new Error(`invokeStructuredAction: missing required args: ${missing.join(", ")}`);
    }
  }

  const path = rawPath.replace(PARAM_RE, (_full, name: string) => {
    if (!(name in args)) throw new Error(`invokeStructuredAction: missing path param "${name}"`);
    return encodeURIComponent(String(args[name]));
  });

  if (method === "GET" || method === "HEAD") return { method, path };
  return { method, path, body: args };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bunx vitest run src/handlers/policy/buildActionRequest.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/extension/src/handlers/policy/policyTypes.ts packages/extension/src/handlers/policy/buildActionRequest.ts packages/extension/src/handlers/policy/buildActionRequest.test.ts
git commit -F - <<'MSG'
feat(extension): buildActionRequest — validate + build a structured-action request

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 3: `invokeStructuredAction` orchestrator + registry wiring

**Files:**
- Create: `packages/extension/src/handlers/policy/invokeStructuredAction.ts`
- Test: `packages/extension/src/handlers/policy/invokeStructuredAction.test.ts`
- Modify: `packages/extension/src/handlers/registry.ts`
- Modify: `packages/extension/src/handlers/registry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/extension/src/handlers/policy/invokeStructuredAction.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fakeCdp } from "../../cdp/testCdp";
import { NO_TAB_BOUND } from "../../tabs/agentTabs";
import type { CdpClient } from "../../cdp/cdpClient";
import { buildFetchExpression, invokeStructuredAction, type ResolvePolicy } from "./invokeStructuredAction";
import type { AgentPolicyResult } from "./policyTypes";

const policyWith = (actions: unknown): AgentPolicyResult =>
  ({ level: 2, origin: "https://shop.example", policy: { version: "1.0", site: "shop", actions } } as AgentPolicyResult);
const resolveTo =
  (result: AgentPolicyResult): ResolvePolicy =>
  () =>
    Promise.resolve(result);
/** fakeCdp answers the action fetch (the only evaluate the orchestrator itself runs). */
const cdpReturning = (value: unknown) => fakeCdp({ "Runtime.evaluate": { result: { value } } });

describe("buildFetchExpression", () => {
  it("injects method/path/credentials and a JSON body for writes", () => {
    const expr = buildFetchExpression({ method: "POST", path: "/api/orders", body: { qty: 2 } });
    expect(expr).toContain('location.origin + "/api/orders"');
    expect(expr).toContain('"POST"');
    expect(expr).toContain("credentials: 'include'");
    expect(expr).toContain("application/json");
    expect(expr).toContain(JSON.stringify(JSON.stringify({ qty: 2 })));
  });

  it("omits the body for a GET", () => {
    const expr = buildFetchExpression({ method: "GET", path: "/api/items" });
    expect(expr).not.toContain("body:");
  });
});

describe("invokeStructuredAction", () => {
  const actions = [{ name: "checkout", endpoint: "POST /api/checkout" }];

  it("invokes a declared action and returns the response", async () => {
    const res = await invokeStructuredAction(
      cdpReturning({ status: 200, ok: true, body: { orderId: 7 } }),
      resolveTo(policyWith(actions)),
      { actionName: "checkout", args: { qty: 1 } },
    );
    expect(res).toEqual({ status: 200, ok: true, body: { orderId: 7 } });
  });

  it("returns an HTTP error result instead of throwing (403)", async () => {
    const res = await invokeStructuredAction(
      cdpReturning({ status: 403, ok: false, body: "denied" }),
      resolveTo(policyWith(actions)),
      { actionName: "checkout" },
    );
    expect(res).toEqual({ status: 403, ok: false, body: "denied" });
  });

  it("throws when the page has no declared actions", async () => {
    await expect(
      invokeStructuredAction(cdpReturning({}), resolveTo(policyWith([])), { actionName: "checkout" }),
    ).rejects.toThrow(/no declared agent actions/);
  });

  it("throws when the named action is not declared", async () => {
    await expect(
      invokeStructuredAction(cdpReturning({}), resolveTo(policyWith(actions)), { actionName: "refund" }),
    ).rejects.toThrow(/"refund" is not declared/);
  });

  it("throws when actionName is missing", async () => {
    await expect(
      invokeStructuredAction(cdpReturning({}), resolveTo(policyWith(actions)), {}),
    ).rejects.toThrow(/actionName/);
  });

  it("normalizes a malformed evaluate result", async () => {
    const res = await invokeStructuredAction(
      fakeCdp({ "Runtime.evaluate": {} }),
      resolveTo(policyWith(actions)),
      { actionName: "checkout" },
    );
    expect(res).toEqual({ status: 0, ok: false, body: null });
  });

  it("propagates an unbound-tab error from the action fetch", async () => {
    const cdp: CdpClient = { send: () => Promise.reject(new Error(NO_TAB_BOUND)) };
    await expect(
      invokeStructuredAction(cdp, resolveTo(policyWith(actions)), { actionName: "checkout" }),
    ).rejects.toThrow(NO_TAB_BOUND);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run src/handlers/policy/invokeStructuredAction.test.ts`
Expected: FAIL — `invokeStructuredAction` cannot be imported.

- [ ] **Step 3: Implement the orchestrator**

Create `packages/extension/src/handlers/policy/invokeStructuredAction.ts`:

```ts
import type { CdpClient } from "../../cdp/cdpClient";
import { optionalObject, requireString } from "../args";
import { evaluateExpression } from "../evaluate";
import { buildActionRequest } from "./buildActionRequest";
import type { ActionRequest, AgentPolicyResult, InvokeResult } from "./policyTypes";

/** The page-policy resolver, injected so the orchestrator's two evaluates stay testable. */
export type ResolvePolicy = (cdp: CdpClient) => Promise<AgentPolicyResult>;

/** Build the page-side fetch IIFE for a request (values injected JSON-safe; same-origin + cookies). */
export function buildFetchExpression(req: ActionRequest): string {
  const init: string[] = [`method: ${JSON.stringify(req.method)}`, `credentials: 'include'`];
  if (req.body !== undefined) {
    init.push(`headers: { 'Content-Type': 'application/json' }`);
    init.push(`body: ${JSON.stringify(JSON.stringify(req.body))}`);
  }
  return `(async () => {
  try {
    const r = await fetch(location.origin + ${JSON.stringify(req.path)}, { ${init.join(", ")} });
    const text = await r.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    return { status: r.status, ok: r.ok, body };
  } catch (e) {
    return { status: 0, ok: false, body: String(e) };
  }
})()`;
}

/** Normalize the (page-supplied) evaluate result into an InvokeResult. */
function coerceInvokeResult(v: unknown): InvokeResult {
  if (typeof v === "object" && v !== null) {
    const o = v as Record<string, unknown>;
    return {
      status: typeof o.status === "number" ? o.status : 0,
      ok: o.ok === true,
      body: "body" in o ? o.body : null,
    };
  }
  return { status: 0, ok: false, body: null };
}

/**
 * Invoke a site-declared structured action by name via the page session. Resolves
 * the page policy, finds the action, builds + validates the request, and evaluates
 * a same-origin fetch (credentials included). The HTTP outcome (incl. 4xx/5xx) is
 * returned; only "can't invoke" conditions (no actions / unknown name / bad args)
 * throw.
 */
export async function invokeStructuredAction(
  cdp: CdpClient,
  resolve: ResolvePolicy,
  args: Record<string, unknown>,
): Promise<InvokeResult> {
  const actionName = requireString(args, "actionName");
  const callArgs = optionalObject(args, "args", {});

  const result = await resolve(cdp);
  const actions = result.policy?.actions;
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new Error("invokeStructuredAction: this page has no declared agent actions");
  }
  const action = actions.find((a) => a.name === actionName);
  if (!action) {
    throw new Error(`invokeStructuredAction: action "${actionName}" is not declared in this page's policy`);
  }

  const req = buildActionRequest(action, callArgs);
  const raw = await evaluateExpression(cdp, buildFetchExpression(req));
  return coerceInvokeResult(raw);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run src/handlers/policy/invokeStructuredAction.test.ts`
Expected: PASS (9 tests: 2 buildFetchExpression + 7 orchestrator).

- [ ] **Step 5: Register the tool**

In `packages/extension/src/handlers/registry.ts`, add the import after the `getAgentPolicy` import line:

```ts
import { getAgentPolicy } from "./policy/getAgentPolicy";
import { resolvePolicy } from "./policy/resolvePolicy";
import { invokeStructuredAction } from "./policy/invokeStructuredAction";
```

Register it. Find:

```ts
    // Group 9 (partial) — page understanding.
    learnPageActions: (args) => learnPageActions(cdp, events, sleep, args),
    getAgentPolicy: onCdp(getAgentPolicy),
  };
```

Replace with:

```ts
    // Group 9 (partial) — page understanding.
    learnPageActions: (args) => learnPageActions(cdp, events, sleep, args),
    getAgentPolicy: onCdp(getAgentPolicy),
    invokeStructuredAction: (args) => invokeStructuredAction(cdp, resolvePolicy, args),
  };
```

- [ ] **Step 6: Update the registry test**

In `packages/extension/src/handlers/registry.test.ts`, add to `EXPECTED_TOOLS`. Find:

```ts
  "learnPageActions",
  "getAgentPolicy",
];
```

Replace with:

```ts
  "learnPageActions",
  "getAgentPolicy",
  "invokeStructuredAction",
];
```

- [ ] **Step 7: Run the full suite + coverage + typecheck + lint**

Run: `bun run test && bun run typecheck && bun run lint`
Expected: PASS. ≥90% coverage holds — `buildActionRequest`, `buildFetchExpression`, `coerceInvokeResult`, and the orchestrator are covered by Tasks 2–3; `resolvePolicy` by `getAgentPolicy`'s tests.

Note: the registry "dispatches every advertised tool…" smoke test calls `invokeStructuredAction({ timeoutMs: 0 })` with the default `fakeCdp()`. `requireString(args, "actionName")` throws synchronously? No — it throws inside the async function, so it rejects. That test wraps each call in `.catch(() => undefined)`, so the rejection (`actionName must be a string`) is expected and fine.

- [ ] **Step 8: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/extension/src/handlers/policy/invokeStructuredAction.ts packages/extension/src/handlers/policy/invokeStructuredAction.test.ts packages/extension/src/handlers/registry.ts packages/extension/src/handlers/registry.test.ts
git commit -F - <<'MSG'
feat(extension): invokeStructuredAction — call a declared /agent.json action

Resolves the page policy (shared resolver), finds the named action, builds +
validates the request, and evaluates a same-origin fetch with credentials in the
page. Pure executor (advisory): declared-action-only, auth none|cookie; HTTP
errors are returned, not thrown. Registered as the invokeStructuredAction wire tool.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

## Self-Review

**1. Spec coverage.**
- Resolve policy via the shared resolver (DI'd) → Task 1 `resolvePolicy` + Task 3 orchestrator.
- Find named action; throw if no declared actions / not found → Task 3.
- `buildActionRequest` rules (method/path parse, required-args, `:param` substitution + encode, auth none|cookie, body for writes) → Task 2 (+ all cases tested).
- Page-side same-origin fetch with `credentials:'include'`, JSON-injected → Task 3 `buildFetchExpression` (+ tests).
- Return `{status, ok, body}`; HTTP errors returned not thrown; malformed result normalized; network throw → status 0 → Task 3 (`coerceInvokeResult` + the in-page catch + tests).
- Non-goals (no gating / rate-limit / retry; same-origin; auth none|cookie) → enforced by omission + `buildActionRequest`/`buildFetchExpression`.
- `ActionRequest`/`InvokeResult` types → Task 2.
- Registry wiring + wire name `invokeStructuredAction` (matches `-e` `bridge("invokeStructuredAction")`) → Task 3.
- `resolvePolicy` extraction keeps `getAgentPolicy` green → Task 1.
  No spec requirement is left without a task.

**2. Placeholder scan.** No "TBD"/"TODO"/"handle edge cases"/"similar to Task N". Every code step shows complete code; tests are full; commands have expected outcomes; the smoke-test interaction is stated. ✓

**3. Type consistency.** `ActionRequest` (`{method, path, body?}`) and `InvokeResult` (`{status, ok, body}`) defined in Task 2 `policyTypes.ts`, consumed by `buildActionRequest` (Task 2) and `buildFetchExpression`/`coerceInvokeResult`/orchestrator (Task 3). `AgentAction` (existing) read by `buildActionRequest`. `ResolvePolicy = (cdp) => Promise<AgentPolicyResult>` matches `resolvePolicy`'s signature (Task 1) and the registry call `invokeStructuredAction(cdp, resolvePolicy, args)`. `buildActionRequest(action, args)`, `buildFetchExpression(req)`, `invokeStructuredAction(cdp, resolve, args)` match every call site (tests + registry). `optionalObject`/`requireString` are the real `args.ts` validators. ✓
