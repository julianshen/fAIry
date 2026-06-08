# reader_extract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the missing `reader_extract` browser handler — extract the active tab's main readable content as `{title, byline, excerpt, textContent, length, lang}` or `{error}`.

**Architecture:** A new `readerExtract` handler runs a self-contained page-side script (`READER_JS`, the collectorScript/markScript pattern) via `evaluateExpression` and coerces the result. Registered as `reader_extract` so the existing `-e` relay resolves. No new dependency.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), Vitest, Chrome extension MV3 (CDP via `CdpClient`).

**Spec:** `docs/superpowers/specs/2026-06-07-reader-extract-design.md`.

---

## File structure

- `packages/extension/src/handlers/readerScript.ts` — **new**; `READER_JS`, the page-side IIFE string (untested, like collectorScript).
- `packages/extension/src/handlers/reader.ts` — **new**; `readerExtract(cdp)` + `ReaderResult` + coercion.
- `packages/extension/src/handlers/reader.test.ts` — **new**; handler coercion tests via `fakeCdp`.
- `packages/extension/src/handlers/registry.ts` — **modify**; register `reader_extract: onCdp(readerExtract)`.
- `packages/extension/src/handlers/registry.test.ts` — **modify**; add `"reader_extract"` to `EXPECTED_TOOLS`.
- `packages/pi-daemon/pi-extension/browser-bridge.ts` — **modify**; soften the `reader_extract` description.

Run from each package's dir. Commit trailer MUST be exactly:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

Key facts (confirmed in the code):
- `evaluateExpression(cdp, expr)` runs `Runtime.evaluate` (returnByValue) and returns the value (`result.value`), throwing on a page exception.
- `fakeCdp(responses)` (`cdp/testCdp.ts`) replays `responses["Runtime.evaluate"]` for a `send("Runtime.evaluate", …)`. So `fakeCdp({ "Runtime.evaluate": { result: { value } } })` makes `evaluateExpression` return `value` (mirrors the `getAgentPolicy` tests' `cdpReturning`).
- `NO_TAB_BOUND` is exported from `tabs/agentTabs.ts`.
- `onCdp(fn)` adapts `(cdp[, args]) => Promise<unknown>` into a `ToolHandler`; a `(cdp) => …` function is assignable (the extra `args` is ignored) — so `readerExtract` takes only `cdp` (avoids an unused-arg lint).

---

### Task 1: `readerExtract` handler + `READER_JS`

**Files:**
- Create: `packages/extension/src/handlers/readerScript.ts`
- Create: `packages/extension/src/handlers/reader.ts`
- Test: `packages/extension/src/handlers/reader.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/extension/src/handlers/reader.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fakeCdp } from "../cdp/testCdp";
import { NO_TAB_BOUND } from "../tabs/agentTabs";
import type { CdpClient } from "../cdp/cdpClient";
import { readerExtract } from "./reader";

const cdpReturning = (value: unknown): CdpClient => fakeCdp({ "Runtime.evaluate": { result: { value } } });
const ARTICLE = { title: "T", byline: "By A", excerpt: "Ex", textContent: "Body text", length: 9, lang: "en" };

describe("readerExtract", () => {
  it("returns a well-formed article result", async () => {
    expect(await readerExtract(cdpReturning(ARTICLE))).toEqual(ARTICLE);
  });

  it("coerces missing optional fields to null and recomputes length", async () => {
    const res = await readerExtract(cdpReturning({ title: "T", textContent: "hello" }));
    expect(res).toEqual({ title: "T", byline: null, excerpt: null, textContent: "hello", length: 5, lang: null });
  });

  it("returns {error} when the script yields null", async () => {
    expect(await readerExtract(cdpReturning(null))).toEqual({ error: "no readable content" });
  });

  it("returns {error} for a result with no textContent", async () => {
    expect(await readerExtract(cdpReturning({ title: "T" }))).toEqual({ error: "no readable content" });
  });

  it("returns {error} for an empty textContent", async () => {
    expect(await readerExtract(cdpReturning({ textContent: "" }))).toEqual({ error: "no readable content" });
  });

  it("propagates an unbound-tab error", async () => {
    const cdp: CdpClient = { send: () => Promise.reject(new Error(NO_TAB_BOUND)) };
    await expect(readerExtract(cdp)).rejects.toThrow(NO_TAB_BOUND);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `cd packages/extension && bunx vitest run src/handlers/reader.test.ts`
Expected: FAIL — `readerExtract` cannot be imported.

- [ ] **Step 3: Implement `readerScript.ts`**

Create `packages/extension/src/handlers/readerScript.ts` (page-side string; the only escape is `'\\n'` → the page sees `'\n'`):

```ts
/**
 * Page-side reader extraction (heuristic, readability-style), run via
 * Runtime.evaluate (returnByValue). Picks the best content root — article →
 * main/[role=main] → the densest <p> container → body — and returns its
 * innerText (whitespace-normalized, capped) plus title/byline/excerpt/lang, or
 * null when there's nothing readable. Page-side string — not unit-tested
 * directly (precedent: collectorScript/markScript); reader.ts's coercion is.
 */
export const READER_JS = `(() => {
  try {
    var MAX = 100000;
    var attr = function (sel, a) { var el = document.querySelector(sel); return el ? (el.getAttribute(a) || '').trim() : ''; };
    var ptext = function (el) { var n = 0; var ps = el.querySelectorAll('p'); for (var i = 0; i < ps.length; i++) n += (ps[i].innerText || '').length; return n; };
    var root = document.querySelector('article') || document.querySelector('main, [role=main]');
    if (!root) {
      var best = null, bestLen = 0, els = document.querySelectorAll('div, section');
      for (var i = 0; i < els.length; i++) { var l = ptext(els[i]); if (l > bestLen) { bestLen = l; best = els[i]; } }
      root = bestLen > 0 ? best : document.body;
    }
    if (!root) return null;
    var lines = (root.innerText || '').split('\\n');
    var kept = [];
    for (var j = 0; j < lines.length; j++) { var t = lines[j].trim(); if (t) kept.push(t); }
    var textContent = kept.join('\\n').slice(0, MAX);
    if (!textContent) return null;
    var h1 = document.querySelector('h1');
    var title = attr('meta[property="og:title"]', 'content') || (document.title || '').trim() || (h1 ? (h1.innerText || '').trim() : '');
    var au = document.querySelector('[rel=author]');
    var byline = attr('meta[name="author"]', 'content') || attr('meta[property="article:author"]', 'content') || (au ? (au.innerText || '').trim() : '');
    var excerpt = attr('meta[name="description"]', 'content') || attr('meta[property="og:description"]', 'content') || textContent.slice(0, 200);
    var lang = (document.documentElement.getAttribute('lang') || '').trim();
    return { title: title, byline: byline || null, excerpt: excerpt || null, textContent: textContent, length: textContent.length, lang: lang || null };
  } catch (e) { return null; }
})()`;
```

- [ ] **Step 4: Implement `reader.ts`**

Create `packages/extension/src/handlers/reader.ts`:

```ts
import type { CdpClient } from "../cdp/cdpClient";
import { evaluateExpression } from "./evaluate";
import { READER_JS } from "./readerScript";

export type ReaderResult =
  | {
      title: string;
      byline: string | null;
      excerpt: string | null;
      textContent: string;
      length: number;
      lang: string | null;
    }
  | { error: string };

/** A non-empty string, else null — for the optional metadata fields. */
function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Extract the active tab's main readable content (heuristic, readability-style).
 * Runs READER_JS in the page and coerces the result; a thrown evaluate (e.g.
 * NO_TAB_BOUND, navigating page) propagates as the tool error.
 */
export async function readerExtract(cdp: CdpClient): Promise<ReaderResult> {
  const v = await evaluateExpression(cdp, READER_JS);
  if (typeof v !== "object" || v === null) return { error: "no readable content" };
  const o = v as Record<string, unknown>;
  if (typeof o.textContent !== "string" || o.textContent.length === 0) {
    return { error: "no readable content" };
  }
  const textContent = o.textContent;
  return {
    title: str(o.title) ?? "",
    byline: str(o.byline),
    excerpt: str(o.excerpt),
    textContent,
    length: typeof o.length === "number" ? o.length : textContent.length,
    lang: str(o.lang),
  };
}
```

- [ ] **Step 5: Run it, expect PASS**

Run: `bunx vitest run src/handlers/reader.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Typecheck + lint + commit**

Run: `bun run typecheck && bun run lint`. Then:
```bash
cd /Users/julianshen/prj/fAIry
git add packages/extension/src/handlers/readerScript.ts packages/extension/src/handlers/reader.ts packages/extension/src/handlers/reader.test.ts
git commit -F - <<'MSG'
feat(extension): reader_extract handler — readability-style content extraction

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 2: Register `reader_extract` + soften the `-e` description

**Files:**
- Modify: `packages/extension/src/handlers/registry.ts`
- Modify: `packages/extension/src/handlers/registry.test.ts`
- Modify: `packages/pi-daemon/pi-extension/browser-bridge.ts`

- [ ] **Step 1: Add `reader_extract` to the expected tools (failing test)**

In `packages/extension/src/handlers/registry.test.ts`, find the `EXPECTED_TOOLS` array (it pins the registered tool names) and add `"reader_extract"` (place it near the other group-2 inspection tools, e.g. after `"waitFor"`). Keep the array's existing formatting.

- [ ] **Step 2: Run it, expect FAIL**

Run: `cd packages/extension && bunx vitest run src/handlers/registry.test.ts`
Expected: FAIL — the registry doesn't expose `reader_extract` yet (the EXPECTED_TOOLS / registered-keys assertion mismatches).

- [ ] **Step 3: Register the handler**

In `packages/extension/src/handlers/registry.ts`:
- add the import (with the other handler imports): `import { readerExtract } from "./reader";`
- add to the returned handler map (near the other `onCdp` group-2 entries, e.g. after `waitFor: onCdp(waitFor),`): `reader_extract: onCdp(readerExtract),`

- [ ] **Step 4: Run it, expect PASS**

Run: `bunx vitest run src/handlers/registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Soften the `-e` tool description**

In `packages/pi-daemon/pi-extension/browser-bridge.ts`, find `name: "reader_extract"` and change its `description` so it no longer claims Mozilla's Readability — replace "using Mozilla's Readability" with "using a readability-style extraction". Leave `parameters`/`execute` unchanged. (The `-e` script is the standalone artifact — verified by the real-`pi` load smoke test, not a unit test.)

- [ ] **Step 6: Full suites + typecheck + lint + commit**

Run:
```bash
cd packages/extension && bun run test && bun run typecheck && bun run lint
cd ../pi-daemon && bun run test && bun run typecheck
```
Expected: all PASS (extension ≥90% coverage; pi-daemon's real-`pi` `-e` load smoke test still passes / skips). Then:
```bash
cd /Users/julianshen/prj/fAIry
git add packages/extension/src/handlers/registry.ts packages/extension/src/handlers/registry.test.ts packages/pi-daemon/pi-extension/browser-bridge.ts
git commit -F - <<'MSG'
feat: register reader_extract + soften the -e description

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

## Self-Review

**1. Spec coverage.**
- Handler returns `{title, byline, excerpt, textContent, length, lang}` or `{error}` → Task 1 (`reader.ts` + tests).
- Live-DOM `innerText` of the best root (article → main → densest `<p>` → body); metadata from og/meta/h1; `textContent` capped 100KB; in-script try/catch → null → Task 1 (`READER_JS`).
- Coercion: null/non-object/no-textContent → `{error:"no readable content"}`; optional fields → null; `length` recomputed → Task 1 (`reader.ts` + the coercion tests).
- Thrown evaluate (NO_TAB_BOUND/navigating) propagates → Task 1 (the propagation test; the handler doesn't catch).
- Registered as `reader_extract` → Task 2 (`registry.ts` + `registry.test.ts`).
- `-e` description softened off "Mozilla's Readability" → Task 2.
- `READER_JS` untested page-side string (precedent) → noted; coercion fully tested.
  No spec requirement is left without a task.

**2. Placeholder scan.** Complete code for both new files + the full test; the two adaptive steps (placing `"reader_extract"` in `EXPECTED_TOOLS`; the description wording) are explicit about what/where. No "TBD"/"add validation"/"similar to Task N".

**3. Type consistency.** `ReaderResult` (Task 1) is the handler's return type; the tests assert exactly its shape. `readerExtract(cdp: CdpClient)` (one param) is registered via `onCdp` (Task 2) and called as `readerExtract(cdp)` in the tests. `READER_JS` (readerScript.ts) is imported by `reader.ts`. The wire tool name `reader_extract` matches the `-e` tool (Task 2) and `EXPECTED_TOOLS`. `str()` returns `string | null`, matching the `byline`/`excerpt`/`lang` field types.
