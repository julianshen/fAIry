# Dropdowns

Four flavors. Identify which one before reaching for a tool.

## Native `<select>`

```
browser_evaluate({ expression: "document.querySelector('select[name=country]').value = 'US'; document.querySelector('select[name=country]').dispatchEvent(new Event('change', { bubbles: true }))" })
```

Don't click — the OS picker doesn't render in headless-ish contexts and you can't see the options anyway.

## Custom overlay (`<div role="listbox">`)

Click the trigger → screenshot → click the option. **Re-measure after opening** — options often render with a transition, and their bounding rects don't stabilize for 100-200ms:

```
browser_click({ x: triggerX, y: triggerY })
browser_wait_for({ selector: "[role=option]" })
// NOW screenshot — option geometry is settled
```

## Combobox (typeahead)

Type into the input first, _then_ click the suggestion:

```
browser_click({ x: inputX, y: inputY })
browser_type({ text: "Bra" })
browser_wait_for({ selector: "[role=option]" })
// screenshot, click "Brazil"
```

Some comboboxes need a deliberate pause between keystrokes (debounced fetch). If the suggestion list doesn't appear, give it `browser_wait_for({ networkIdle: true, idleMs: 400 })`.

## Virtualized menu

Long country lists, time-zone pickers. Same rule as virtualized scrolling — the item you want may not be in the DOM. Type to filter when possible; if not, scroll the menu container (not the page) and re-screenshot.
