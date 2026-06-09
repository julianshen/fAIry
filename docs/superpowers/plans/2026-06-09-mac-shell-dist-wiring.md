# macOS shell — distribution wiring (M5-5b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The shell compiles and ships a "Launch at login" toggle (`SMAppService`) and Sparkle's updater + a "Check for Updates…" menu item, with `SUFeedURL`/`SUPublicEDKey` as Info.plist placeholders and the toggle logic unit-tested.

**Architecture:** A tested `LoginItemController` over an injected `LoginItemService` holds the only branching logic; `SMAppService`, Sparkle's `SPUStandardUpdaterController`, and the menu are coverage-excluded glue. Sparkle is added as an SPM dependency (resolution derisked first).

**Tech Stack:** Swift 6 / SPM (language mode 5, macOS 13), XCTest, `ServiceManagement` (`SMAppService`), Sparkle (SPM). Run `swift` from `packages/mac-shell/`.

**Spec:** `docs/superpowers/specs/2026-06-09-mac-shell-dist-wiring-design.md` (M5-5b; 5c = sign/notarize/DMG/appcast + embedding `Sparkle.framework`, run by the user).

**Scope boundary:** 5b does NOT modify `scripts/package.sh`. Embedding `Sparkle.framework` (+ its XPC services) into the `.app` and fixing rpath belong with code-signing in **5c** (embed + sign are one concern). So after 5b, `swift build`/`swift run` find Sparkle via the build products, but the hand-assembled `.app` won't *launch* with Sparkle until 5c embeds it — launching was already the 5c manual smoke. 5b's verified deliverable is: the toggle logic (unit tests) + the exe **building** against `SMAppService` + Sparkle.

Commit trailer MUST be EXACTLY (use `git commit -F -` heredoc):
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 1: `LoginItemController` — launch-at-login toggle logic (FairyShell, TESTED)

**Files:**
- Create: `packages/mac-shell/Sources/FairyShell/LoginItem.swift`
- Test: `packages/mac-shell/Tests/FairyShellTests/LoginItemControllerTests.swift`

- [ ] **Step 1: Write the failing test**

Create `packages/mac-shell/Tests/FairyShellTests/LoginItemControllerTests.swift`:

```swift
import XCTest
@testable import FairyShell

/// A fake login-item service: tracks calls and can simulate a thrown register/unregister.
final class FakeLoginItemService: LoginItemService {
  var isEnabled: Bool
  var throwOnEnable = false
  var throwOnDisable = false
  private(set) var enableCount = 0
  private(set) var disableCount = 0
  init(isEnabled: Bool) { self.isEnabled = isEnabled }
  func enable() throws {
    enableCount += 1
    if throwOnEnable { throw NSError(domain: "test", code: 1) }
    isEnabled = true
  }
  func disable() throws {
    disableCount += 1
    if throwOnDisable { throw NSError(domain: "test", code: 1) }
    isEnabled = false
  }
}

final class LoginItemControllerTests: XCTestCase {
  func testEnablesWhenDisabled() {
    let s = FakeLoginItemService(isEnabled: false)
    let c = LoginItemController(service: s)
    XCTAssertTrue(c.toggle())            // returns the resulting state
    XCTAssertEqual(s.enableCount, 1)
    XCTAssertEqual(s.disableCount, 0)
    XCTAssertTrue(c.isEnabled)
  }

  func testDisablesWhenEnabled() {
    let s = FakeLoginItemService(isEnabled: true)
    let c = LoginItemController(service: s)
    XCTAssertFalse(c.toggle())
    XCTAssertEqual(s.disableCount, 1)
    XCTAssertFalse(c.isEnabled)
  }

  func testEnableThrowLeavesDisabled() {
    let s = FakeLoginItemService(isEnabled: false); s.throwOnEnable = true
    let c = LoginItemController(service: s)
    XCTAssertFalse(c.toggle())           // enable threw → still disabled, no optimistic flip
    XCTAssertFalse(c.isEnabled)
  }

  func testDisableThrowLeavesEnabled() {
    let s = FakeLoginItemService(isEnabled: true); s.throwOnDisable = true
    let c = LoginItemController(service: s)
    XCTAssertTrue(c.toggle())            // disable threw → still enabled
    XCTAssertTrue(c.isEnabled)
  }

  func testIsEnabledDelegatesToService() {
    XCTAssertTrue(LoginItemController(service: FakeLoginItemService(isEnabled: true)).isEnabled)
    XCTAssertFalse(LoginItemController(service: FakeLoginItemService(isEnabled: false)).isEnabled)
  }
}
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `cd packages/mac-shell && swift test --filter LoginItemControllerTests`
Expected: FAIL — `LoginItemService`/`LoginItemController` don't exist.

- [ ] **Step 3: Implement `LoginItem.swift`**

```swift
import Foundation

/// The OS-level "open at login" registration, abstracted so the toggle logic is
/// testable without `SMAppService` (which only functions from a signed .app).
public protocol LoginItemService {
  var isEnabled: Bool { get }
  func enable() throws
  func disable() throws
}

/// Toggles launch-at-login and reports the resulting state. On a thrown
/// enable/disable it leaves the state as the service reports (no optimistic flip),
/// so the UI stays truthful.
public final class LoginItemController {
  private let service: LoginItemService
  public init(service: LoginItemService) { self.service = service }

  public var isEnabled: Bool { service.isEnabled }

  @discardableResult
  public func toggle() -> Bool {
    do {
      if service.isEnabled { try service.disable() } else { try service.enable() }
    } catch {
      // Leave the state as the service reports it; return the real status below.
    }
    return service.isEnabled
  }
}
```

- [ ] **Step 4: Run it, expect PASS (5 tests)**

Run: `swift test --filter LoginItemControllerTests`. Then `swift build` (clean).

- [ ] **Step 5: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/mac-shell/Sources/FairyShell/LoginItem.swift \
        packages/mac-shell/Tests/FairyShellTests/LoginItemControllerTests.swift
git commit -F - <<'MSG'
feat(mac-shell): LoginItemController — tested launch-at-login toggle logic

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 2: Add the Sparkle SPM dependency + derisk resolution (Package.swift)

**Files:**
- Modify: `packages/mac-shell/Package.swift`

- [ ] **Step 1: Add Sparkle to the manifest**

Replace `packages/mac-shell/Package.swift` with (adds the `dependencies:` array + the `Sparkle` product on the `fairy-shell` exe target; leaves `FairyShell`/tests unchanged):

```swift
// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "fairy-shell",
  platforms: [.macOS(.v13)],
  dependencies: [
    .package(url: "https://github.com/sparkle-project/Sparkle", from: "2.6.0"),
  ],
  targets: [
    .target(name: "FairyShell", swiftSettings: [.swiftLanguageMode(.v5)]),
    .executableTarget(
      name: "fairy-shell",
      dependencies: ["FairyShell", .product(name: "Sparkle", package: "Sparkle")],
      resources: [.copy("Resources/panel")],
      swiftSettings: [.swiftLanguageMode(.v5)]
    ),
    .testTarget(name: "FairyShellTests", dependencies: ["FairyShell"], swiftSettings: [.swiftLanguageMode(.v5)]),
  ]
)
```

- [ ] **Step 2: Resolve + build (the derisk gate)**

Run from `packages/mac-shell/`:
```bash
swift package resolve 2>&1 | tail -5
swift build 2>&1 | tail -5
```
Expected: SPM fetches Sparkle and `swift build` succeeds (nothing imports Sparkle yet, so it just links). The library tests are unaffected: `swift test 2>&1 | grep -E "Executed [0-9]+ tests" | tail -1`.

**If `swift package resolve`/`swift build` cannot fetch Sparkle** (no network in this environment): report the exact error and STOP — do not fake it. The controller from Task 1 stands on its own; Tasks 4 & 6 (which `import Sparkle`) and this dependency must then be build-verified on a networked machine. The controller (Task 1, Task 3) and Info.plist (Task 5) remain valid. Note this in the report so the controller can decide whether to proceed or split the Sparkle parts out.

- [ ] **Step 3: Commit** (the manifest + the resolved `Package.resolved`)

```bash
cd /Users/julianshen/prj/fAIry
git add packages/mac-shell/Package.swift packages/mac-shell/Package.resolved
git commit -F - <<'MSG'
build(mac-shell): add the Sparkle SPM dependency

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 3: `SMAppServiceLoginItem` — the real login-item service (glue)

**Files:**
- Create: `packages/mac-shell/Sources/fairy-shell/SMAppServiceLoginItem.swift`

Glue (coverage-excluded) — only functions from a signed `.app`.

- [ ] **Step 1: Implement `SMAppServiceLoginItem.swift`**

```swift
import Foundation
import ServiceManagement
import FairyShell

/// Real launch-at-login via `SMAppService.mainApp` (macOS 13+). Only functions
/// from a signed `.app`; under `swift run` (no bundle identity) `register()` throws,
/// which `LoginItemController.toggle()` swallows so the menu stays truthful.
struct SMAppServiceLoginItem: LoginItemService {
  var isEnabled: Bool { SMAppService.mainApp.status == .enabled }
  func enable() throws { try SMAppService.mainApp.register() }
  func disable() throws { try SMAppService.mainApp.unregister() }
}
```

- [ ] **Step 2: Build**

Run from `packages/mac-shell/`: `swift build` (PASS — compiles against `ServiceManagement`).

- [ ] **Step 3: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/mac-shell/Sources/fairy-shell/SMAppServiceLoginItem.swift
git commit -F - <<'MSG'
feat(mac-shell): SMAppServiceLoginItem — real launch-at-login via SMAppService

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 4: `UpdateController` — wrap Sparkle's updater (glue)

**Files:**
- Create: `packages/mac-shell/Sources/fairy-shell/UpdateController.swift`

Glue — depends on Task 2 (Sparkle resolvable). Functions only from a signed app + a live appcast (5c).

- [ ] **Step 1: Implement `UpdateController.swift`**

```swift
import AppKit
import Sparkle

/// Wraps Sparkle's standard updater controller, which creates the updater, starts
/// background checks (per `SUEnableAutomaticChecks`), and provides the standard
/// update UI. Reads `SUFeedURL`/`SUPublicEDKey` from the app's Info.plist.
@MainActor
final class UpdateController {
  private let controller: SPUStandardUpdaterController

  init() {
    controller = SPUStandardUpdaterController(
      startingUpdater: true,
      updaterDelegate: nil,
      userDriverDelegate: nil
    )
  }

  /// Trigger a user-initiated update check (the "Check for Updates…" menu item).
  func checkForUpdates() {
    controller.checkForUpdates(nil)
  }
}
```

- [ ] **Step 2: Build**

Run from `packages/mac-shell/`: `swift build` (PASS — compiles against Sparkle).

- [ ] **Step 3: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/mac-shell/Sources/fairy-shell/UpdateController.swift
git commit -F - <<'MSG'
feat(mac-shell): UpdateController — wrap Sparkle's standard updater

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 5: Sparkle Info.plist keys (placeholders)

**Files:**
- Modify: `packages/mac-shell/scripts/Info.plist`

- [ ] **Step 1: Add the Sparkle keys**

In `packages/mac-shell/scripts/Info.plist`, insert these lines immediately before the closing `</dict>` (the `SUFeedURL`/`SUPublicEDKey` values are deliberate placeholders filled in 5c):

```xml
  <!-- Sparkle auto-update (M5-5b wiring). SUFeedURL/SUPublicEDKey are placeholders
       filled in M5-5c from the EdDSA keypair + release host. -->
  <key>SUFeedURL</key><string>https://EXAMPLE-REPLACE-IN-5C.invalid/appcast.xml</string>
  <key>SUPublicEDKey</key><string>REPLACE-WITH-EDDSA-PUBLIC-KEY-IN-5C</string>
  <key>SUEnableAutomaticChecks</key><true/>
```

- [ ] **Step 2: Verify it still lints**

```bash
sed 's/@VERSION@/0.1.0/g' packages/mac-shell/scripts/Info.plist | plutil -lint -
```
Expected: `OK` (reads from stdin after substituting the version placeholder).

- [ ] **Step 3: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/mac-shell/scripts/Info.plist
git commit -F - <<'MSG'
build(mac-shell): Sparkle Info.plist keys (feed/key placeholders for 5c)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 6: Wire `AppDelegate` — the two menu items (glue)

**Files:**
- Modify: `packages/mac-shell/Sources/fairy-shell/AppDelegate.swift`

- [ ] **Step 1: Add stored properties**

Find the stored property `private var panelWindow: PanelWindowController!` and insert directly after it:

```swift
  private let loginItem = LoginItemController(service: SMAppServiceLoginItem())
  private var loginMenuItem: NSMenuItem?
  private var updateController: UpdateController!
```

- [ ] **Step 2: Construct the updater at launch**

In `applicationDidFinishLaunching`, find `panelWindow = PanelWindowController(baseURL: baseURL, tokenURL: tokenURL)` and insert directly after it:

```swift
    updateController = UpdateController()
```

- [ ] **Step 3: Add the menu items**

In `buildMenu()`, find this block (the Settings item + its trailing separator):

```swift
    let settings = NSMenuItem(title: "Settings…", action: #selector(openSettings), keyEquivalent: ",")
    settings.target = self
    menu.addItem(settings)
    menu.addItem(.separator())
```

and insert directly AFTER it:

```swift
    let updates = NSMenuItem(title: "Check for Updates…", action: #selector(checkForUpdates), keyEquivalent: "")
    updates.target = self
    menu.addItem(updates)
    let login = NSMenuItem(title: "Launch at login", action: #selector(toggleLoginItem), keyEquivalent: "")
    login.target = self
    loginMenuItem = login
    menu.addItem(login)
    menu.addItem(.separator())
```

- [ ] **Step 4: Add the actions + the checkmark refresh**

Find the actions block:

```swift
  @objc private func openSettings() { settingsWindow.show() }
  @objc private func openPanel() { panelWindow.show() }
```

and insert directly after it:

```swift
  @objc private func checkForUpdates() { updateController.checkForUpdates() }
  @objc private func toggleLoginItem() { loginItem.toggle(); refreshLoginItem() }

  private func refreshLoginItem() {
    loginMenuItem?.state = loginItem.isEnabled ? .on : .off
  }
```

Then find `menuWillOpen` and add the login refresh next to the pairing refresh:

```swift
  func menuWillOpen(_ menu: NSMenu) {
    refreshPairing()
    refreshLoginItem()
  }
```

- [ ] **Step 5: Build + full suite**

Run from `packages/mac-shell/`: `swift build` (PASS — compiles with Sparkle + ServiceManagement + the menu). `swift test 2>&1 | grep -E "Executed [0-9]+ tests" | tail -1` — the full suite (prior total + the 5 new `LoginItemController` tests), 0 failures.

- [ ] **Step 6: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/mac-shell/Sources/fairy-shell/AppDelegate.swift
git commit -F - <<'MSG'
feat(mac-shell): Launch-at-login toggle + Check for Updates menu items

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 7: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full suite + coverage**

Run from `packages/mac-shell/`:
```bash
swift build 2>&1 | tail -1
swift test --enable-code-coverage 2>&1 | grep -E "Executed [0-9]+ tests" | tail -1
```
Expected: build clean; all tests pass (prior total + 5 new).

- [ ] **Step 2: Confirm FairyShell coverage ≥90%**

```bash
BIN=$(swift build --show-bin-path)
xcrun llvm-cov report \
  "$BIN/fairy-shellPackageTests.xctest/Contents/MacOS/fairy-shellPackageTests" \
  -instr-profile "$BIN/codecov/default.profdata" \
  Sources/FairyShell 2>/dev/null | grep -E "LoginItem|TOTAL" | sed 's|.*/Sources/FairyShell/||'
```
Expected: `LoginItem.swift` at 100% lines; TOTAL ≥90%. (`SMAppServiceLoginItem`/`UpdateController` live under `Sources/fairy-shell/` — glue, excluded.)

- [ ] **Step 3: Record the 5c / manual-smoke boundary (no commit)**

Note in the PR description: 5b is build-verified + the toggle logic is unit-tested, but the *functional* behavior is a 5c manual smoke on a signed build — `SMAppService.register()` and Sparkle's updater both require a signed `.app`, and `package.sh` does not yet embed `Sparkle.framework` (that pairs with code-signing in 5c). So the assembled `.app` links Sparkle but won't launch until 5c embeds the framework + signs.

---

## Self-Review

**1. Spec coverage.**
- Tested `LoginItemController` toggle logic over an injected service → Task 1.
- Sparkle SPM dependency (resolution derisked) → Task 2.
- `SMAppServiceLoginItem` real service (glue) → Task 3; `UpdateController` wrapping `SPUStandardUpdaterController` (glue) → Task 4.
- `SUFeedURL`/`SUPublicEDKey`/`SUEnableAutomaticChecks` placeholders → Task 5.
- "Launch at login" toggle (checkmark, refresh on open) + "Check for Updates…" menu items + owning the controllers → Task 6.
- ≥90% on FairyShell; glue excluded → Task 7; the build-verified / functional-is-5c-manual-smoke boundary → Task 7 step 3.
- Explicitly out of scope (→5c): `package.sh` framework embedding + signing/notarize/DMG/appcast — stated in the header + Task 7 step 3, no task.
  No 5b spec requirement is left without a task.

**2. Placeholder scan.** Every code step shows complete Swift/XML (full file bodies; exact `Package.swift`/`Info.plist`/`AppDelegate` edits). The Info.plist `SUFeedURL`/`SUPublicEDKey` values are *intentional, documented* placeholders (the feature design), not plan gaps. The one environment-dependent step (Task 2's Sparkle fetch) has an explicit "if it can't fetch, report + stop" branch. No "TBD"/"add validation"/"similar to Task N".

**3. Type consistency.** `LoginItemService` (protocol: `isEnabled`/`enable()`/`disable()`, Task 1) is implemented by `FakeLoginItemService` (Task 1 test) and `SMAppServiceLoginItem` (Task 3), and consumed by `LoginItemController(service:)` (Task 1) which `AppDelegate` constructs with `SMAppServiceLoginItem()` (Task 6 step 1). `LoginItemController.toggle()`/`isEnabled` (Task 1) match the `AppDelegate` calls (`loginItem.toggle()`, `loginItem.isEnabled`, Task 6). `UpdateController()`/`checkForUpdates()` (Task 4) match the `AppDelegate` construction + `@objc checkForUpdates` (Task 6). The selectors `#selector(checkForUpdates)`/`#selector(toggleLoginItem)` (Task 6 step 3) match the `@objc` methods (step 4). The Sparkle product name `Sparkle` (Task 2) matches `import Sparkle` (Task 4).
