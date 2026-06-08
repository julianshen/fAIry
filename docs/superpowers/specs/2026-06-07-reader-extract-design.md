# reader_extract — design

**Status:** approved (design phase) · **Date:** 2026-06-07 · **Component:** extension (`handlers/`) + the `-e` tool description · **Builds on:** the page-side `evaluate` script pattern (collectorScript/markScript/FETCH_POLICY_JS) + the handler registry · **Part of:** M4 "PR4" group-2 finishers (PR-2 of 2; PR-1 was `waitFor` networkIdle). Completes the M4 tool layer.

## Context

The `reader_extract` tool is registered in the Pi `-e` script and forwards `bridge("reader_extract", {})`, but the extension has **no handler** for it (it isn't in `handlers/registry.ts`), so calling it fails "unknown tool." This adds the handler. The tool is for reading-comprehension tasks — extract the main article text so the agent reads content, not raw DOM.

## Goal & non-goals

**Goal:** `reader_extract` returns the active tab's main readable content as `{title, byline, excerpt, textContent, length, lang}`, or `{error}` when there's nothing readable.

**Non-goals (v1):**
- True Mozilla Readability (the bundle-an-IIFE path) — rejected for v1 (no third-party lib injection / build step; see Decisions). A lighter heuristic is used; the `-e` description is softened from "Mozilla's Readability."
- Paginated/multi-page article stitching, image/figure/table extraction, sanitized HTML output (text only).

## Decisions (and why)

1. **A self-contained page-side heuristic string** (`READER_JS`), not a bundled library — consistent with every other page-side script here (collectorScript, markScript, FETCH_POLICY_JS are hand-written self-contained strings; the repo injects no third-party libs), no new dependency, no build step, and unit-testable through `fakeCdp` like its peers. Trade-off: lower extraction quality than Mozilla Readability on messy/SPA pages; `browser_getDom` remains the fallback the agent can use.
2. **Read the live DOM via `innerText`, no clone/mutation.** Pick the best content root and return its `innerText` — layout-aware (skips `display:none`, gives clean visible text), and reading (not mutating) the page is safer and simpler than clone-and-strip. A good root excludes most boilerplate without aggressive stripping.
3. **Content-root order:** `article` → `main, [role=main]` → the densest candidate (the `div`/`section` whose descendant `<p>` text is longest) → `document.body` (floor). The first match wins; this favors semantic structure and degrades to text density, then to the whole body.
4. **Cap `textContent`** (100KB) so a huge page can't bloat the CDP bridge.

## Architecture & components

In `packages/extension/src/handlers/`:

- **`readerScript.ts`** (new) — `READER_JS`, a page-side IIFE string run via `Runtime.evaluate` (returnByValue). It:
  - picks the content root per the order above;
  - builds `textContent` = the root's `innerText`, whitespace-normalized (collapse runs of blank lines/spaces) and capped at 100_000 chars;
  - reads `title` (`meta[property="og:title"]` → `document.title` → first `<h1>`), `byline` (`meta[name="author"]` → `meta[property="article:author"]` → `[rel="author"]`), `excerpt` (`meta[name="description"]` → `meta[property="og:description"]` → first ~200 chars of `textContent`), `lang` (`document.documentElement.lang || null`);
  - returns `{ title, byline, excerpt, textContent, length, lang }` where `length = textContent.length`, or `null` if `textContent` is empty/whitespace (nothing readable);
  - the whole body is wrapped in `try { … } catch { return null }` so a page exception yields `null`, not a thrown evaluate. Untested string (precedent: collectorScript/markScript — the handler test covers coercion).
- **`reader.ts`** (new) — `readerExtract(cdp: CdpClient): Promise<ReaderResult>` where `ReaderResult = { title: string; byline: string | null; excerpt: string | null; textContent: string; length: number; lang: string | null } | { error: string }`. It runs `evaluateExpression(cdp, READER_JS)` and coerces: a well-formed object (has a string `textContent`) is returned (normalized to the typed shape); `null`/non-object → `{ error: "no readable content" }`. A thrown error (e.g. `NO_TAB_BOUND`, or the page navigating) is **not** caught — it propagates as the tool error, consistent with the other handlers.
- **`registry.ts`** (modify) — import `readerExtract`; add `reader_extract: onCdp(readerExtract)` to the handler map.
- **`registry.test.ts`** (modify) — add `"reader_extract"` to `EXPECTED_TOOLS`.

In `packages/pi-daemon/pi-extension/browser-bridge.ts`:
- **`reader_extract` description** (modify) — soften "Extract the main article … using Mozilla's Readability" to "… using a readability-style extraction" (the relay + empty params are unchanged).

## Data flow

```text
reader_extract {}  → bridge → readerExtract(cdp)
  v = await evaluate(READER_JS)            // {title,byline,excerpt,textContent,length,lang} | null
  isObject(v) && typeof v.textContent==="string"
     ? coerce → { title, byline, excerpt, textContent, length, lang }
     : { error: "no readable content" }
  (a thrown evaluate — no tab bound / navigating — propagates)
```

## Error handling

- No content root with real text (empty page, JS-only SPA shell) → `READER_JS` returns `null` → `{ error: "no readable content" }`.
- A page exception inside `READER_JS` (exotic DOM) → caught in-script → `null` → `{ error: "no readable content" }`.
- `evaluate` throws (`NO_TAB_BOUND`, page navigating) → propagates (the agent sees the tool error), like the other CDP handlers.
- Coercion is defensive: missing/!string `byline`/`excerpt`/`lang` → `null`; `length` recomputed from `textContent` if absent/!number. `textContent` already capped in-script.

## Testing

`reader.test.ts` with `fakeCdp` (from `cdp/testCdp.ts`, returning a canned `Runtime.evaluate` value):
- a well-formed article result is returned as the typed shape (title/byline/excerpt/textContent/length/lang).
- `null` result → `{ error: "no readable content" }`.
- a non-object / malformed result (e.g. missing `textContent`) → `{ error: "no readable content" }`.
- a result with missing optional fields → coerced (`byline`/`excerpt`/`lang` → `null`; `length` recomputed).
- an unbound-tab rejection (`cdp.send` rejects with `NO_TAB_BOUND`) propagates (`rejects.toThrow`), mirroring the policy/page handler tests.
- `registry.test.ts`: `EXPECTED_TOOLS` includes `reader_extract`; the registry exposes the handler.
`READER_JS` itself isn't unit-tested (page-side string, per precedent). TDD, ≥90% per package.

## Sequencing

PR-2 (this spec) completes the **M4 PR4 tool layer** (all 45 forwarded ops live + the policy/structured/learn/proposeSave/runner/group-2 tools done). Next: **M5** (Swift macOS shell), then **M6** (packaging). A future enhancement could swap the heuristic for bundled Mozilla Readability behind the same `ReaderResult` contract.
