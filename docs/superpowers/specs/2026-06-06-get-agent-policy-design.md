# getAgentPolicy (Agent Policy resolver) — design

**Status:** approved (design phase) · **Date:** 2026-06-06 · **Component:** Chrome extension (M4 tool layer) · **Part of:** M4 "PR4" decomposition — the foundation for `invokeStructuredAction` + navigate-enrichment.

## Context

A site can publish an **Agent Policy** at `/agent.json` (the silverhorizon.dev "Agent
Policy v1" spec) declaring what an agent may do: capabilities, structured `actions`,
`requires_human` gates, `prohibited` actions, consent modes, and safety limits. The
fAIry Chrome extension is a pure browser executor; the Pi `-e` script already
registers `browser_get_agent_policy` forwarding `getAgentPolicy` to the extension,
but the handler does not exist yet (it's a stub).

`getAgentPolicy` fetches the active page's `/agent.json`, classifies a `level` (0–3),
and returns `{ level, origin, policy }`. It is the **resolver** that the next
sub-project (`invokeStructuredAction`) reuses to look up a declared action by name,
and that navigate-enrichment reuses to attach `agentPolicy` to navigate results.

This is a production reimplementation of the POC's `AgentPolicyResolver` /
`HorizonBridgeServer.getAgentPolicy`, trimmed to an **advisory** v1.

## Goal & non-goals

**Goal:** a `getAgentPolicy` extension handler that returns
`{ level: 0|1|2|3, origin: string | null, policy?: AgentPolicy }` for the current
page, by fetching + parsing + classifying `/agent.json`.

**Non-goals (v1):**
- **No enforcement.** The tool is advisory — it returns the policy; the agent READS
  `prohibited`/`requires_human`/`consent` and adjusts its own plan. The POC's
  `AiActionGuard` (hard-gating click/type/navigate, consent prompts, human-gate UX)
  is a large cross-cutting feature deferred to its own sub-project.
- **No caching.** `getAgentPolicy` is an agent-initiated call (not per-action), so v1
  fetches on demand. ETag/TTL caching is a future optimization.
- **No daemon changes** — extension-only (the `-e` stub forwards it).
- Not invoking actions or enriching navigate — those are later sub-projects that
  reuse this resolver.

## Decisions (and why)

1. **Fetch via a page-side `evaluate`, not the SW's `fetch`.** The handler runs
   `fetch('/agent.json')` in the bound tab's page (same-origin to the site) via
   `Runtime.evaluate`. This needs no extra extension host permissions and fits the
   executor model (everything through CDP/the page) — mirrors learnPageActions'
   collector. `/agent.json` is public, so the page session isn't required, but using
   the page keeps the mechanism identical to what `invokeStructuredAction` needs (it
   *does* need the page's cookies).
2. **Advisory only** (see non-goals) — surface the contract; the agent self-governs.
3. **Pure `parseAgentPolicy` + thin orchestrator.** All classification/validation is a
   pure function (unit-tested directly); the handler only sequences the fetch.

## Architecture & components

A `packages/extension/src/handlers/policy/` module group (parallels `handlers/learn/`):

- **`policyTypes.ts`** — the policy shapes (see Schema): `AgentPolicy`, `AgentAction`,
  `AgentPolicyResult`, `PolicyFetch`.
- **`fetchPolicyScript.ts`** — the page-side JS string run via `Runtime.evaluate`
  (`returnByValue`, `awaitPromise`). Same-origin `fetch('/agent.json')` with the
  Agent-Policy `Accept` header; returns `{ origin, status, body }` (`status: 0` +
  `body: null` on a thrown/network error). Untested string (precedent: `markScript.ts`,
  `collectorScript.ts`).
- **`parseAgentPolicy.ts`** — pure `parseAgentPolicy(fetch: PolicyFetch): AgentPolicyResult`.
  Parses `body` as JSON, validates it's a v1 policy, classifies the level, never throws.
- **`getAgentPolicy.ts`** — orchestrator handler `getAgentPolicy(cdp, args)`:
  `evaluateExpression(cdp, FETCH_POLICY_JS)` → `parseAgentPolicy(result)`. Ignores
  `args` (the tool takes no parameters).
- **`registry.ts`** — register `getAgentPolicy: onCdp(getAgentPolicy)` (no new dep).

`parseAgentPolicy` + `fetchPolicyScript` are the reusable **resolver** for the next
sub-projects.

## Schema (the shapes)

```ts
/** A site-declared structured action (level >= 2). */
export interface AgentAction {
  name: string;
  endpoint: string; // "METHOD /path/:id"
  args_schema?: Record<string, unknown>;
  auth?: string; // "none" | "cookie" | ... (v1 invoker supports none/cookie)
  rate_limit?: string; // "N/s" | "N/m" | "N/h"
  idempotent?: boolean;
}

/** The /agent.json document (Agent Policy v1), typed for what we read; extra keys pass through. */
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

/** Raw result of the page-side fetch. */
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

## Level classification (pure, max-wins)

Given a successfully parsed JSON object `p`:
- **0** — fetch failed (`status !== 200` or `body === null`), `body` isn't valid JSON,
  `p` isn't an object, or `p.version` doesn't match `/^1\./` or `p.site` is missing.
- **1** — a valid v1 policy (passes the level-0 gate): `version` `1.x` + `site` string.
- **2** — level 1 **and** `Array.isArray(p.actions)` with `length > 0`.
- **3** — has any governance/contract field: a non-empty `requires_human[]` or
  `prohibited[]`, or a `consent` / `safety` object.

The returned `level` is the **maximum** applicable (so governance-without-actions is
still 3). When `level >= 1`, `policy` is the parsed `AgentPolicy`; at `level 0`,
`policy` is omitted and `origin` is whatever the fetch reported (may be set even on a
404).

## Data flow

```text
getAgentPolicy(cdp, args)
  ▼ evaluateExpression(cdp, FETCH_POLICY_JS)
  PolicyFetch { origin, status, body }
  ▼ parseAgentPolicy(fetch)
  AgentPolicyResult { level, origin, policy? }
```

The page-side fetch script:

```js
(async () => {
  try {
    const r = await fetch('/agent.json', { headers: { Accept: 'application/agent-policy+json, application/json' } });
    return { origin: location.origin, status: r.status, body: r.ok ? await r.text() : null };
  } catch {
    return { origin: location.origin, status: 0, body: null };
  }
})()
```

## Error handling

- Network error / CORS / thrown fetch → script returns `status: 0`, `body: null` → `level 0`.
- Non-200 (404/410/5xx) → `body: null` → `level 0` (origin still reported).
- `body` not valid JSON, or parsed value not an object → `level 0` (caught; never throws).
- Missing/invalid `version` or `site` → `level 0`.
- `NO_TAB_BOUND` from `evaluateExpression` (no task bound) → propagates, like every handler.
- Defensive: a `body` larger than a sane cap (e.g. 1 MiB) is treated as `level 0`
  rather than parsed, so a hostile/huge response can't bog the agent down.

## Testing

- **`parseAgentPolicy`** (pure, the bulk — unit-tested directly with hand-built
  `PolicyFetch`): status 0 → 0; 404/`body:null` → 0; non-JSON body → 0; non-object
  JSON (`"42"`) → 0; missing `version` → 0; `version:"2.0"` → 0; valid basic
  (`version:"1.0"`, `site`) → 1; + non-empty `actions` → 2; + `prohibited`/
  `requires_human`/`consent`/`safety` → 3; governance-without-actions → 3; `origin`
  passthrough; oversized body → 0.
- **`getAgentPolicy`** (orchestrator vs `fakeCdp`): a canned `Runtime.evaluate` result
  (`{ result: { value: <PolicyFetch> } }`) → asserts the assembled
  `AgentPolicyResult`; a fetch-failure value → `level 0`; an unbound-tab evaluate error
  → propagates.
- **`fetchPolicyScript.ts`** — untested page-side string; its output is supplied as the
  `fakeCdp` evaluate response. ≥90% coverage holds via the pure parser + orchestrator.

## Sequencing

Single PR (this sub-project). It unblocks the next two M4-PR4 sub-projects, which
reuse this resolver: `invokeStructuredAction` (find an action by name in
`policy.actions`, then invoke it via the page session) and navigate-enrichment
(attach `agentPolicy` to navigate results). Enforcement (`AiActionGuard`) and
ETag/TTL caching remain their own future specs.
