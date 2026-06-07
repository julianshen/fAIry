---
name: horizon-browser
description: Direct browser control inside Horizon. Use when the user wants to navigate, scrape, fill, or automate any web page. The browser is the user's already-open tab — you are *inside* it, not driving it from outside.
---

# horizon-browser

You have direct access to whatever the user is looking at. Tools are namespaced `browser_*` and dispatched over a local bridge — every call lands on the active tab. No tab-id juggling, no profile to launch, no headless mode.

## The seven primitives you'll lean on most

```
browser_navigate({ url })            // load a URL in the current tab
browser_screenshot()                 // PNG of the visible viewport (returns base64 + w/h)
browser_axtree()                     // accessibility tree — names, roles, bounding rects
browser_click({ x, y })              // dispatches mousePressed + mouseReleased at exact coords
browser_type({ text })               // one CDP char event per char into the focused element
browser_scroll({ deltaY })           // wheel event on whatever's under the cursor
browser_evaluate({ expression })     // raw JS in the page; returns { ok, value | error }
```

Six more sit on top of those:

```
browser_wait_for({ selector | networkIdle | urlContains, timeoutMs? })
browser_dismiss_overlays()           // removes common cookie/modal/banner clutter
browser_describe_at({ x, y })        // tag, id, classes, rect, text — for what's under a pixel
browser_getDom({ depth? })          // structured DOM snapshot
browser_getUrl() / browser_getTitle()
browser_cdp({ method, params })      // escape hatch — raw Chrome DevTools Protocol
```

## The patterns that work

### Click-by-pixel beats selector hunting

```
browser_screenshot_marked() → pick a mark id → click its (x, y) → screenshot to verify
```

`screenshot_marked` overlays numbered boxes on every visible interactive element and returns both the PNG and a `marks: [{id, x, y, w, h, tag, role, label, href}]` array. You read "the 'Submit' button is mark 7" off the image, then click mark 7's center. Far more reliable than picking pixels by eye.

**Marks are numbered in reading order by default** — top-to-bottom rows, left-to-right within each row, like a human scans the page. Mark 1 is the top-left interactive element; numbers grow toward the bottom-right. So "click the third result" really does mean the third visually-appearing result, not whatever the DOM happens to put third. Pass `order: 'dom'` if you specifically want document order (rare; only useful when aligning with `browser_getDom`).

Use plain `browser_screenshot` when you just need to _look_ at the page (reading content, verifying state). Use `screenshot_marked` when the next step is to click.

The compositor dispatches mouse events _through_ iframes, shadow DOM, and cross-origin frames for free. Only fall back to selectors when the target has no visible geometry (hidden input, off-screen helper). `axtree` is a third option — same idea as marks but text-only (no image) when you don't need to _see_ the page.

### Read the site's agent policy before deep workflows

If you're about to do anything beyond reading — clicking, typing, submitting — call `browser_get_agent_policy()` (or look at the `agentPolicy` field in the `browser_navigate` response). Sites that publish a Level 1+ policy at `/agent.json` declare what's allowed, what requires the user's nod, and what's off-limits. Examples:

- `requires_human: [{trigger: "payment"}]` → the user must approve any checkout-shaped action; the safety guard already enforces this, but you should plan around it.
- `prohibited: [{trigger: "captcha_solving"}]` → don't attempt it. Detect, surface to the user.
- `actions: [{name: "search", endpoint: "GET /api/v1/search", ...}]` → prefer the structured endpoint over UI clicking.
- `objectives: [{id: "add_to_cart", preferred_flow: "..."}]` → planning hint for your task decomposition.

Sites without a policy → apply your own defaults: read freely, navigate within origin, ask before clicking/typing/eval.

### Always wait_for after navigate

```
browser_navigate({ url })
browser_wait_for({ networkIdle: true, idleMs: 600 })   // or { selector: "main" }, { urlContains: "/dashboard" }
```

The navigate call returns when the request is committed, not when the page is interactive. Skipping the wait is the #1 source of "I clicked but nothing happened."

### Dismiss overlays before you start

`browser_dismiss_overlays()` strips cookie banners, GDPR walls, newsletter pop-ups, and "we use cookies" toasts. Run it once after navigate; saves you having to model each site's bespoke modal.

### Record action sequences for deterministic replay

A helper is a snippet you call inside the page. A **workflow** is a sequence of _tool calls_ the agent will replay later — perfect for "export my order history monthly", "post the daily standup", "download yesterday's report."

```
browser_workflow_record_start({ name: "amazon-orders-export" })
browser_navigate({ url: "https://amazon.com/orders" })
browser_wait_for({ networkIdle: true, idleMs: 500 })
browser_click({ x: ..., y: ... })       // "Download report"
...
browser_workflow_record_stop()
```

Next time:

```
browser_workflow_run({ name: "amazon-orders-export" })
```

The replay dispatches each step through the same tools — same safety checks, same error handling. Stops on the first failed step (the page has diverged from what was recorded). Read-only calls (screenshot, axtree) aren't recorded; you call those at run time, not during replay.

When to record vs save a helper: a helper extracts/reads (one JS call → value). A workflow performs (many tool calls → side effects). Use both — the workflow can call helpers as one of its steps.

### Persist anything you derive

If you write a JS snippet that works — a price extractor, a deep-link constructor, a state-machine probe — **save it**:

```
browser_save_helper({ name: "extract_amazon_prices",
                      expression: "() => [...document.querySelectorAll('.a-price')].map(e => e.textContent)",
                      description: "Amazon search-result prices" })
```

Helpers persist to disk and survive restarts. Call them with `browser_call_helper({ name, args })`. The next time you're on the same site you can skip the discovery loop.

### Observe what the page _does_, not just what it shows

When you take an action and want to know what network calls fired, use the CDP subscription pattern:

```
browser_cdp_subscribe({ method: "Network.responseReceived" })
browser_click({ x, y })               // the action whose effects you care about
browser_wait_for({ networkIdle: true, idleMs: 600 })
browser_cdp_collect({ method: "Network.responseReceived" })  // drains the buffer
```

Subscriptions persist across turns; you don't have to re-subscribe every call. Unsubscribe explicitly when you're done.

### Open tabs when you need to drill in without losing your place

Search-then-deep-dive: keep the SERP open in tab A, click the first result, decide it's not it, want to try the second?

```
browser_tab_open({ url: "https://search.example/q?serp=..." })   // tab A
// ... examine results ...
browser_tab_open({ url: resultLink })                            // tab B
// ... drill in ...
browser_tab_switch({ id: tabAId })                               // back to SERP
browser_tab_close({ id: tabBId })                                // tidy
```

`browser_tab_list()` shows everything that's open. Don't open more than a handful — each tab uses a renderer process and memory.

## Stuck on a specific mechanic?

Read the matching file in `interaction-skills/`:

- `scrolling.md` — page vs nested vs virtualized
- `dropdowns.md` — native `<select>` vs custom overlays vs comboboxes
- `iframes.md` — same-origin traversal, frame-vs-page coordinates
- `shadow-dom.md` — closed shadow roots, `composedPath`
- `dialogs.md` — `alert`/`confirm`/`prompt` traps
- `uploads.md` — file input via CDP
- `downloads.md` — capturing blobs without clicking
- `infinite-scroll.md` — IntersectionObserver sentinels
- `login-walls.md` — what to do (and not do) at auth gates
- `captcha.md` — detect, never solve
- `network-spying.md` — CDP subscribe playbook
- `helpers.md` — when to save, when to inline
- `forms.md` — typing into the right field, validation gotchas

Read the file when you hit that mechanic — not preemptively.

## Domain skills

Per-site notes you've accumulated live in **`domain-skills/<host>/`**, stored in the user's data dir, not bundled. When you land on a site, call `browser_domain_skill_list({ host })` to see what notes exist for it.

If that list is non-empty, **read every entry (`browser_domain_skill_read`) before inventing an approach**. The agent (you, on previous turns) left those notes for a reason — usually a quirk specific to that site.

When you're on a _new_ site but suspect you've handled a similar problem before (captcha, infinite scroll, login wall), search across all saved notes with `browser_domain_skill_search({ query: "captcha" })` — it scans every host's files and returns the best matches.

To add a new one when you discover a quirk worth remembering:

```
browser_domain_skill_save({ host: "amazon.com",
                            name: "captcha-after-search.md",
                            body: "If a CAPTCHA appears after 3+ searches in a session, ..." })
```

Use kebab-case file names ending in `.md`. Keep them short — a few hundred words — and focused on one quirk per file.

## Footguns

- **Don't click before the page is interactive.** Always `wait_for` after navigate or a navigation-triggering click.
- **Don't type into nothing.** Click the field first; `browser_type` sends to whoever has focus, which may be no one.
- **Don't trust `screenshot` for off-viewport content.** Scroll first.
- **Don't try to solve a CAPTCHA.** Detect it, surface it to the user, ask them to clear it.
- **Don't enter passwords or credit cards.** Hand off to the user.
- **Don't `evaluate` huge return values.** Crossing the bridge costs JSON serialization; prefer narrowed reads (single field, count, slice) over `JSON.stringify(document)`.
- **Screenshots are JPEG by default** for `browser_screenshot_marked` (~10x smaller than PNG). You almost never need PNG unless you're doing OCR-quality work — JPEG quality 70 is fine for "what's on the page." If a long task starts feeling sluggish or upstream rejects with "message size", call `browser_compact` to summarize history and drop bulky tool returns.
