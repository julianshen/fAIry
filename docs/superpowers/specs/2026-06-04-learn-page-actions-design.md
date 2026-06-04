# learnPageActions (page scanner) — design

**Status:** approved (design phase) · **Date:** 2026-06-04 · **Component:** Chrome extension (M4 tool layer) · **Part of:** the originally-planned M4 "PR4" (decomposed — this is the first sub-project)

## Context

The fAIry Chrome extension is a pure browser executor: each `browser_*` tool is a
handler that runs via CDP (`chrome.debugger`), TDD'd against a `fakeCdp` (≥90%
coverage). The Pi `-e` script already registers `browser_learn_page_actions`
forwarding `learnPageActions` to the extension; the handler does not exist yet.

`learnPageActions` lets the agent understand a site that has no published
`/agent.json` — it scans the page and returns a structured inventory of
interactive elements, forms, navigation, URL patterns, declared actions, and
(optionally) observed API endpoints, plus a classification of likely actions. The
agent uses it to propose domain skills/workflows or to plan interactions.

This is a production reimplementation of the POC's `PageLearner` (`mybrowser/
.electron/services/PageLearner.ts`), trimmed to the high-signal subset.

## Goal & non-goals

**Goal:** a `learnPageActions` extension handler that returns a `LearnResult`:
page perception (interactive elements, forms, nav, search inputs), URL pattern
analysis, authoritative `[data-agent-action]` discovery, optional network-endpoint
observation (active mode), and a classification into typed actions.

**Non-goals (v1):**
- No framework detection (React/Vue/Angular) or `window` state-key dumping — the
  POC's `probeScripting` heuristics are noisy/low-signal. Dropped.
- No `agentPolicyLevel` in the output — it depends on the separate `getAgentPolicy`
  sub-project (not yet built). Added later when that lands.
- No always-on network observation — `active` mode is opt-in (it needs a ~2s CDP
  window). Default is passive.
- No daemon changes — this is an extension-only handler (the `-e` stub already
  forwards it).

## Decisions (and why)

1. **A dedicated collector `evaluate`, not reuse of `screenshotMarked`.** The
   perception data (interactive elements, forms, nav, search inputs, hrefs, query
   params, `[data-agent-action]`) is gathered by ONE page-side collector script
   run via `Runtime.evaluate` (`returnByValue`). Reusing `screenshotMarked` would
   capture and discard a base64 image — wasteful. The collector returns a single
   structured blob, no screenshot.
2. **Pure analyzers + a thin orchestrator.** The classification, URL analysis, and
   network analysis are pure TS functions (unit-tested directly); the handler just
   sequences CDP calls and feeds them. This keeps the testable logic out of the
   page-side string.
3. **`mode` defaults to passive.** `active` opts into a network-observation window.

## Architecture & components

A small `packages/extension/src/handlers/learn/` module group:

- **`learn.ts`** — `learnPageActions(cdp, events, sleep, args)`: the orchestrator
  (the handler). Runs the collector, optionally observes network, calls the
  analyzers/classifier, assembles the `LearnResult`.
- **`collectorScript.ts`** — the page-side collector JS as a string constant
  (precedent: `handlers/markScript.ts`). One DOM pass gathering:
  - interactive elements (same selector set as `markScript`: `a[href]`, `button`,
    `input`, `select`, `textarea`, role-based, `[contenteditable]`, `[tabindex]`),
    each `{ tag, role, label, href }`;
  - `elementsByRole` counts; `searchInputs` (role/label = search);
  - `forms` (`{ action, method, fields: {name,type}[], submitLabel }` via DOM walk);
  - `nav` (`<nav>` → `{ label?, links: {label, href}[] }`);
  - `hrefs` (all `<a href>`), and the current URL's query-param names;
  - `declaredActions` (`[data-agent-action]` → `{ name, tag, label }`).
  Returns a single `Collected` object (see Schema).
- **`analyzeUrls.ts`** — pure `analyzeUrls(hrefs: string[], currentUrl: string)`
  → `{ patterns: {pattern, count}[], queryParams: string[] }`. Groups hrefs by
  path with numeric/UUID segments collapsed to `:id`/`:uuid`.
- **`analyzeNetwork.ts`** — pure `analyzeNetwork(events: BufferedEvent[])`
  → `{ endpoints: {method, path, graphql?, auth?}[] }`. Indexes
  `Network.requestWillBeSent` by requestId for method+path, dedups by (method,
  path), flags GraphQL (path or query/mutation body) and auth (path matches
  `/auth|login|oauth|signin|signup/`).
- **`classify.ts`** — pure `classify(collected, urlAnalysis, network?)`
  → `ClassifiedAction[]`. Order of confidence: `data-agent-action` (high,
  authoritative) → search inputs (search) → form submit-label patterns
  (create/update/delete/export/filter → crud/export/filter) → login forms (auth)
  → URL patterns with ≥5 links (navigation). Each action records contributing
  elements / form fields / observed endpoint + a human description.
- **`types.ts`** — `Collected`, `LearnResult`, `ClassifiedAction`, `LearnArgs`.

Registration: `handlers/registry.ts` adds `learnPageActions` (wrapped to inject
`cdp` + `events` + a real `sleep`). The handler receives `events` (the CDP event
buffer / `cdpSubscribe`/`cdpCollect`/`cdpUnsubscribe` surface) like the `cdp.ts`
handlers do.

## Schema (the shapes)

```ts
type LearnArgs = { mode?: "passive" | "active"; observeMs?: number };

interface CollectedElement { tag: string; role: string | null; label: string; href: string | null }
interface CollectedForm { action: string; method: string; fields: { name: string; type: string }[]; submitLabel: string | null }
interface CollectedNav { label: string | null; links: { label: string; href: string }[] }
interface DeclaredAction { name: string; tag: string; label: string }

interface Collected {
  origin: string;
  url: string;
  elementsByRole: Record<string, number>;
  interactive: CollectedElement[];
  searchInputs: { label: string }[];
  forms: CollectedForm[];
  nav: CollectedNav[];
  hrefs: string[];
  queryParams: string[];
  declaredActions: DeclaredAction[];
}

type ActionCategory = "crud" | "navigation" | "filter" | "auth" | "export" | "search" | "upload" | "custom";

interface ClassifiedAction {
  name: string;
  category: ActionCategory;
  confidence: "high" | "medium" | "low";
  elements?: { tag: string; label: string }[];
  formFields?: { name: string; type: string }[];
  observedEndpoint?: { method: string; path: string };
  description: string;
}

interface NetworkEndpoint { method: string; path: string; graphql?: boolean; auth?: boolean }

interface LearnResult {
  origin: string;
  url: string;
  perception: {
    elementsByRole: Record<string, number>;
    interactive: CollectedElement[];
    searchInputs: { label: string }[];
    forms: CollectedForm[];
    nav: CollectedNav[];
  };
  urlAnalysis: { patterns: { pattern: string; count: number }[]; queryParams: string[] };
  declaredActions: DeclaredAction[];
  network?: { endpoints: NetworkEndpoint[] };
  classification: ClassifiedAction[];
}
```

## Data flow

```text
learnPageActions(cdp, events, sleep, args)
  ▼ cdp.send("Runtime.evaluate", { expression: COLLECTOR_JS, returnByValue: true })
  Collected  (origin/url/interactive/forms/nav/search/hrefs/queryParams/declaredActions)
  ▼ if args.mode === "active":   (composes the existing cdp event HANDLERS, reusing
                                  their domain-enable + rollback — not the raw buffer)
      await cdpSubscribe(cdp, events, { method: "Network.requestWillBeSent" })
      await cdpSubscribe(cdp, events, { method: "Network.responseReceived" })
      await sleep(args.observeMs ?? 2000)
      const evts = await cdpCollect(cdp, events, {})    // BufferedEvent[]
      await cdpUnsubscribe(cdp, events, {})             // in finally
      network = { endpoints: analyzeNetwork(evts) }
  ▼ urlAnalysis = analyzeUrls(Collected.hrefs, Collected.url)
  ▼ classification = classify(Collected, urlAnalysis, network)
  ▼ assemble LearnResult
```

## Error handling

- **Unbound tab:** `cdp.send` throws `NO_TAB_BOUND` (start-a-task guard) — the
  handler lets it propagate, as every handler does.
- **Collector failure:** if `Runtime.evaluate` returns `exceptionDetails` (or the
  result isn't a well-formed `Collected`), the handler throws a clear
  `"learnPageActions: page collection failed"` rather than returning garbage.
- **Network degradation:** a subscribe/enable failure (e.g. the page has no
  `Network` domain, or no tab) is tolerated — the handler skips the `network`
  block and returns the rest. Network subscriptions are ALWAYS released
  (`unsubscribe`) in a `finally`, even on error, so a learn call can't leak a
  live subscription.
- **observeMs bound:** clamp `observeMs` to a sane max (e.g. ≤ 10000) so a bad arg
  can't hang the agent loop.

## Testing

- **Pure analyzers** (the bulk of the logic, unit-tested directly): `analyzeUrls`
  (id/uuid collapsing, query-param extraction, counts), `analyzeNetwork` (method+
  path from requestWillBeSent, dedup, GraphQL + auth flags, ignores unmatched
  responses), `classify` (data-agent-action authoritative/high; search; crud/
  export/filter from submit labels; login→auth; nav from ≥5-link URL patterns;
  empty/clean inputs). Hand-built inputs, no CDP.
- **Orchestrator** (`learn.ts`) against `fakeCdp`: a canned `Runtime.evaluate`
  result (a `Collected` blob) → assert the assembled `LearnResult`; passive mode
  issues no network subscribe; active mode subscribes both Network methods, waits
  via an **injected `sleep`**, collects, unsubscribes (asserted even when the
  collector or analysis throws), and includes the `network` block; collector
  exception → throws; unbound tab → propagates.
- **`collectorScript.ts`** is a page-side JS string — not unit-tested directly
  (precedent: `markScript.ts`); its output is supplied as the `fakeCdp` evaluate
  response. ≥90% coverage holds via the pure functions + orchestrator.

## Sequencing

Single PR (this sub-project). The remaining M4 "PR4" sub-projects keep their own
specs: getAgentPolicy (+ enforcement decision), invokeStructuredAction,
navigate-enrichment, proposeSave (+ panel toast), and the group-2 finishers
(reader_extract, waitFor networkIdle).
