# learnPageActions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `learnPageActions` extension handler that scans the current page and returns a structured `LearnResult` (perception, URL analysis, declared actions, optional network endpoints, and a classification of likely actions).

**Architecture:** A thin orchestrator handler composes existing primitives — one page-side collector run via `Runtime.evaluate`, and (in `active` mode) the existing `cdpSubscribe`/`cdpCollect`/`cdpUnsubscribe` handlers for a network-observation window — feeding three **pure** analyzer/classifier functions. The pure functions hold all the logic and are unit-tested directly; the orchestrator is tested against `fakeCdp` with an injected `sleep`; the page-side collector is an untested JS string (precedent: `markScript.ts`).

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), Vitest (extension ≥90% coverage gate), the extension's CDP handler pattern (`fakeCdp` seam, `createEventBuffer`).

**Spec:** `docs/superpowers/specs/2026-06-04-learn-page-actions-design.md`.

---

## File structure

New module group `packages/extension/src/handlers/learn/`:
- `types.ts` — `LearnArgs`, `Collected*`, `DeclaredAction`, `ActionCategory`, `ClassifiedAction`, `NetworkEndpoint`, `UrlAnalysis`, `LearnResult` (type-only).
- `analyzeUrls.ts` — pure `analyzeUrls(hrefs, currentUrl)`.
- `analyzeNetwork.ts` — pure `analyzeNetwork(events)`.
- `classify.ts` — pure `classify(collected, urlAnalysis, network?)`.
- `collectorScript.ts` — the page-side collector JS string (no test).
- `learnPageActions.ts` — the orchestrator handler.

Modified:
- `packages/extension/src/handlers/registry.ts` — add `sleep` to `BrowserDeps`, register `learnPageActions`.
- `packages/extension/src/handlers/registry.test.ts` — add `sleep` to the deps fake, add `learnPageActions` to `EXPECTED_TOOLS`.

Conventions: handlers throw a named `Error` on bad args (caught upstream as a tool failure). `noUncheckedIndexedAccess` is on. Run commands from `packages/extension/`. Single-file test: `bunx vitest run src/handlers/learn/<file>.test.ts`. Commit trailer MUST be exactly:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 1: Types + `analyzeUrls`

**Files:**
- Create: `packages/extension/src/handlers/learn/types.ts`
- Create: `packages/extension/src/handlers/learn/analyzeUrls.ts`
- Test: `packages/extension/src/handlers/learn/analyzeUrls.test.ts`

- [ ] **Step 1: Create the shared types**

Create `packages/extension/src/handlers/learn/types.ts`:

```ts
/** Shapes for the learnPageActions page scanner (see the design doc). */

export type LearnArgs = { mode?: "passive" | "active"; observeMs?: number };

export interface CollectedElement {
  tag: string;
  role: string | null;
  label: string;
  href: string | null;
}
export interface CollectedFormField {
  name: string;
  type: string;
}
export interface CollectedForm {
  action: string;
  method: string;
  fields: CollectedFormField[];
  submitLabel: string | null;
}
export interface CollectedNav {
  label: string | null;
  links: { label: string; href: string }[];
}
export interface DeclaredAction {
  name: string;
  tag: string;
  label: string;
}

/** What the page-side collector script returns (one DOM pass). */
export interface Collected {
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

export interface UrlAnalysis {
  patterns: { pattern: string; count: number }[];
  queryParams: string[];
}

export type ActionCategory =
  | "crud"
  | "navigation"
  | "filter"
  | "auth"
  | "export"
  | "search"
  | "upload"
  | "custom";

export interface ClassifiedAction {
  name: string;
  category: ActionCategory;
  confidence: "high" | "medium" | "low";
  elements?: { tag: string; label: string }[];
  formFields?: CollectedFormField[];
  observedEndpoint?: { method: string; path: string };
  description: string;
}

export interface NetworkEndpoint {
  method: string;
  path: string;
  graphql?: boolean;
  auth?: boolean;
}

export interface LearnResult {
  origin: string;
  url: string;
  perception: {
    elementsByRole: Record<string, number>;
    interactive: CollectedElement[];
    searchInputs: { label: string }[];
    forms: CollectedForm[];
    nav: CollectedNav[];
  };
  urlAnalysis: UrlAnalysis;
  declaredActions: DeclaredAction[];
  network?: { endpoints: NetworkEndpoint[] };
  classification: ClassifiedAction[];
}
```

- [ ] **Step 2: Write the failing test for `analyzeUrls`**

Create `packages/extension/src/handlers/learn/analyzeUrls.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { analyzeUrls } from "./analyzeUrls";

describe("analyzeUrls", () => {
  it("collapses numeric and uuid path segments and counts patterns (desc)", () => {
    const hrefs = [
      "https://x.com/users/1",
      "https://x.com/users/2",
      "https://x.com/users/3",
      "https://x.com/about",
    ];
    const r = analyzeUrls(hrefs, "https://x.com/home");
    expect(r.patterns[0]).toEqual({ pattern: "/users/:id", count: 3 });
    expect(r.patterns).toContainEqual({ pattern: "/about", count: 1 });
  });

  it("collapses a uuid segment to :uuid", () => {
    const r = analyzeUrls(["https://x.com/o/3f2504e0-4f89-41d3-9a0c-0305e82c3301"], "https://x.com/");
    expect(r.patterns[0]!.pattern).toBe("/o/:uuid");
  });

  it("extracts the current URL's query-param names", () => {
    const r = analyzeUrls([], "https://x.com/search?q=hi&page=2");
    expect(r.queryParams.sort()).toEqual(["page", "q"]);
  });

  it("resolves relative hrefs against the current URL and ignores unparseable ones", () => {
    const r = analyzeUrls(["/users/9", "not a url"], "https://x.com/home");
    expect(r.patterns).toEqual([{ pattern: "/users/:id", count: 1 }]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bunx vitest run src/handlers/learn/analyzeUrls.test.ts`
Expected: FAIL — `analyzeUrls` cannot be imported (module doesn't exist).

- [ ] **Step 4: Implement `analyzeUrls`**

Create `packages/extension/src/handlers/learn/analyzeUrls.ts`:

```ts
import type { UrlAnalysis } from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function segPattern(seg: string): string {
  if (/^\d+$/.test(seg)) return ":id";
  if (UUID_RE.test(seg)) return ":uuid";
  return seg;
}

function safeUrl(href: string, base?: URL): URL | undefined {
  try {
    return base ? new URL(href, base) : new URL(href);
  } catch {
    return undefined;
  }
}

/**
 * Group the page's links by path pattern (numeric → `:id`, uuid → `:uuid`),
 * counted and sorted desc, plus the current URL's query-param names. Pure.
 */
export function analyzeUrls(hrefs: string[], currentUrl: string): UrlAnalysis {
  const base = safeUrl(currentUrl);
  const counts = new Map<string, number>();
  for (const href of hrefs) {
    const u = safeUrl(href, base);
    if (!u) continue;
    const pattern = u.pathname.split("/").map(segPattern).join("/");
    counts.set(pattern, (counts.get(pattern) ?? 0) + 1);
  }
  const patterns = [...counts.entries()]
    .map(([pattern, count]) => ({ pattern, count }))
    .sort((a, b) => b.count - a.count);
  const queryParams = base ? [...new Set(base.searchParams.keys())] : [];
  return { patterns, queryParams };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bunx vitest run src/handlers/learn/analyzeUrls.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/extension/src/handlers/learn/types.ts packages/extension/src/handlers/learn/analyzeUrls.ts packages/extension/src/handlers/learn/analyzeUrls.test.ts
git commit -F - <<'MSG'
feat(extension): learnPageActions types + analyzeUrls (URL pattern analysis)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 2: `analyzeNetwork`

**Files:**
- Create: `packages/extension/src/handlers/learn/analyzeNetwork.ts`
- Test: `packages/extension/src/handlers/learn/analyzeNetwork.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/extension/src/handlers/learn/analyzeNetwork.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { BufferedEvent } from "../../cdp/eventBuffer";
import { analyzeNetwork } from "./analyzeNetwork";

function req(url: string, method: string, postData?: string): BufferedEvent {
  return { at: 1, method: "Network.requestWillBeSent", params: { request: { url, method, postData } } };
}

describe("analyzeNetwork", () => {
  it("extracts method+path from requestWillBeSent and dedups", () => {
    const r = analyzeNetwork([req("https://x.com/api/users?p=1", "GET"), req("https://x.com/api/users?p=2", "GET")]);
    expect(r.endpoints).toEqual([{ method: "GET", path: "/api/users" }]);
  });

  it("ignores responseReceived and non-http requests", () => {
    const r = analyzeNetwork([
      { at: 1, method: "Network.responseReceived", params: { response: { url: "https://x.com/a" } } },
      req("data:text/html,hi", "GET"),
    ]);
    expect(r.endpoints).toEqual([]);
  });

  it("flags graphql (by path or body) and auth endpoints", () => {
    const r = analyzeNetwork([
      req("https://x.com/graphql", "POST"),
      req("https://x.com/q", "POST", '{"query":"{ me }"}'),
      req("https://x.com/auth/login", "POST"),
    ]);
    expect(r.endpoints).toContainEqual({ method: "POST", path: "/graphql", graphql: true });
    expect(r.endpoints).toContainEqual({ method: "POST", path: "/q", graphql: true });
    expect(r.endpoints).toContainEqual({ method: "POST", path: "/auth/login", auth: true });
  });

  it("returns no endpoints for an empty stream", () => {
    expect(analyzeNetwork([]).endpoints).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run src/handlers/learn/analyzeNetwork.test.ts`
Expected: FAIL — `analyzeNetwork` cannot be imported.

- [ ] **Step 3: Implement `analyzeNetwork`**

Create `packages/extension/src/handlers/learn/analyzeNetwork.ts`:

```ts
import type { BufferedEvent } from "../../cdp/eventBuffer";
import type { NetworkEndpoint } from "./types";

const AUTH_RE = /\/(auth|login|logout|oauth|signin|signup|token)\b/i;

interface RequestParams {
  request?: { url?: string; method?: string; postData?: string };
}

function isGraphql(path: string, postData?: string): boolean {
  if (/graphql/i.test(path)) return true;
  return typeof postData === "string" && /\b(query|mutation)\b/.test(postData);
}

function safeUrl(href: string): URL | undefined {
  try {
    return new URL(href);
  } catch {
    return undefined;
  }
}

/**
 * Reduce a buffered CDP event stream to the distinct API endpoints the page hit.
 * Keys off `Network.requestWillBeSent` (method + path), dedups by `method path`,
 * and flags GraphQL / auth endpoints. Pure.
 */
export function analyzeNetwork(events: BufferedEvent[]): { endpoints: NetworkEndpoint[] } {
  const seen = new Set<string>();
  const endpoints: NetworkEndpoint[] = [];
  for (const ev of events) {
    if (ev.method !== "Network.requestWillBeSent") continue;
    const req = (ev.params as RequestParams | null)?.request;
    if (!req || typeof req.url !== "string" || typeof req.method !== "string") continue;
    const u = safeUrl(req.url);
    if (!u || (u.protocol !== "http:" && u.protocol !== "https:")) continue;
    const key = `${req.method} ${u.pathname}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const endpoint: NetworkEndpoint = { method: req.method, path: u.pathname };
    if (isGraphql(u.pathname, req.postData)) endpoint.graphql = true;
    if (AUTH_RE.test(u.pathname)) endpoint.auth = true;
    endpoints.push(endpoint);
  }
  return { endpoints };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run src/handlers/learn/analyzeNetwork.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/extension/src/handlers/learn/analyzeNetwork.ts packages/extension/src/handlers/learn/analyzeNetwork.test.ts
git commit -F - <<'MSG'
feat(extension): learnPageActions analyzeNetwork (observed endpoints)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 3: `classify`

**Files:**
- Create: `packages/extension/src/handlers/learn/classify.ts`
- Test: `packages/extension/src/handlers/learn/classify.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/extension/src/handlers/learn/classify.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { classify } from "./classify";
import type { Collected, UrlAnalysis } from "./types";

const EMPTY: Collected = {
  origin: "https://x.com",
  url: "https://x.com/",
  elementsByRole: {},
  interactive: [],
  searchInputs: [],
  forms: [],
  nav: [],
  hrefs: [],
  queryParams: [],
  declaredActions: [],
};
const NO_URLS: UrlAnalysis = { patterns: [], queryParams: [] };

describe("classify", () => {
  it("treats data-agent-action as authoritative (high-confidence custom)", () => {
    const c = { ...EMPTY, declaredActions: [{ name: "checkout", tag: "button", label: "Buy" }] };
    const out = classify(c, NO_URLS);
    expect(out).toContainEqual(
      expect.objectContaining({ name: "checkout", category: "custom", confidence: "high" }),
    );
  });

  it("classifies search inputs as a search action", () => {
    const c = { ...EMPTY, searchInputs: [{ label: "Search" }] };
    expect(classify(c, NO_URLS)).toContainEqual(
      expect.objectContaining({ name: "search", category: "search", confidence: "high" }),
    );
  });

  it("classifies a login form (password + user field) as auth", () => {
    const c = {
      ...EMPTY,
      forms: [{ action: "/login", method: "post", fields: [{ name: "email", type: "email" }, { name: "pw", type: "password" }], submitLabel: "Sign in" }],
    };
    expect(classify(c, NO_URLS)).toContainEqual(
      expect.objectContaining({ name: "login", category: "auth", confidence: "high" }),
    );
  });

  it("maps form submit labels to crud/export/filter", () => {
    const mk = (submitLabel: string) => ({
      ...EMPTY,
      forms: [{ action: "/", method: "post", fields: [{ name: "x", type: "text" }], submitLabel }],
    });
    expect(classify(mk("Create item"), NO_URLS)).toContainEqual(expect.objectContaining({ category: "crud" }));
    expect(classify(mk("Export CSV"), NO_URLS)).toContainEqual(expect.objectContaining({ category: "export" }));
    expect(classify(mk("Filter results"), NO_URLS)).toContainEqual(expect.objectContaining({ category: "filter" }));
  });

  it("emits a navigation action for URL patterns with >= 5 links", () => {
    const urls: UrlAnalysis = { patterns: [{ pattern: "/p/:id", count: 7 }, { pattern: "/about", count: 2 }], queryParams: [] };
    const out = classify(EMPTY, urls);
    expect(out).toContainEqual(expect.objectContaining({ category: "navigation", confidence: "low" }));
    expect(out.filter((a) => a.category === "navigation")).toHaveLength(1); // /about (count 2) excluded
  });

  it("includes observed endpoints when a network block is supplied", () => {
    const out = classify(EMPTY, NO_URLS, { endpoints: [{ method: "POST", path: "/auth/login", auth: true }] });
    expect(out).toContainEqual(
      expect.objectContaining({ category: "auth", observedEndpoint: { method: "POST", path: "/auth/login" } }),
    );
  });

  it("returns nothing for a clean empty page", () => {
    expect(classify(EMPTY, NO_URLS)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run src/handlers/learn/classify.test.ts`
Expected: FAIL — `classify` cannot be imported.

- [ ] **Step 3: Implement `classify`**

Create `packages/extension/src/handlers/learn/classify.ts`:

```ts
import type { ActionCategory, ClassifiedAction, Collected, CollectedForm, NetworkEndpoint, UrlAnalysis } from "./types";

const FORM_PATTERNS: { re: RegExp; category: ActionCategory }[] = [
  { re: /\b(create|add|new|post|submit|register|sign\s?up)\b/i, category: "crud" },
  { re: /\b(update|save|edit|apply)\b/i, category: "crud" },
  { re: /\b(delete|remove|trash)\b/i, category: "crud" },
  { re: /\b(export|download|csv|pdf)\b/i, category: "export" },
  { re: /\b(filter|sort|refine)\b/i, category: "filter" },
];

function formCategory(label: string): ActionCategory | null {
  for (const { re, category } of FORM_PATTERNS) if (re.test(label)) return category;
  return null;
}

function isLoginForm(form: CollectedForm): boolean {
  const hasPassword = form.fields.some((f) => f.type === "password");
  const hasUser = form.fields.some((f) => /email|user|login/i.test(f.name) || f.type === "email");
  return hasPassword && hasUser;
}

/**
 * Synthesize likely actions from the collected page data + URL analysis (+ any
 * observed network). Confidence ranks: site-declared `data-agent-action` (high,
 * authoritative) → search → forms → navigation (low) → observed endpoints. Pure.
 */
export function classify(
  collected: Collected,
  urlAnalysis: UrlAnalysis,
  network?: { endpoints: NetworkEndpoint[] },
): ClassifiedAction[] {
  const actions: ClassifiedAction[] = [];

  for (const da of collected.declaredActions) {
    actions.push({
      name: da.name,
      category: "custom",
      confidence: "high",
      elements: [{ tag: da.tag, label: da.label }],
      description: `Site-declared action "${da.name}".`,
    });
  }

  if (collected.searchInputs.length > 0) {
    actions.push({
      name: "search",
      category: "search",
      confidence: "high",
      elements: collected.searchInputs.map((s) => ({ tag: "input", label: s.label })),
      description: "Search the site.",
    });
  }

  for (const form of collected.forms) {
    if (isLoginForm(form)) {
      actions.push({ name: "login", category: "auth", confidence: "high", formFields: form.fields, description: "Sign in." });
      continue;
    }
    const label = form.submitLabel ?? "";
    const category = formCategory(label);
    if (category) {
      actions.push({
        name: label || category,
        category,
        confidence: "medium",
        formFields: form.fields,
        description: `Form action: ${label || category}.`,
      });
    }
  }

  for (const p of urlAnalysis.patterns) {
    if (p.count >= 5) {
      actions.push({
        name: `navigate ${p.pattern}`,
        category: "navigation",
        confidence: "low",
        description: `Navigation: ${p.count} links matching ${p.pattern}.`,
      });
    }
  }

  if (network) {
    for (const ep of network.endpoints) {
      actions.push({
        name: `${ep.method} ${ep.path}`,
        category: ep.auth ? "auth" : "custom",
        confidence: "low",
        observedEndpoint: { method: ep.method, path: ep.path },
        description: `Observed API: ${ep.method} ${ep.path}${ep.graphql ? " (GraphQL)" : ""}.`,
      });
    }
  }

  return actions;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run src/handlers/learn/classify.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/extension/src/handlers/learn/classify.ts packages/extension/src/handlers/learn/classify.test.ts
git commit -F - <<'MSG'
feat(extension): learnPageActions classify (synthesize typed actions)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 4: Collector script + orchestrator + registry wiring

**Files:**
- Create: `packages/extension/src/handlers/learn/collectorScript.ts`
- Create: `packages/extension/src/handlers/learn/learnPageActions.ts`
- Test: `packages/extension/src/handlers/learn/learnPageActions.test.ts`
- Modify: `packages/extension/src/handlers/registry.ts`
- Modify: `packages/extension/src/handlers/registry.test.ts`

- [ ] **Step 1: Create the page-side collector script**

Create `packages/extension/src/handlers/learn/collectorScript.ts` (a JS string run in the page; not unit-tested, like `markScript.ts` — the orchestrator test supplies its result):

```ts
/**
 * Page-side collector: one DOM pass gathering everything the analyzers need
 * (interactive elements, role counts, search inputs, forms, nav, hrefs, query
 * params, and authoritative [data-agent-action] elements). Returns a `Collected`
 * object via `Runtime.evaluate` (returnByValue). Page-side string — not unit-
 * tested directly (precedent: markScript.ts); the orchestrator test feeds its
 * result through fakeCdp.
 */
export const COLLECTOR_JS = `(() => {
  const text = (el) => (el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || el.textContent || '').trim().slice(0, 80);
  const SEL = 'a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=radio],[role=switch],[contenteditable],[tabindex]';
  const interactive = []; const elementsByRole = {}; const searchInputs = [];
  for (const el of document.querySelectorAll(SEL)) {
    const role = el.getAttribute('role');
    const tag = el.tagName.toLowerCase();
    const label = text(el);
    interactive.push({ tag, role, label, href: el.getAttribute('href') });
    const roleKey = role || tag;
    elementsByRole[roleKey] = (elementsByRole[roleKey] || 0) + 1;
    const t = (el.getAttribute('type') || '').toLowerCase();
    if (role === 'searchbox' || t === 'search' || /search/i.test(label)) searchInputs.push({ label });
  }
  const forms = [];
  for (const f of document.querySelectorAll('form')) {
    const fields = [];
    for (const inp of f.querySelectorAll('input,select,textarea')) {
      fields.push({ name: inp.getAttribute('name') || '', type: (inp.getAttribute('type') || inp.tagName.toLowerCase()).toLowerCase() });
    }
    const submit = f.querySelector('[type=submit],button');
    forms.push({ action: f.getAttribute('action') || '', method: (f.getAttribute('method') || 'get').toLowerCase(), fields, submitLabel: submit ? text(submit) : null });
  }
  const nav = [];
  for (const n of document.querySelectorAll('nav')) {
    const links = [];
    for (const a of n.querySelectorAll('a[href]')) links.push({ label: text(a), href: a.getAttribute('href') || '' });
    nav.push({ label: n.getAttribute('aria-label'), links });
  }
  const hrefs = Array.from(document.querySelectorAll('a[href]'), (a) => a.href);
  const declaredActions = Array.from(document.querySelectorAll('[data-agent-action]'), (el) => ({ name: el.getAttribute('data-agent-action') || '', tag: el.tagName.toLowerCase(), label: text(el) }));
  const queryParams = Array.from(new URLSearchParams(location.search).keys());
  return { origin: location.origin, url: location.href, elementsByRole, interactive, searchInputs, forms, nav, hrefs, queryParams, declaredActions };
})()`;
```

- [ ] **Step 2: Write the failing test for the orchestrator**

Create `packages/extension/src/handlers/learn/learnPageActions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fakeCdp } from "../../cdp/testCdp";
import { createEventBuffer } from "../../cdp/eventBuffer";
import { NO_TAB_BOUND } from "../../tabs/agentTabs";
import type { CdpClient } from "../../cdp/cdpClient";
import { learnPageActions } from "./learnPageActions";
import type { Collected } from "./types";

const COLLECTED: Collected = {
  origin: "https://x.com",
  url: "https://x.com/home?q=1",
  elementsByRole: { button: 2, link: 5 },
  interactive: [{ tag: "button", role: null, label: "Go", href: null }],
  searchInputs: [{ label: "Search" }],
  forms: [],
  nav: [],
  hrefs: ["https://x.com/p/1", "https://x.com/p/2"],
  queryParams: ["q"],
  declaredActions: [],
};

/** fakeCdp returns canned values; Runtime.evaluate must look like a CDP eval result. */
function cdpWithCollected(value: unknown = COLLECTED) {
  return fakeCdp({ "Runtime.evaluate": { result: { value } } });
}
const noSleep = async (): Promise<void> => {};

describe("learnPageActions", () => {
  it("assembles a LearnResult from the collector (passive: no network)", async () => {
    const res = await learnPageActions(cdpWithCollected(), createEventBuffer(), noSleep, {});
    expect(res.origin).toBe("https://x.com");
    expect(res.perception.searchInputs).toEqual([{ label: "Search" }]);
    expect(res.urlAnalysis.patterns).toContainEqual({ pattern: "/p/:id", count: 2 });
    expect(res.network).toBeUndefined();
    expect(res.classification).toContainEqual(expect.objectContaining({ category: "search" }));
  });

  it("does not touch the network in passive mode", async () => {
    const cdp = cdpWithCollected();
    await learnPageActions(cdp, createEventBuffer(), noSleep, { mode: "passive" });
    expect(cdp.calls.map((c) => c.method)).toEqual(["Runtime.evaluate"]);
  });

  it("observes network in active mode, then unsubscribes", async () => {
    const buffer = createEventBuffer();
    const cdp = cdpWithCollected();
    // Events 'arrive' during the observation window — model that in the fake sleep.
    const sleep = async (): Promise<void> => {
      buffer.push("Network.requestWillBeSent", { request: { url: "https://x.com/api/items", method: "GET" } }, 1);
    };
    const res = await learnPageActions(cdp, buffer, sleep, { mode: "active" });
    expect(res.network?.endpoints).toEqual([{ method: "GET", path: "/api/items" }]);
    expect(buffer.isSubscribed("Network.requestWillBeSent")).toBe(false); // released
  });

  it("skips the network block (still unsubscribes) when subscribe fails", async () => {
    const buffer = createEventBuffer();
    // Network.enable rejects with the no-tab signal → cdpSubscribe rolls back to ok:false.
    const cdp: CdpClient & { calls: { method: string }[] } = {
      calls: [],
      send(method) {
        this.calls.push({ method });
        if (method === "Runtime.evaluate") return Promise.resolve({ result: { value: COLLECTED } });
        if (method === "Network.enable") return Promise.reject(new Error(NO_TAB_BOUND));
        return Promise.resolve(undefined);
      },
    };
    const res = await learnPageActions(cdp, buffer, async () => {}, { mode: "active" });
    expect(res.network).toBeUndefined();
    expect(buffer.isSubscribed("Network.requestWillBeSent")).toBe(false);
  });

  it("throws a clear error when page collection returns a non-Collected value", async () => {
    await expect(learnPageActions(cdpWithCollected(null), createEventBuffer(), noSleep, {})).rejects.toThrow(
      /page collection failed/,
    );
  });

  it("propagates an unbound-tab error from the collector evaluate", async () => {
    const cdp: CdpClient = { send: () => Promise.reject(new Error(NO_TAB_BOUND)) };
    await expect(learnPageActions(cdp, createEventBuffer(), noSleep, {})).rejects.toThrow(NO_TAB_BOUND);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bunx vitest run src/handlers/learn/learnPageActions.test.ts`
Expected: FAIL — `learnPageActions` cannot be imported.

- [ ] **Step 4: Implement the orchestrator**

Create `packages/extension/src/handlers/learn/learnPageActions.ts`:

```ts
import type { CdpClient } from "../../cdp/cdpClient";
import type { BufferedEvent, CdpEventBuffer } from "../../cdp/eventBuffer";
import { optionalNumber, optionalString } from "../args";
import { cdpCollect, cdpSubscribe, cdpUnsubscribe } from "../cdp";
import { evaluateExpression } from "../evaluate";
import { analyzeNetwork } from "./analyzeNetwork";
import { analyzeUrls } from "./analyzeUrls";
import { classify } from "./classify";
import { COLLECTOR_JS } from "./collectorScript";
import type { Collected, LearnResult, NetworkEndpoint } from "./types";

/** Injected so tests don't wait on the real clock. */
export type Sleep = (ms: number) => Promise<void>;

const DEFAULT_OBSERVE_MS = 2000;
const MAX_OBSERVE_MS = 10000;

function isCollected(v: unknown): v is Collected {
  return typeof v === "object" && v !== null && Array.isArray((v as Collected).interactive);
}

/** Observe network for `observeMs`; returns endpoints, or undefined if it can't subscribe. */
async function observeNetwork(
  cdp: CdpClient,
  events: CdpEventBuffer,
  sleep: Sleep,
  observeMs: number,
): Promise<{ endpoints: NetworkEndpoint[] } | undefined> {
  try {
    const sub = await cdpSubscribe(cdp, events, { method: "Network.requestWillBeSent" });
    if (!sub.ok) return undefined;
    await cdpSubscribe(cdp, events, { method: "Network.responseReceived" });
    await sleep(observeMs);
    const evts = (await cdpCollect(events, {})) as BufferedEvent[];
    return analyzeNetwork(evts);
  } finally {
    await cdpUnsubscribe(events, {});
  }
}

/**
 * Scan the current page: run the page-side collector, optionally observe network
 * (active mode), and synthesize a LearnResult via the pure analyzers/classifier.
 * The handler is A2UI-agnostic of policy (agentPolicyLevel arrives with the
 * separate getAgentPolicy work).
 */
export async function learnPageActions(
  cdp: CdpClient,
  events: CdpEventBuffer,
  sleep: Sleep,
  args: Record<string, unknown>,
): Promise<LearnResult> {
  const mode = optionalString(args, "mode", "passive");
  const observeMs = Math.min(optionalNumber(args, "observeMs", DEFAULT_OBSERVE_MS), MAX_OBSERVE_MS);

  const collected = await evaluateExpression(cdp, COLLECTOR_JS);
  if (!isCollected(collected)) throw new Error("learnPageActions: page collection failed");

  const network = mode === "active" ? await observeNetwork(cdp, events, sleep, observeMs) : undefined;
  const urlAnalysis = analyzeUrls(collected.hrefs, collected.url);
  const classification = classify(collected, urlAnalysis, network);

  return {
    origin: collected.origin,
    url: collected.url,
    perception: {
      elementsByRole: collected.elementsByRole,
      interactive: collected.interactive,
      searchInputs: collected.searchInputs,
      forms: collected.forms,
      nav: collected.nav,
    },
    urlAnalysis,
    declaredActions: collected.declaredActions,
    ...(network ? { network } : {}),
    classification,
  };
}
```

- [ ] **Step 5: Run the orchestrator test to verify it passes**

Run: `bunx vitest run src/handlers/learn/learnPageActions.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Wire it into the registry**

In `packages/extension/src/handlers/registry.ts`, add the import (after the `cdp` import line):

```ts
import { cdpCollect, cdpPassthrough, cdpSubscribe, cdpUnsubscribe } from "./cdp";
import { learnPageActions } from "./learn/learnPageActions";
```

Add `sleep` to `BrowserDeps`. Find:

```ts
export interface BrowserDeps {
  cdp: CdpClient;
  tabs: TabsApi;
  agentTabs: AgentTabs;
  events: CdpEventBuffer;
}
```

Replace with:

```ts
export interface BrowserDeps {
  cdp: CdpClient;
  tabs: TabsApi;
  agentTabs: AgentTabs;
  events: CdpEventBuffer;
  /** Injected delay for learnPageActions' active-mode network window (the SW glue
   *  passes a setTimeout-backed sleep; tests pass a fake). */
  sleep: (ms: number) => Promise<void>;
}
```

Destructure `sleep` and register the tool. Find:

```ts
  const { cdp, tabs, agentTabs, events } = deps;
```

Replace with:

```ts
  const { cdp, tabs, agentTabs, events, sleep } = deps;
```

Then add the registration after the `cdpUnsubscribe` line (inside the returned object):

```ts
    cdpUnsubscribe: (args) => cdpUnsubscribe(events, args),
    // Group 9 (partial) — page understanding.
    learnPageActions: (args) => learnPageActions(cdp, events, sleep, args),
```

- [ ] **Step 7: Update the registry test**

In `packages/extension/src/handlers/registry.test.ts`, add `sleep` to the deps fake. Find:

```ts
    events: createEventBuffer(),
    ...over,
  };
```

Replace with:

```ts
    events: createEventBuffer(),
    sleep: async () => {},
    ...over,
  };
```

Add `learnPageActions` to `EXPECTED_TOOLS`. Find:

```ts
  "cdpUnsubscribe",
];
```

Replace with:

```ts
  "cdpUnsubscribe",
  // group 9 (partial) — page understanding
  "learnPageActions",
];
```

- [ ] **Step 8: Run the full extension suite + coverage + typecheck + lint**

Run: `bun run test && bun run typecheck && bun run lint`
Expected: PASS. The ≥90% coverage gate holds — the pure analyzers + orchestrator are fully tested; `collectorScript.ts` is covered by import (the `const` evaluates) though its page-side string isn't executed; `registry.ts`'s new line is exercised by `registry.test.ts`.

Note for the dispatch smoke test in `registry.test.ts` ("dispatches every advertised tool…"): it calls `learnPageActions({ timeoutMs: 0 })` with the default `fakeCdp()`, whose `Runtime.evaluate` returns `undefined` → the handler rejects with "page collection failed". That test wraps each call in `.catch(() => undefined)`, so an async rejection is expected and fine (it only asserts no *synchronous* throw — and the handler is async).

- [ ] **Step 9: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/extension/src/handlers/learn/collectorScript.ts packages/extension/src/handlers/learn/learnPageActions.ts packages/extension/src/handlers/learn/learnPageActions.test.ts packages/extension/src/handlers/registry.ts packages/extension/src/handlers/registry.test.ts
git commit -F - <<'MSG'
feat(extension): learnPageActions orchestrator + collector + registry wiring

The handler runs a page-side collector via Runtime.evaluate, optionally observes
network (active mode, composing cdpSubscribe/Collect/Unsubscribe with an injected
sleep, always releasing the subscription), and assembles a LearnResult via the
pure analyzers/classifier. Registered as the `learnPageActions` wire tool; adds
`sleep` to BrowserDeps (SW glue provides a real one).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

## Note for the implementer: SW glue (`sleep`)

`BrowserDeps` now has a `sleep`. The composition root that builds `BrowserDeps`
(the coverage-excluded service-worker glue, e.g. `background.ts`/`connection.ts`)
must pass a real one: `sleep: (ms) => new Promise((r) => setTimeout(r, ms))`. If
the build's `tsc` flags a missing `sleep` field at that call site, add it there.
This is glue (coverage-excluded); no test asserts it.

---

## Self-Review

**1. Spec coverage.**
- Collector `evaluate` (not screenshotMarked reuse) → Task 4 `collectorScript.ts` + orchestrator.
- Perception (elementsByRole/interactive/searchInputs/forms/nav) → collector + `LearnResult.perception` (Task 1 types, Task 4 assembly).
- URL analysis (:id/:uuid, query params) → Task 1 `analyzeUrls`.
- `data-agent-action` discovery + classification (confidence tiers, ≥5-link nav) → Task 3 `classify`.
- Optional active-mode network observation (composes cdpSubscribe/Collect/Unsubscribe, injected sleep, `finally` unsubscribe, subscribe-fail degrade) → Task 4 `observeNetwork`; `analyzeNetwork` (Task 2).
- Omits `agentPolicyLevel` → not in `LearnResult` (Task 1). Passive default, `observeMs` clamp ≤10000 → Task 4.
- Error handling: NO_TAB_BOUND propagates, collector-failure throws, network degrades, observeMs clamp → Task 4 + its tests.
- Testing: pure analyzers tested directly (Tasks 1–3); orchestrator vs fakeCdp + injected sleep (Task 4); collector untested string. → matches the spec's testing section.
  No spec requirement is left without a task.

**2. Placeholder scan.** No "TBD"/"TODO"/"handle edge cases"/"similar to Task N". Every code step shows complete code; test steps show full tests; commands show expected outcomes. The collector-string-untested and SW-glue-sleep facts are stated explicitly, not hand-waved. ✓

**3. Type consistency.** `Collected`/`LearnResult`/`ClassifiedAction`/`UrlAnalysis`/`NetworkEndpoint`/`LearnArgs` are defined once in Task 1 `types.ts` and imported unchanged by Tasks 2–4. `analyzeUrls(hrefs, currentUrl)`, `analyzeNetwork(events)`, `classify(collected, urlAnalysis, network?)`, and `learnPageActions(cdp, events, sleep, args)` signatures match every call site (the orchestrator + the tests + the registry). The composed handler signatures match the real ones read from the codebase: `cdpSubscribe(cdp, events, args)`, `cdpCollect(events, args)`, `cdpUnsubscribe(events, args)`, `evaluateExpression(cdp, expression)`. `BufferedEvent` is imported from `../../cdp/eventBuffer`. The wire name `learnPageActions` matches the `-e` script's `bridge("learnPageActions")` and the registry key. ✓
