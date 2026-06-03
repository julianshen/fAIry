# Iframes

**The good news: `browser_click({ x, y })` works through iframes.** Mouse events dispatch at the compositor level — they don't care about frame boundaries, same-origin or not. Use coordinate clicks first.

Drop into iframe-aware code only when you need to _read_ DOM content inside the frame.

## Same-origin: traverse via contentDocument

```
browser_evaluate({ expression: "document.querySelector('iframe[name=billing]').contentDocument.querySelector('input[name=cardholder]').value" })
```

If `contentDocument` is null, it's cross-origin — switch tactics.

## Cross-origin: use CDP

```
browser_cdp({ method: "Target.getTargets" })
// find the frame target by URL
browser_cdp({ method: "Target.attachToTarget", params: { targetId: "<id>", flatten: true } })
// then Runtime.evaluate on that session
```

For most cases, prefer to _navigate to the iframe URL directly_ — it bypasses the parent entirely. Read the `src` attribute, navigate the top-level tab to it, do your work, navigate back.

## Coordinates: page vs frame

Click coordinates are always in _page_ space (top-left of the visible viewport = 0,0). Don't add the iframe's offset twice — the hit test does it for you.

If a click lands "next to" your target instead of on it, the most common cause is the iframe being inside a scrollable container — scroll the container into view first.
