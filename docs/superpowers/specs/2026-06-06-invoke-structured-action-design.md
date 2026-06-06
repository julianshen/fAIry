# invokeStructuredAction — design

**Status:** approved (design phase) · **Date:** 2026-06-06 · **Component:** Chrome extension (M4 tool layer) · **Builds on:** getAgentPolicy (#42 — the resolver) · **Part of:** M4 "PR4" decomposition.

## Context

A site's `/agent.json` (Agent Policy v1) can declare structured `actions` — named
HTTP endpoints an agent may call directly instead of clicking through the UI (e.g.
`{ name: "checkout", endpoint: "POST /api/checkout", auth: "cookie" }`).
`invokeStructuredAction` lets the agent call one by name: it resolves the page's
policy, finds the action, and issues the HTTP request **from the page** (so it uses
the user's authenticated session/cookies), returning the response.

The Pi `-e` script already registers `browser_invoke_structured_action`
(`{ actionName, args? }` → `invokeStructuredAction`); the handler is a stub. The
`getAgentPolicy` resolver (`parseAgentPolicy` + `fetchPolicyScript`, merged in #42)
is reused here.

This is a production reimplementation of the POC's `StructuredActionInvoker`,
trimmed to a v1 **pure executor**.

## Goal & non-goals

**Goal:** an `invokeStructuredAction` handler that, given `{ actionName, args }`,
invokes the site-declared action via the page session and returns
`{ status, ok, body }`.

**Non-goals (v1) — deferred, noted:**
- **No consent / `requires_human` / `prohibited` gating.** Pure executor: the site
  declaring an action in `/agent.json` is the permission; the agent self-governs by
  reading the (advisory) policy. Enforcement (consent modes + human-gate UX) is the
  separate deferred sub-project.
- **No rate-limiting.** The site's `rate_limit` is not enforced — an ephemeral MV3
  service worker can't hold reliable per-action timers, and the agent isn't a
  runaway loop. Deferred.
- **No idempotent-retry.** A single attempt (the POC retried `idempotent` actions
  once); deferred.
- `auth`: only `none`/`cookie` (reject `bearer`/header, as the POC did).
- Same-origin only (the endpoint path is issued against `location.origin`).

## Decisions (and why)

1. **Run the request in the page via `evaluate`, with `credentials: 'include'`.** The
   whole point of a structured action is to use the user's authenticated session —
   so the `fetch` runs in the page's main world (same mechanism as the resolver),
   not from the extension SW.
2. **Pure executor (advisory).** Invoke any *declared* action after validating it's
   well-formed; no policy-gating (consistent with the advisory `getAgentPolicy`).
3. **Resolver via dependency injection.** The orchestrator takes `resolve(cdp)` as a
   parameter so its two `evaluate`s (policy fetch, then action fetch — both
   `Runtime.evaluate`) can be tested independently (the test stubs `resolve` and lets
   `fakeCdp` answer only the action fetch).
4. **Same-origin, declared-only.** The request URL is `location.origin` + the
   action's path; the action must exist in `policy.actions`. These are the inherent
   guardrails (the site opted the action in; the agent can't hit an arbitrary URL).

## Architecture & components

In the existing `packages/extension/src/handlers/policy/` group:

- **`resolvePolicy.ts`** (new) — extract `resolvePolicy(cdp): Promise<AgentPolicyResult>`
  (the `evaluateExpression(FETCH_POLICY_JS)` + `coerceFetch` + `parseAgentPolicy`
  chain) out of `getAgentPolicy.ts`; refactor `getAgentPolicy.ts` to call it. (DRY:
  `getAgentPolicy` and `invokeStructuredAction` share one resolver. `coerceFetch`
  moves here too.)
- **`buildActionRequest.ts`** (new) — pure `buildActionRequest(action: AgentAction,
  args: Record<string, unknown>): ActionRequest`. Parses `endpoint`, substitutes path
  `:param`s, validates args/auth, computes the body. Throws `Error` with a clear
  message on any invalid input.
- **`invokeStructuredAction.ts`** (new) — the orchestrator handler + a pure
  `buildFetchExpression(req: ActionRequest): string` (the injected page-side fetch).
- **`registry.ts`** — register `invokeStructuredAction: (args) => invokeStructuredAction(cdp, resolvePolicy, args)`.

## Schema (the shapes)

`AgentAction` already exists (policyTypes.ts, from #42): `{ name, endpoint,
args_schema?, auth?, rate_limit?, idempotent? }`.

```ts
/** A validated, ready-to-issue request derived from an AgentAction + args. */
export interface ActionRequest {
  method: string; // GET | POST | PUT | PATCH | DELETE | HEAD
  path: string; // origin-relative, with :params substituted (e.g. "/api/orders/42")
  body?: Record<string, unknown>; // JSON body for write methods; absent for GET/HEAD
}

/** What the page-side fetch returns / the tool returns to the agent. */
export interface InvokeResult {
  status: number; // HTTP status, or 0 on a network/throw error
  ok: boolean; // response.ok (false on 4xx/5xx and on network error)
  body: unknown; // parsed JSON, or raw text, or an error string
}
```

## `buildActionRequest` rules (pure)

- **Method + path:** `action.endpoint` must match `/^(GET|POST|PUT|PATCH|DELETE|HEAD)\s+(\/\S*)$/i`
  (an HTTP method + a space + an origin-relative path). Otherwise throw
  `invokeStructuredAction: malformed endpoint "<endpoint>"`. Method upper-cased.
- **Required args:** for each key in `action.args_schema` (if present), require it in
  `args`; collect missing keys and throw `invokeStructuredAction: missing required
  args: <keys>` if any.
- **Path params:** replace each `:name` path segment with `encodeURIComponent(String(args[name]))`;
  a `:name` with no `args[name]` → throw `invokeStructuredAction: missing path param "<name>"`.
- **Auth:** `action.auth` of `undefined`/`"none"`/`"cookie"` is allowed; anything else
  → throw `invokeStructuredAction: auth "<auth>" not supported in v1`.
- **Body:** `GET`/`HEAD` → no body; otherwise `body = args` (the full args object as JSON;
  path params are harmlessly duplicated).

## `buildFetchExpression` (pure) + execution

`buildFetchExpression(req)` returns a page-side IIFE string with `req` injected via
`JSON.stringify` (injection-safe). The fetch is same-origin (`location.origin + path`)
with `credentials: 'include'`:

```js
(async () => {
  try {
    const r = await fetch(location.origin + <path>, {
      method: <method>,
      credentials: 'include',
      <body ? `headers: { 'Content-Type': 'application/json' }, body: <jsonBody>,` : ``>
    });
    const text = await r.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    return { status: r.status, ok: r.ok, body };
  } catch (e) {
    return { status: 0, ok: false, body: String(e) };
  }
})()
```

The orchestrator runs it with `evaluateExpression` and returns the result coerced to
`InvokeResult`.

## Data flow

```text
invokeStructuredAction(cdp, resolve, { actionName, args })
  ▼ requireString(actionName); args = optionalObject(args, {})
  ▼ const policy = await resolve(cdp)            → AgentPolicyResult
  ▼ if level < 2 / no policy.actions → throw "no declared actions on this page"
  ▼ const action = policy.actions.find(a => a.name === actionName)
        → if !action → throw "action \"<name>\" is not declared in this page's policy"
  ▼ const req = buildActionRequest(action, args)   → { method, path, body? }  (throws on bad input)
  ▼ const raw = await evaluateExpression(cdp, buildFetchExpression(req))
  ▼ return coerceInvokeResult(raw)                 → { status, ok, body }
```

## Error handling

- `actionName` not a string → throw (via `requireString`).
- No usable policy / `level < 2` / `policy.actions` empty → throw.
- Action name not found → throw (clear message).
- `buildActionRequest` validation failures → throw (malformed endpoint, missing args,
  missing path param, unsupported auth).
- The HTTP outcome — including 4xx/5xx — is **returned** as `{ status, ok, body }`,
  not thrown (a declared action that returns 403 is a real result the agent acts on).
- A page-side fetch throw (network/CORS) → `{ status: 0, ok: false, body: <error> }`.
- A malformed `evaluate` result → `coerceInvokeResult` normalizes to
  `{ status: 0, ok: false, body: null }`.
- `NO_TAB_BOUND` from `evaluate` → propagates (start a task first).

## Testing

- **`buildActionRequest`** (pure, unit-tested directly): GET with no body; POST with a
  JSON body; `:param` substitution + encoding; required-arg-missing → throws; missing
  path-param → throws; malformed endpoint → throws; unsupported `auth` → throws;
  `none`/`cookie`/`undefined` auth allowed.
- **`buildFetchExpression`** (pure): the built string contains the JSON-injected
  method/path/body and `credentials: 'include'`; a GET produces no `body:`.
- **`invokeStructuredAction`** (orchestrator, with an injected fake `resolve` +
  `fakeCdp` for the action fetch): action found → returns `{ status, ok, body }`;
  `level < 2` → throws; action-not-found → throws; missing `actionName` → throws; a
  403 fetch result → **returned** (not thrown); a malformed evaluate result →
  `{ status: 0, ok: false, body: null }`.
- **`resolvePolicy`** + `getAgentPolicy` refactor: `getAgentPolicy`'s existing tests
  still pass against the extracted resolver (behavior unchanged).
- The page-side fetch executes in-page; its constructed string is verified via
  `buildFetchExpression`. ≥90% coverage holds via the pure builders + orchestrator.

## Sequencing

Single PR (this sub-project). Remaining M4-PR4: navigate-enrichment (reuses
`resolvePolicy` for the `agentPolicy` field), `proposeSave` (+ panel toast), and the
group-2 finishers (`reader_extract`, `waitFor` networkIdle). Enforcement
(consent/human-gate), rate-limiting, and idempotent-retry remain their own future
specs.
