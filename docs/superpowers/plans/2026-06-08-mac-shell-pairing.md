# macOS shell — pairing surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The shell's menu shows the daemon's pairing code (from `pairing.json`) with a one-click copy, refreshed on menu-open.

**Architecture:** A tested `PairingReader` in the `FairyShell` library (reads/parses `pairing.json` → the code) + `AppDelegate` menu glue (a disabled display line + a Copy item → `NSPasteboard`, refreshed via `NSMenuDelegate.menuWillOpen`). Extends M5-1; no daemon change.

**Tech Stack:** Swift 6 / SPM (`FairyShell` lib + `fairy-shell` exe, language mode 5), XCTest, AppKit (executable only). Run `swift` from `packages/mac-shell/`.

**Spec:** `docs/superpowers/specs/2026-06-08-mac-shell-pairing-design.md`.

Confirmed: `pairing.json` = `{"code":"<single-use code>"}`, 0600, under the app-data dir (`~/Library/Application Support/fairy`). Commit trailer MUST be exactly:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 1: `PairingReader`

**Files:**
- Create: `packages/mac-shell/Sources/FairyShell/PairingReader.swift`
- Test: `packages/mac-shell/Tests/FairyShellTests/PairingReaderTests.swift`

- [ ] **Step 1: Write the failing test**

Create `packages/mac-shell/Tests/FairyShellTests/PairingReaderTests.swift`:

```swift
import XCTest
@testable import FairyShell

final class PairingReaderTests: XCTestCase {
  private func file(_ contents: String?) -> URL {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let f = dir.appendingPathComponent("pairing.json")
    if let c = contents { try? c.write(to: f, atomically: true, encoding: .utf8) }
    return f
  }

  func testReadsTheCode() {
    XCTAssertEqual(PairingReader.read(from: file("{\"code\":\"8F3K2A91\"}")), "8F3K2A91")
  }

  func testNilWhenFileMissing() {
    XCTAssertNil(PairingReader.read(from: file(nil)))
  }

  func testNilWhenMalformedJSON() {
    XCTAssertNil(PairingReader.read(from: file("not json")))
  }

  func testNilWhenCodeEmpty() {
    XCTAssertNil(PairingReader.read(from: file("{\"code\":\"\"}")))
  }

  func testNilWhenCodeAbsent() {
    XCTAssertNil(PairingReader.read(from: file("{}")))
  }
}
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `cd packages/mac-shell && swift test --filter PairingReaderTests`
Expected: FAIL — `PairingReader` doesn't exist (compile error).

- [ ] **Step 3: Implement `PairingReader.swift`**

```swift
import Foundation

/// Reads the daemon's single-use pairing code from `pairing.json`. Pure (the URL
/// is injected) so it's unit-tested; the menu + clipboard wiring is glue.
public enum PairingReader {
  /// The current pairing code (`{ "code": String }`), or nil if the file is
  /// missing/unreadable/malformed or the code is empty.
  public static func read(from url: URL) -> String? {
    guard let data = try? Data(contentsOf: url) else { return nil }
    struct PairingFile: Decodable { let code: String }
    let code = (try? JSONDecoder().decode(PairingFile.self, from: data))?.code
    return (code?.isEmpty == false) ? code : nil
  }
}
```

- [ ] **Step 4: Run it, expect PASS (5 tests)**

Run: `swift test --filter PairingReaderTests`

- [ ] **Step 5: Build + commit**

Run: `swift build` (PASS). Then:
```bash
cd /Users/julianshen/prj/fAIry
git add packages/mac-shell/Sources/FairyShell/PairingReader.swift packages/mac-shell/Tests/FairyShellTests/PairingReaderTests.swift
git commit -F - <<'MSG'
feat(mac-shell): PairingReader — read the pairing code from pairing.json

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 2: Surface the code + Copy in the menu

**Files:**
- Modify: `packages/mac-shell/Sources/fairy-shell/AppDelegate.swift`

(AppKit glue — runtime-verified by launching the app; the library tests must still pass.)

- [ ] **Step 1: Store the pairing.json URL + menu-item refs**

In `AppDelegate` (the `@MainActor final class`), add stored properties next to the existing `statusItem`/`statusMenuItem`/`controller`:
```swift
  private var pairingFileURL: URL!
  private var pairingMenuItem: NSMenuItem?
  private var copyPairingItem: NSMenuItem?
  private var pairingCode: String?
```

- [ ] **Step 2: Capture the pairing.json URL in `applicationDidFinishLaunching`**

In `applicationDidFinishLaunching`, where `appData` is computed (the `~/Library/Application Support/fairy` URL used for `token.json`), add right after it:
```swift
    pairingFileURL = appData.appendingPathComponent("pairing.json")
```

- [ ] **Step 3: Add the pairing items + delegate in `buildMenu()`**

In `buildMenu()`, set manual enablement and become the delegate, and insert the pairing items between the daemon-status section and the Restart item. Replace the body of `buildMenu()` with:
```swift
  private func buildMenu() {
    let menu = NSMenu()
    menu.autoenablesItems = false // we manage enablement (Copy toggles with the code)
    menu.delegate = self

    let status = NSMenuItem(title: "Daemon: …", action: nil, keyEquivalent: "")
    status.isEnabled = false
    statusMenuItem = status
    menu.addItem(status)
    menu.addItem(.separator())

    let pairing = NSMenuItem(title: "Pairing code: …", action: nil, keyEquivalent: "")
    pairing.isEnabled = false
    pairingMenuItem = pairing
    menu.addItem(pairing)
    let copy = NSMenuItem(title: "Copy pairing code", action: #selector(copyPairingCode), keyEquivalent: "")
    copy.target = self
    copy.isEnabled = false
    copyPairingItem = copy
    menu.addItem(copy)
    menu.addItem(.separator())

    let restart = NSMenuItem(title: "Restart daemon", action: #selector(restart), keyEquivalent: "")
    restart.target = self
    menu.addItem(restart)
    menu.addItem(.separator())

    let quit = NSMenuItem(title: "Quit Fairy", action: #selector(quit), keyEquivalent: "q")
    quit.target = self
    menu.addItem(quit)

    statusItem.menu = menu
    refreshPairing()
  }
```
(Note: with `autoenablesItems = false`, every actionable item needs `target = self` + `isEnabled = true` explicitly — set above for restart/quit; the status + pairing display lines stay disabled; Copy is toggled by `refreshPairing()`.)

- [ ] **Step 4: Add the refresh + copy logic + `NSMenuDelegate`**

Add the menu-delegate conformance and methods (place after `quit()`):
```swift
  func menuWillOpen(_ menu: NSMenu) {
    refreshPairing()
  }

  private func refreshPairing() {
    let code = PairingReader.read(from: pairingFileURL)
    pairingCode = code
    pairingMenuItem?.title = code.map { "Pairing code: \($0)" } ?? "Pairing code: (unavailable)"
    copyPairingItem?.isEnabled = (code != nil)
  }

  @objc private func copyPairingCode() {
    guard let code = pairingCode else { return }
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(code, forType: .string)
  }
```
And make the class conform to `NSMenuDelegate`: change the class declaration's conformance list to include it:
```swift
final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
```
(keep the existing `@MainActor` on the line above; `NSMenuDelegate.menuWillOpen` is main-actor-safe here).

- [ ] **Step 5: Build + test + smoke**

Run from `packages/mac-shell/`: `swift build` (PASS — the executable compiles with the new menu + delegate). `swift test` (the library's tests — now 19 incl. the 5 new PairingReader — still pass). Do NOT launch the GUI in a headless run; the menu/clipboard is a human smoke check (`swift run fairy-shell`, open the menu, confirm the code shows + Copy puts it on the clipboard).

- [ ] **Step 6: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/mac-shell/Sources/fairy-shell/AppDelegate.swift
git commit -F - <<'MSG'
feat(mac-shell): show the pairing code + Copy in the menu (refresh on open)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

## Self-Review

**1. Spec coverage.**
- `PairingReader.read(from:)` → code or nil (missing/malformed/empty/absent) → Task 1 (+ 5 tests).
- Menu: disabled `Pairing code: <code>` display + enabled `Copy pairing code` → `NSPasteboard` → Task 2.
- Refresh on `menuWillOpen` (NSMenuDelegate) so the code is current across daemon restarts → Task 2 (steps 3–4).
- Unavailable state (no/unreadable/empty pairing.json) → "Pairing code: (unavailable)", Copy disabled → Task 2 `refreshPairing`.
- Read-only; no daemon change → both tasks (PairingReader only reads).
- `PairingReader` fully covered; menu/clipboard glue not unit-tested → noted (Task 2 is glue).
  No spec requirement is left without a task.

**2. Placeholder scan.** Complete Swift for both files; the full `buildMenu()` body is shown (not a diff fragment) to avoid ambiguity; tests are concrete. The one runtime-only step (Task 2 step 5 smoke) is explicitly a manual glue check. No "TBD"/"add validation"/"similar to Task N".

**3. Type consistency.** `PairingReader.read(from: URL) -> String?` (Task 1) is called by `refreshPairing()` (Task 2). `pairingFileURL`/`pairingMenuItem`/`copyPairingItem`/`pairingCode` (Task 2 step 1) are used consistently in steps 2–4. The `@objc copyPairingCode` selector matches the menu item's `action`. `NSMenuDelegate.menuWillOpen` is implemented after adding the conformance. The reused `appData` URL is the same one M5-1 uses for `token.json`.
