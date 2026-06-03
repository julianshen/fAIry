# Shadow DOM

Like iframes: **clicks pass through automatically**. Use coordinates first. Only descend into shadow trees when reading.

## Open shadow roots

```
browser_evaluate({ expression: "document.querySelector('my-widget').shadowRoot.querySelector('button').textContent" })
```

Chained:

```
browser_evaluate({ expression: "document.querySelector('app-root').shadowRoot.querySelector('order-form').shadowRoot.querySelector('input[name=qty]').value" })
```

## Closed shadow roots

`.shadowRoot` returns `null`. You generally can't reach in without the host's cooperation. Two workarounds:

- Use `composedPath()` from an event handler the host already wires up
- Use CDP `DOM.getDocument` with `pierce: true`:

```
browser_cdp({ method: "DOM.getDocument", params: { depth: -1, pierce: true } })
```

Then walk the returned tree — closed roots are still in the CDP representation.

## Detecting shadow boundaries

`browser_describe_at({ x, y })` returns the _light DOM_ element. If the visible thing is inside a shadow root, the descriptor will be the host element (e.g., `<my-button>`). That's a signal to use CDP traversal if you need details about what's inside.
