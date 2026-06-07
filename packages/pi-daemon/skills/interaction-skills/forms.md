# Forms

The two failure modes: typing into the wrong field, and submitting before validation completes.

## Always click first, then type

`browser_type` sends chars to whoever has focus. After navigate, focus is on `<body>`; your keystrokes go nowhere visible.

```
browser_click({ x: fieldX, y: fieldY })
browser_type({ text: "user@example.com" })
```

Verify the field actually received the input before moving on:

```
browser_evaluate({ expression: "document.activeElement.value" })
```

## Clear existing content

`type` appends. To replace, select-all first:

```
browser_click({ x, y })
browser_cdp({ method: "Input.dispatchKeyEvent", params: { type: "keyDown", key: "a", modifiers: 4 } })   // 4 = Meta on mac, 2 on win/linux
browser_cdp({ method: "Input.dispatchKeyEvent", params: { type: "keyUp",   key: "a", modifiers: 4 } })
browser_type({ text: "new value" })
```

## Validation gotchas

Most forms run validation on `blur`, not on every keystroke. After typing the last field, click somewhere neutral (or press Tab) before submitting — otherwise the "this is required" error shows up _after_ you click Submit, and your click hit a disabled button:

```
browser_cdp({ method: "Input.dispatchKeyEvent", params: { type: "rawKeyDown", key: "Tab" } })
browser_wait_for({ networkIdle: true, idleMs: 300 })
```

## Captcha-on-submit

Some sites only mount the captcha after the first failed submit. If submit silently no-ops, screenshot the area — there may be a new challenge widget. See `captcha.md`.

## Multi-step wizards

Each step is usually a separate `<form>` with its own submit. Wait for `Page.frameNavigated` or `networkIdle` between steps; don't fire all the clicks in a row.

## Don't autofill financial fields

Card numbers, CVV, bank account numbers, SSN — refuse. Hand off to the user. See `login-walls.md` for the pattern.
