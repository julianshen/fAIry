# Helpers

Persistent named JS functions on disk. Survive restarts. Use them whenever you derive a snippet you'll want again.

## When to save

Save when **any** of these are true:

- You spent time figuring out a selector that's specific to this site
- The logic involves multiple steps you don't want to redo
- The snippet has site-specific knowledge (URL shape, CSRF cookie name, hidden field id)

Don't save throwaway one-liners like `document.title`. Those are cheaper to write inline than to remember the helper name for.

## Shape

A helper is an **expression that evaluates to a function**, not a function body:

```
browser_save_helper({
  name: "extract_amazon_prices",
  description: "Map Amazon search-result cards to {title, price, asin}",
  expression: `() => [...document.querySelectorAll('[data-asin]')].map(card => ({
    asin: card.getAttribute('data-asin'),
    title: card.querySelector('h2')?.textContent?.trim(),
    price: card.querySelector('.a-price')?.textContent?.trim(),
  })).filter(x => x.asin && x.title)`
})
```

`(x) => ...`, `async (...) => ...`, IIFE returning a function — all valid. The registry doesn't care, it just injects `window.__horizon.helpers[name] = (your expression)`.

## Call

```
browser_call_helper({ name: "extract_amazon_prices" })
browser_call_helper({ name: "click_search_result", args: [3] })   // 4th result (0-indexed)
```

Returns the return value (or `{ ok: false, error }` on exception).

## Refining

`browser_save_helper` overwrites by name. If a helper stops working because the site changed, save the new version under the same name — no delete needed.

## Naming

Use `<site>_<verb>_<noun>` for site-specific helpers (`amazon_extract_prices`, `gh_click_pr_merge`). Use `<verb>_<noun>` for generic ones (`load_more_until`, `dismiss_cookie_banner_v2`).

## Discoverability

`browser_list_helpers()` returns everything you've saved. If you suspect you've worked on this site before, list first.
