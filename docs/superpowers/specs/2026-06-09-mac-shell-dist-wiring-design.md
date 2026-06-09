# macOS shell — distribution wiring (M5-5b) — design

**Status:** approved (design phase) · **Date:** 2026-06-09 · **Component:** `packages/mac-shell` · **Builds on:** the bundled `Fairy.app` (M5-5a) · **Part of:** M5 (macOS shell), sub-project 5 (packaging), **part b of (a, b, c)**.

## Context

M5-5a produced a runnable unsigned `Fairy.app`. The product's v1 scope commits to **launch-at-login** and **Sparkle auto-update from v1**. This sub-project adds the **in-app wiring** for both: a "Launch at login" menu toggle (via `SMAppService`) and Sparkle's updater + a "Check for Updates…" menu item, with the update feed/key as Info.plist placeholders. The **release pipeline** that makes these functional — code signing, notarization, the DMG, and the EdDSA-signed appcast — is M5-5c (credential-gated, run by the user).

## Goal & non-goals

**Goal:** the shell *compiles and ships* the launch-at-login toggle and the Sparkle updater (+ "Check for Updates…"), with a unit-tested toggle logic core. The Info.plist carries `SUFeedURL`/`SUPublicEDKey` as documented placeholders.

**Non-goals (→ 5c, credential-gated):** `codesign`, `notarytool` + staple, the DMG, `generate_appcast` (EdDSA), the real feed URL + public key, and hosting. Out of scope entirely: bundling the Pi agent (M6).

**Verification boundary (important):** almost nothing in 5b is *functionally* testable here, for two reasons. `SMAppService.mainApp.register()` requires a real signed bundle identity; Sparkle's updater needs a signed app + a live appcast. So launch-at-login actually launching, and a real update check, are **manual smokes on a signed build (5c)**. What 5b verifies here: (1) the `LoginItemController` toggle logic via an injected fake service (unit tests), and (2) that the wiring **compiles** against the real `SMAppService` + Sparkle APIs. The plan derisks Sparkle's SPM resolution first; if this sandbox can't fetch it, the dependency-free login-item half still builds + tests here and the Sparkle build-verify defers to a networked machine.

## Decisions (and why)

1. **A tested `LoginItemController` over an injected `LoginItemService`; everything else is thin glue.** The toggle is the only piece with branching (enable-when-disabled / disable-when-enabled, surface a thrown error, reflect real OS state), so it's a pure unit tested against a fake service. `SMAppService`, Sparkle, and the menu are coverage-excluded glue — consistent with the whole shell. Rejected: calling `SMAppService` directly in `AppDelegate` (leaves the toggle logic untested).
2. **Sparkle via `SPUStandardUpdaterController`.** The batteries-included controller creates the updater, provides the standard update UI, and does automatic background checks — the least-code path for a menu-bar app, and the project committed to auto-update from v1. A thin `UpdateController` wraps it and exposes `checkForUpdates()` for the menu. No logic of ours → glue.
3. **`SUFeedURL`/`SUPublicEDKey` as documented placeholders.** The real values come from the user's EdDSA keypair + release host in 5c. The Info.plist carries obvious placeholder strings + a comment so the wiring is complete and 5c just substitutes real values.
4. **Login-item is opt-in (off by default).** The app does not auto-register at first launch; the user enables it via the toggle. The menu item shows a checkmark reflecting the actual `SMAppService` status, refreshed on menu-open (so it stays truthful even if changed in System Settings).

## Architecture & components

In `packages/mac-shell/`:

**`Sources/FairyShell/` (TESTED):**
- **`LoginItem.swift`** —
  ```swift
  public protocol LoginItemService {
    var isEnabled: Bool { get }
    func enable() throws
    func disable() throws
  }
  public final class LoginItemController {
    public init(service: LoginItemService)
    public var isEnabled: Bool { get }     // delegates to service.isEnabled
    @discardableResult public func toggle() -> Bool   // returns the resulting isEnabled
  }
  ```
  `toggle()`: if `service.isEnabled` → `disable()`, else `enable()`; on a thrown error, leave the state as the service reports (no optimistic flip) and return the current `isEnabled`. Pure over the injected service.

**`Sources/fairy-shell/` (glue, coverage-excluded):**
- **`SMAppServiceLoginItem.swift`** — `LoginItemService` backed by `SMAppService.mainApp`: `isEnabled` = `.status == .enabled`; `enable()` = `register()`; `disable()` = `unregister()` (both `throws`).
- **`UpdateController.swift`** — owns an `SPUStandardUpdaterController` (started automatically; `startingUpdater: true`); `checkForUpdates()` calls `updater.checkForUpdates()`.
- **`AppDelegate.swift`** — owns a `LoginItemController` (with `SMAppServiceLoginItem`) + an `UpdateController`; adds two menu items: **"Launch at login"** (`#selector(toggleLoginItem)`, checkmark bound to `loginItem.isEnabled`, refreshed in `menuWillOpen`) and **"Check for Updates…"** (`#selector(checkForUpdates)`).

**Config / build:**
- **`Package.swift`** — add `.package(url: "https://github.com/sparkle-project/Sparkle", from: "2.6.0")` and `"Sparkle"` as a dependency of the `fairy-shell` executable target.
- **`scripts/Info.plist`** — add `SUFeedURL` (`https://EXAMPLE-REPLACE-IN-5C/appcast.xml`), `SUPublicEDKey` (`REPLACE-WITH-EDDSA-PUBLIC-KEY-IN-5C`), and `SUEnableAutomaticChecks` = `true`, each with an XML comment marking it a 5c placeholder.

## Data flow

```text
"Launch at login" → LoginItemController.toggle()
   service.isEnabled ? service.disable() : service.enable()   (SMAppService.mainApp)
   → menu checkmark = loginItem.isEnabled
menuWillOpen → refresh the checkmark from service.isEnabled (the real OS state)

"Check for Updates…" → UpdateController.checkForUpdates()
   → SPUStandardUpdaterController → reads SUFeedURL/SUPublicEDKey (Info.plist)
   → fetch appcast, verify EdDSA, prompt/install (Sparkle's standard UI)
Sparkle also auto-checks in the background per SUEnableAutomaticChecks.
```

## Error handling

- **Login toggle throws** — `SMAppService.register()`/`unregister()` can throw (e.g. an unsigned `swift run` build, or the user denied it in System Settings). `LoginItemController.toggle()` catches and leaves `isEnabled` at whatever the service reports, returning that; the menu checkmark stays truthful rather than showing an optimistic state. Documented: registration only succeeds from a signed `.app`.
- **Sparkle with placeholder feed/key** — "Check for Updates" can't fetch/verify until 5c fills real values; Sparkle reports a normal update error in its UI (no crash). Background auto-checks likewise no-op against the placeholder feed.
- **`swift run` (dev)** — `SMAppService`/Sparkle compile and the menu items appear, but neither functions without a signed bundle; that's expected and is the manual-smoke boundary.

## Testing

- **`LoginItemController`** (XCTest, fake `LoginItemService`): `toggle()` enables when disabled and disables when enabled; returns the resulting `isEnabled`; on a thrown `enable()`/`disable()` it leaves the state unchanged and returns the service's `isEnabled`. ≥90% on `FairyShell` holds.
- **Glue** (`SMAppServiceLoginItem`, `UpdateController`, the menu, Sparkle) — runtime-verified on a signed build (5c), not unit-tested.
- **Build verification:** `swift build` compiles the exe against `SMAppService` + the Sparkle dependency. The plan's first task derisks Sparkle's SPM resolution in this environment; the login-item half is dependency-free and fully built+tested here regardless.

## Sequencing

5b (this). Then **5c — release pipeline** (credential-gated, run by the user with their Apple Developer account + release host): `codesign --options runtime` (Developer ID Application) over the `.app` + nested binaries (`fairy-daemon`, the panel bundle, Sparkle's XPC services), `notarytool submit --wait` + `stapler staple`, the DMG, `generate_appcast` (EdDSA-signs the update, writes `appcast.xml`), and substituting the real `SUFeedURL`/`SUPublicEDKey`. Then M6 (bundle Pi; end-to-end on a real site).
