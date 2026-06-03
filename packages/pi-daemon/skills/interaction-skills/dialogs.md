# Dialogs

`alert()`, `confirm()`, `prompt()`, and `beforeunload` open native dialogs that **block the page until dismissed**. If you don't handle them, your next tool call hangs.

## Pre-arm before the action

Subscribe to the CDP event _before_ the click that may trigger it:

```
browser_cdp_subscribe({ method: "Page.javascriptDialogOpening" })
browser_click({ x, y })       // the dangerous click
browser_cdp({ method: "Page.handleJavaScriptDialog", params: { accept: false } })
// or { accept: true, promptText: "..." }
```

`accept: false` ≈ cancel, `accept: true` ≈ OK. For `prompt()`, supply `promptText`.

## Drained-after-the-fact

If a dialog is already open and your tool calls are hanging, run `Page.handleJavaScriptDialog` first to free the page, then check `cdpCollect` to see what type it was.

## beforeunload

Triggered when you navigate away from a form with unsaved changes. The default `Page.handleJavaScriptDialog` with `accept: true` confirms the leave. Page also fires `Page.frameNavigated` after; you can subscribe to that to know you actually moved.

## Custom (non-native) modals

These are just `<div>`s — they don't block, and `browser_dismiss_overlays()` clears most of them. Only native ones need the CDP handshake.
