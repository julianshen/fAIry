# macOS shell — pairing surface — design

**Status:** approved (design phase) · **Date:** 2026-06-08 · **Component:** `packages/mac-shell` (extends M5-1) · **Builds on:** the daemon's `pairing.json` + the M5-1 menu · **Part of:** M5 (macOS shell), sub-project 2 of 5.

## Context

To use the Chrome extension, the user must pair it with the daemon: the daemon writes a single-use **pairing code** to `pairing.json` (`{ "code": String }`, 0600, under the app-data dir), and the extension `POST`s `/pair` with that code to get the session token. M5-1 gave the shell a menu-bar menu (status / Restart / Quit). This sub-project **surfaces the pairing code in that menu** so the user can copy it into the extension's options.

## Goal & non-goals

**Goal:** the menu shows the current pairing code and offers a one-click copy-to-clipboard, staying fresh across daemon restarts.

**Non-goals (this sub-project):** regenerating/refreshing the code (the daemon has no such endpoint — it'd be a future daemon change), a dedicated pairing window/popover, and showing paired/unpaired status. The code is single-use and consumed on first pair; `pairing.json` isn't rewritten on consumption, so a stale code may display after pairing — showing the file's code verbatim is correct for v1.

## Decisions (and why)

1. **A tiny tested `PairingReader` + menu glue** — no new windows, no daemon change. The read/parse logic is a pure library unit (tested like `StatusClient`'s token read); the menu item + `NSPasteboard` are AppKit glue (coverage-excluded, like the rest of `AppDelegate`).
2. **Refresh on `menuWillOpen`** (the `AppDelegate` becomes the menu's `NSMenuDelegate`) — re-read `pairing.json` each time the menu opens, so the code reflects the current daemon session (a daemon restart mints a new token + rewrites `pairing.json` with a new code). On-open refresh avoids polling and is always current when the user looks.
3. **Read-only.** The shell only displays the code the daemon wrote; it never writes `pairing.json` or mints codes.

## Architecture & components

In `packages/mac-shell/`:

- **`Sources/FairyShell/PairingReader.swift`** (new, TESTED) —
  ```swift
  public enum PairingReader {
    /// The current pairing code from `pairing.json` (`{ "code": String }`), or
    /// nil if the file is missing/unreadable/malformed or the code is empty.
    public static func read(from url: URL) -> String?
  }
  ```
  Reads the file, JSON-decodes `{ code: String }`, returns the code when non-empty, else `nil`.
- **`Sources/fairy-shell/AppDelegate.swift`** (modify, GLUE) —
  - In `buildMenu()`, add (between the daemon-status section and Restart): a **disabled** display item `pairingMenuItem` (`Pairing code: …`) and an enabled **Copy pairing code** item (`#selector(copyPairingCode)`).
  - Make `AppDelegate` the menu's `delegate` (conform to `NSMenuDelegate`); implement `menuWillOpen(_:)` → `refreshPairing()`.
  - `refreshPairing()` = `PairingReader.read(from: appData.appendingPathComponent("pairing.json"))`; store the latest code; set the display title (`Pairing code: <code>` or `Pairing code: (unavailable)`) and enable/disable the Copy item.
  - `@objc copyPairingCode()` → if a code is held, `NSPasteboard.general.clearContents(); NSPasteboard.general.setString(code, forType: .string)`.

The `appData` URL already exists in `AppDelegate` (M5-1: `~/Library/Application Support/fairy`).

## Data flow

```text
user opens the menu → NSMenuDelegate.menuWillOpen → refreshPairing()
   PairingReader.read(appData/pairing.json)
     code   → display "Pairing code: <code>", enable Copy
     nil    → display "Pairing code: (unavailable)", disable Copy
Copy pairing code → NSPasteboard.general { clearContents; setString(code) }
```

## Error handling

- `pairing.json` missing (daemon still starting / not yet paired) or unreadable → `read` returns `nil` → "Pairing code: (unavailable)", Copy disabled. The next `menuWillOpen` re-reads (so once the daemon writes the file, the code appears).
- Malformed JSON or empty/absent `code` → `nil` (same as missing).
- Copy with no held code → no-op (the item is disabled in that state anyway).

## Testing

`PairingReaderTests` (with a temp `pairing.json`):
- valid `{"code":"8F3K2A91"}` → `"8F3K2A91"`.
- missing file → `nil`.
- malformed JSON → `nil`.
- empty `code` (`{"code":""}`) / absent `code` (`{}`) → `nil`.
The menu + `NSPasteboard` + `menuWillOpen` wiring is AppKit glue — runtime-verified by launching the app (open the menu, click Copy, paste), not unit-tested (consistent with M5-1's executable target). ≥90% on `FairyShell` holds (`PairingReader` fully covered).

## Sequencing

M5 sub-project 2 (this). Next: **(3) native Settings UI** (SwiftUI ↔ the daemon's `GET`/`PUT /settings`). Then (4) WKWebView conversation panel, (5) packaging. A future enhancement: a daemon endpoint to regenerate a pairing code on demand (so the shell can offer "new code" for re-pairing).
