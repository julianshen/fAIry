# Infinite scroll

Sites that load more content as you reach the bottom: Twitter, Reddit, LinkedIn feeds, search results. Naive wheel-scrolling works but is slow and brittle.

## Detect the sentinel

Most use an `IntersectionObserver` watching a sentinel element near the bottom. Find it:

```
browser_evaluate({ expression: "[...document.querySelectorAll('*')].filter(e => /loader|sentinel|scroll-anchor/i.test(e.className)).map(e => e.outerHTML.slice(0, 100))" })
```

Once found, scroll it into view:

```
browser_evaluate({ expression: "document.querySelector('.scroll-sentinel').scrollIntoView()" })
browser_wait_for({ networkIdleMs: 500 })
```

Each call loads one more page worth of items.

## Loop with a count check

```
browser_save_helper({ name: "load_more_until",
  expression: `async (target) => {
    let last = 0;
    for (let i = 0; i < 30; i++) {
      const cur = document.querySelectorAll('article').length;
      if (cur >= target || cur === last) return cur;
      last = cur;
      const s = document.querySelector('.scroll-sentinel') ||
                document.querySelector('[role=feed] > :last-child');
      s?.scrollIntoView();
      await new Promise(r => setTimeout(r, 600));
    }
    return document.querySelectorAll('article').length;
  }` })

browser_call_helper({ name: "load_more_until", args: [100] })
```

The `last === cur` check catches the end-of-feed case where the sentinel stops triggering.

## Don't scroll past needed

Pulling 5000 items into memory is slow and may trigger anti-bot heuristics. Scroll exactly as much as you need, then extract.
