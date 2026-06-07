# Scrolling

`browser_scroll({ deltaY })` dispatches a wheel event at (0, 0) by default — whatever element is under the cursor receives it. That's almost always the page root, but not always.

## Page vs nested container

Modern sites embed scrollable regions (chat panels, feed columns, modal bodies) that swallow wheel events. If the page doesn't move:

```
browser_evaluate({ expression: "(() => { const el = document.elementFromPoint(400, 300); let s = el; while (s && getComputedStyle(s).overflowY === 'visible') s = s.parentElement; return s?.tagName + '#' + (s?.id || '') })()" })
```

That returns the actual scroll container. To scroll _it_:

```
browser_evaluate({ expression: "document.querySelector('main.feed').scrollBy(0, 800)" })
```

## Virtualized lists

Lists that mount/unmount items as you scroll (React Window, TanStack Virtual) don't have everything in the DOM at once. To find a specific row, scroll incrementally and `axtree`/screenshot between steps — don't query for it before scrolling, it won't exist yet.

## Infinite scroll

See `infinite-scroll.md` — there's an IntersectionObserver pattern that's faster than blind wheel events.

## Smooth vs instant

`scrollBy({ behavior: 'smooth' })` returns immediately while the scroll animates. Either pass `behavior: 'instant'` or `browser_wait_for({ networkIdle: true, idleMs: 400 })` before reading positions.
