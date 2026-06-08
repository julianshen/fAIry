# macOS shell — tray + daemon lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A menu-bar macOS app (`packages/mac-shell`, SPM) that spawns/adopts the Bun daemon, monitors its health via `GET /status`, reflects running/starting/failed in the menu, and stops it on Quit.

**Architecture:** A tested `FairyShell` library (a `DaemonController` state machine with injected `DaemonLauncher`/`StatusProbing`/clock; a `StatusClient` over an injected `HTTPTransport`) + a thin coverage-excluded `fairy-shell` executable (AppKit `NSStatusItem` + the real `Process`/`URLSession` impls). `swift test` gates the library; AppKit/Process/URLSession glue lives only in the executable.

**Tech Stack:** Swift 6 toolchain, SPM (`swift-tools-version: 6.0`, **Swift language mode 5** to avoid strict-concurrency churn in this first slice), XCTest, AppKit (executable only). Target macOS 13+.

**Spec:** `docs/superpowers/specs/2026-06-08-mac-shell-tray-lifecycle-design.md`.

---

## File structure

```
packages/mac-shell/
  Package.swift
  Sources/FairyShell/            # library — TESTED (≥90%)
    Models.swift                 # DaemonHealth, DaemonState, DaemonLaunchConfig
    HTTPTransport.swift          # protocol (real impl is in the exe)
    StatusClient.swift           # token.json + GET /status (transport injected)
    DaemonLauncher.swift         # protocol (real impl is in the exe)
    DaemonController.swift       # the state machine (DI'd)
  Sources/fairy-shell/           # executable — GLUE (coverage-excluded)
    main.swift
    AppDelegate.swift            # NSApplication accessory + NSStatusItem + menu
    ProcessDaemonLauncher.swift  # real DaemonLauncher (Foundation Process)
    URLSessionTransport.swift    # real HTTPTransport (URLSession)
  Tests/FairyShellTests/
    StatusClientTests.swift
    DaemonControllerTests.swift
```

Confirmed facts: `token.json` = `{"token":"<base64url>"}` under the app-data dir; `GET /status` → 200 `{"status":"ok"}`, **bearer-authenticated**; dev daemon launch = `bun run src/main.ts` in `packages/pi-daemon`; app-data dir = `~/Library/Application Support/<APP_DIR>/` (the daemon's `resolvePaths` macOS branch). Run all `swift` commands from `packages/mac-shell/`. Commit trailer MUST be exactly:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
NOTE: XCTest test method names must start with `test`; avoid a global function named `add` (collides with `XCTestCase.add(_:)`).

---

### Task 1: Package skeleton + `StatusClient`

**Files:**
- Create: `packages/mac-shell/Package.swift`
- Create: `packages/mac-shell/Sources/FairyShell/Models.swift`
- Create: `packages/mac-shell/Sources/FairyShell/HTTPTransport.swift`
- Create: `packages/mac-shell/Sources/FairyShell/StatusClient.swift`
- Test: `packages/mac-shell/Tests/FairyShellTests/StatusClientTests.swift`

- [ ] **Step 1: `Package.swift` (library + tests only; the executable is added in Task 3)**

```swift
// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "fairy-shell",
  platforms: [.macOS(.v13)],
  targets: [
    .target(name: "FairyShell", swiftSettings: [.swiftLanguageMode(.v5)]),
    .testTarget(name: "FairyShellTests", dependencies: ["FairyShell"], swiftSettings: [.swiftLanguageMode(.v5)]),
  ]
)
```

- [ ] **Step 2: Write the failing test `StatusClientTests.swift`**

```swift
import XCTest
@testable import FairyShell

/// A transport that returns a canned (status, body) or nil (connection error).
final class FakeTransport: HTTPTransport {
  var result: (status: Int, body: Data)?
  var lastURL: URL?
  var lastBearer: String?
  init(_ result: (status: Int, body: Data)?) { self.result = result }
  func get(_ url: URL, bearer: String) async -> (status: Int, body: Data)? {
    lastURL = url; lastBearer = bearer; return result
  }
}

final class StatusClientTests: XCTestCase {
  private func tokenFile(_ contents: String?) -> URL {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let f = dir.appendingPathComponent("token.json")
    if let c = contents { try? c.write(to: f, atomically: true, encoding: .utf8) }
    return f
  }

  func testHealthyWithBearerFromToken() async {
    let transport = FakeTransport((status: 200, body: Data("{\"status\":\"ok\"}".utf8)))
    let client = StatusClient(
      baseURL: URL(string: "http://127.0.0.1:51789")!,
      tokenURL: tokenFile("{\"token\":\"abc123\"}"),
      transport: transport
    )
    let health = await client.probe()
    XCTAssertEqual(health, .healthy)
    XCTAssertEqual(transport.lastBearer, "abc123")
    XCTAssertEqual(transport.lastURL?.absoluteString, "http://127.0.0.1:51789/status")
  }

  func testUnauthorizedOn401() async {
    let client = StatusClient(baseURL: URL(string: "http://127.0.0.1:51789")!,
                              tokenURL: tokenFile("{\"token\":\"abc\"}"),
                              transport: FakeTransport((status: 401, body: Data())))
    let health = await client.probe()
    XCTAssertEqual(health, .unauthorized)
  }

  func testUnreachableOnConnectionError() async {
    let client = StatusClient(baseURL: URL(string: "http://127.0.0.1:51789")!,
                              tokenURL: tokenFile("{\"token\":\"abc\"}"),
                              transport: FakeTransport(nil))
    let health = await client.probe()
    XCTAssertEqual(health, .unreachable)
  }

  func testUnreachableWhenTokenMissing() async {
    let client = StatusClient(baseURL: URL(string: "http://127.0.0.1:51789")!,
                              tokenURL: tokenFile(nil), // no token.json yet (daemon still starting)
                              transport: FakeTransport((status: 200, body: Data())))
    let health = await client.probe()
    XCTAssertEqual(health, .unreachable)
  }
}
```

- [ ] **Step 3: Run it, expect FAIL**

Run: `cd packages/mac-shell && swift test --filter StatusClientTests`
Expected: FAIL — `StatusClient`/`HTTPTransport`/`DaemonHealth` don't exist (compile error).

- [ ] **Step 4: Implement `Models.swift`**

```swift
import Foundation

/// The result of a single health probe of the daemon's `GET /status`.
public enum DaemonHealth: Equatable, Sendable {
  case healthy        // 200
  case unauthorized   // 401 — token mismatch (stale token vs a different daemon)
  case unreachable    // connection refused, no token yet, or any other status
}

/// The shell's view of the daemon process lifecycle.
public enum DaemonState: Equatable, Sendable {
  case stopped
  case starting
  case running
  case failed(String)
}

/// How to launch the daemon in dev (a shipped bundled binary is M6).
public struct DaemonLaunchConfig: Sendable {
  public let executable: String        // e.g. "bun" (resolved on PATH) or an absolute path
  public let arguments: [String]       // e.g. ["run", "src/main.ts"]
  public let workdir: URL              // e.g. <repo>/packages/pi-daemon
  public let environment: [String: String]
  public init(executable: String, arguments: [String], workdir: URL, environment: [String: String] = [:]) {
    self.executable = executable; self.arguments = arguments; self.workdir = workdir; self.environment = environment
  }
}
```

- [ ] **Step 5: Implement `HTTPTransport.swift`**

```swift
import Foundation

/// Minimal GET seam so StatusClient is testable without real networking.
/// Returns (HTTP status, body) or nil on a connection-level error.
public protocol HTTPTransport: Sendable {
  func get(_ url: URL, bearer: String) async -> (status: Int, body: Data)?
}
```

- [ ] **Step 6: Implement `StatusClient.swift`**

```swift
import Foundation

/// Probes the daemon's bearer-authenticated `GET /status`, reading the shell
/// token the daemon writes to `token.json`. Pure logic — the transport + token
/// path are injected; the real URLSession transport lives in the executable.
public protocol StatusProbing: Sendable {
  func probe() async -> DaemonHealth
}

public struct StatusClient: StatusProbing {
  private let statusURL: URL
  private let tokenURL: URL
  private let transport: HTTPTransport

  public init(baseURL: URL, tokenURL: URL, transport: HTTPTransport) {
    self.statusURL = baseURL.appendingPathComponent("status")
    self.tokenURL = tokenURL
    self.transport = transport
  }

  public func probe() async -> DaemonHealth {
    guard let token = readToken() else { return .unreachable } // daemon not up yet
    guard let (status, _) = await transport.get(statusURL, bearer: token) else { return .unreachable }
    switch status {
    case 200: return .healthy
    case 401: return .unauthorized
    default: return .unreachable
    }
  }

  private func readToken() -> String? {
    guard let data = try? Data(contentsOf: tokenURL) else { return nil }
    struct TokenFile: Decodable { let token: String }
    let parsed = try? JSONDecoder().decode(TokenFile.self, from: data)
    let token = parsed?.token
    return (token?.isEmpty == false) ? token : nil
  }
}
```

- [ ] **Step 7: Run it, expect PASS**

Run: `swift test --filter StatusClientTests`
Expected: PASS (4 tests).

- [ ] **Step 8: Build + commit**

Run: `swift build` (PASS). Then:
```bash
cd /Users/julianshen/prj/fAIry
git add packages/mac-shell/Package.swift packages/mac-shell/Sources/FairyShell/Models.swift packages/mac-shell/Sources/FairyShell/HTTPTransport.swift packages/mac-shell/Sources/FairyShell/StatusClient.swift packages/mac-shell/Tests/FairyShellTests/StatusClientTests.swift
git commit -F - <<'MSG'
feat(mac-shell): SPM skeleton + StatusClient (token.json + GET /status)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 2: `DaemonController` state machine

**Files:**
- Create: `packages/mac-shell/Sources/FairyShell/DaemonLauncher.swift`
- Create: `packages/mac-shell/Sources/FairyShell/DaemonController.swift`
- Test: `packages/mac-shell/Tests/FairyShellTests/DaemonControllerTests.swift`

- [ ] **Step 1: Write the failing test `DaemonControllerTests.swift`**

```swift
import XCTest
@testable import FairyShell

final class FakeLauncher: DaemonLauncher {
  private(set) var launchCount = 0
  private(set) var terminateCount = 0
  var throwOnLaunch = false
  private var onExit: (() -> Void)?
  func launch(_ config: DaemonLaunchConfig, onExit: @escaping () -> Void) throws {
    if throwOnLaunch { throw NSError(domain: "test", code: 1) }
    launchCount += 1; self.onExit = onExit
  }
  func terminate() { terminateCount += 1 }
  func simulateExit() { onExit?() }
}

final class FakeStatus: StatusProbing {
  private var queue: [DaemonHealth]
  init(_ healths: [DaemonHealth]) { queue = healths }
  func probe() async -> DaemonHealth { queue.count > 1 ? queue.removeFirst() : (queue.first ?? .unreachable) }
}

private func makeConfig() -> DaemonLaunchConfig {
  DaemonLaunchConfig(executable: "bun", arguments: ["run", "src/main.ts"], workdir: URL(fileURLWithPath: "/tmp"))
}

final class DaemonControllerTests: XCTestCase {
  func testAdoptsAlreadyHealthyDaemonWithoutLaunching() async {
    let launcher = FakeLauncher()
    let c = DaemonController(launcher: launcher, status: FakeStatus([.healthy]), config: makeConfig(),
                            maxStartupPolls: 5, sleep: { _ in })
    var states: [DaemonState] = []; c.onState = { states.append($0) }
    await c.start()
    XCTAssertEqual(c.state, .running)
    XCTAssertEqual(launcher.launchCount, 0) // adopted, not spawned
  }

  func testSpawnsThenRunsOnFirstHealthyPoll() async {
    let launcher = FakeLauncher()
    let c = DaemonController(launcher: launcher, status: FakeStatus([.unreachable, .unreachable, .healthy]),
                            config: makeConfig(), maxStartupPolls: 5, sleep: { _ in })
    await c.start()
    XCTAssertEqual(c.state, .running)
    XCTAssertEqual(launcher.launchCount, 1)
  }

  func testFailsWhenLaunchThrows() async {
    let launcher = FakeLauncher(); launcher.throwOnLaunch = true
    let c = DaemonController(launcher: launcher, status: FakeStatus([.unreachable]), config: makeConfig(),
                            maxStartupPolls: 5, sleep: { _ in })
    await c.start()
    if case .failed = c.state {} else { XCTFail("expected .failed, got \(c.state)") }
  }

  func testFailsWhenNeverHealthy() async {
    let c = DaemonController(launcher: FakeLauncher(), status: FakeStatus([.unreachable]), config: makeConfig(),
                            maxStartupPolls: 3, sleep: { _ in })
    await c.start()
    if case .failed = c.state {} else { XCTFail("expected .failed") }
  }

  func testUnauthorizedFailsFast() async {
    let c = DaemonController(launcher: FakeLauncher(), status: FakeStatus([.unreachable, .unauthorized]),
                            config: makeConfig(), maxStartupPolls: 10, sleep: { _ in })
    await c.start()
    if case .failed = c.state {} else { XCTFail("expected .failed") }
  }

  func testUnexpectedExitFails() async {
    let launcher = FakeLauncher()
    let c = DaemonController(launcher: launcher, status: FakeStatus([.healthy]), config: makeConfig(),
                            maxStartupPolls: 5, sleep: { _ in })
    await c.start() // adopted → running (no launch); launch one so there's a handle to exit
    // simulate a spawned-then-running daemon exiting:
    let c2 = DaemonController(launcher: launcher, status: FakeStatus([.unreachable, .healthy]),
                             config: makeConfig(), maxStartupPolls: 5, sleep: { _ in })
    await c2.start()
    launcher.simulateExit()
    if case .failed = c2.state {} else { XCTFail("expected .failed after exit, got \(c2.state)") }
  }

  func testStopTerminatesSpawnedAndGoesStopped() async {
    let launcher = FakeLauncher()
    let c = DaemonController(launcher: launcher, status: FakeStatus([.unreachable, .healthy]),
                            config: makeConfig(), maxStartupPolls: 5, sleep: { _ in })
    await c.start()
    c.stop()
    XCTAssertEqual(c.state, .stopped)
    XCTAssertEqual(launcher.terminateCount, 1)
  }

  func testStopLeavesAdoptedDaemonRunning() async {
    let launcher = FakeLauncher()
    let c = DaemonController(launcher: launcher, status: FakeStatus([.healthy]), config: makeConfig(),
                            maxStartupPolls: 5, sleep: { _ in })
    await c.start() // adopted
    c.stop()
    XCTAssertEqual(c.state, .stopped)
    XCTAssertEqual(launcher.terminateCount, 0) // we didn't spawn it, so we don't kill it
  }
}
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `swift test --filter DaemonControllerTests`
Expected: FAIL — `DaemonLauncher`/`DaemonController` don't exist.

- [ ] **Step 3: Implement `DaemonLauncher.swift`**

```swift
import Foundation

/// Starts/stops the daemon child process. The real impl (Foundation Process)
/// lives in the executable; tests inject a fake.
public protocol DaemonLauncher: AnyObject {
  /// Launch the daemon. `onExit` fires if the process terminates on its own.
  func launch(_ config: DaemonLaunchConfig, onExit: @escaping () -> Void) throws
  /// Terminate a daemon we launched.
  func terminate()
}
```

- [ ] **Step 4: Implement `DaemonController.swift`**

```swift
import Foundation

/// Brings the daemon up (adopting an already-healthy one, else spawning) and
/// tracks its health, exposing a DaemonState the menu reflects. All I/O is
/// injected (launcher, status probe, sleep) so the state machine is unit-tested.
public final class DaemonController {
  private let launcher: DaemonLauncher
  private let status: StatusProbing
  private let config: DaemonLaunchConfig
  private let maxStartupPolls: Int
  private let sleep: (Int) async -> Void
  private let pollIntervalMs: Int

  /// True only when we spawned the daemon (so stop() should terminate it).
  private var spawned = false
  /// Set during an intentional stop so an exit callback isn't treated as a failure.
  private var stopping = false

  public private(set) var state: DaemonState = .stopped {
    didSet { if state != oldValue { onState?(state) } }
  }
  public var onState: ((DaemonState) -> Void)?

  public init(
    launcher: DaemonLauncher,
    status: StatusProbing,
    config: DaemonLaunchConfig,
    pollIntervalMs: Int = 300,
    maxStartupPolls: Int = 30,
    sleep: @escaping (Int) async -> Void = { ms in try? await Task.sleep(nanoseconds: UInt64(ms) * 1_000_000) }
  ) {
    self.launcher = launcher; self.status = status; self.config = config
    self.pollIntervalMs = pollIntervalMs; self.maxStartupPolls = maxStartupPolls; self.sleep = sleep
  }

  public func start() async {
    stopping = false
    // Adopt an already-running daemon rather than fight its single-instance lock.
    if await status.probe() == .healthy { spawned = false; state = .running; return }
    state = .starting
    do {
      try launcher.launch(config) { [weak self] in self?.handleExit() }
      spawned = true
    } catch {
      state = .failed("could not start the daemon: \(error.localizedDescription)")
      return
    }
    for _ in 0..<maxStartupPolls {
      await sleep(pollIntervalMs)
      if case .stopped = state { return } // stop() was called mid-startup
      switch await status.probe() {
      case .healthy: state = .running; return
      case .unauthorized: state = .failed("daemon rejected the shell token"); return
      case .unreachable: continue
      }
    }
    state = .failed("daemon did not become healthy")
  }

  public func restart() async { stop(); await start() }

  public func stop() {
    stopping = true
    if spawned { launcher.terminate() }
    spawned = false
    state = .stopped
  }

  private func handleExit() {
    if stopping { return } // we asked for it
    if state == .running || state == .starting {
      state = .failed("daemon exited")
    }
  }
}
```

- [ ] **Step 5: Run it, expect PASS**

Run: `swift test --filter DaemonControllerTests`
Expected: PASS (8 tests). (If Swift 6 strict-concurrency warnings appear on the `onExit`/`sleep` closures, the package is in language mode 5 — they're warnings, not errors; the tests run.)

- [ ] **Step 6: Full test + coverage + commit**

Run: `swift test --enable-code-coverage` (all PASS). Check the FairyShell sources are well covered:
`xcrun llvm-cov report .build/debug/fairy-shellPackageTests.xctest/Contents/MacOS/fairy-shellPackageTests -instr-profile .build/debug/codecov/default.profdata Sources/FairyShell/ 2>/dev/null | tail -n +1`
Expected: `FairyShell` sources ≥90% lines (the controller + client are fully exercised). Then:
```bash
cd /Users/julianshen/prj/fAIry
git add packages/mac-shell/Sources/FairyShell/DaemonLauncher.swift packages/mac-shell/Sources/FairyShell/DaemonController.swift packages/mac-shell/Tests/FairyShellTests/DaemonControllerTests.swift
git commit -F - <<'MSG'
feat(mac-shell): DaemonController — adopt-or-spawn lifecycle state machine

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 3: Executable — AppKit tray + real launcher/transport

**Files:**
- Modify: `packages/mac-shell/Package.swift` (add the executable target)
- Create: `packages/mac-shell/Sources/fairy-shell/ProcessDaemonLauncher.swift`
- Create: `packages/mac-shell/Sources/fairy-shell/URLSessionTransport.swift`
- Create: `packages/mac-shell/Sources/fairy-shell/AppDelegate.swift`
- Create: `packages/mac-shell/Sources/fairy-shell/main.swift`

(This target is AppKit/Process/URLSession glue — built with `swift build`, runtime-verified by launching it; not unit-tested, like the extension's coverage-excluded `background.ts`.)

- [ ] **Step 1: Add the executable target to `Package.swift`**

Replace the `targets:` array so it includes the executable:
```swift
  targets: [
    .target(name: "FairyShell", swiftSettings: [.swiftLanguageMode(.v5)]),
    .executableTarget(name: "fairy-shell", dependencies: ["FairyShell"], swiftSettings: [.swiftLanguageMode(.v5)]),
    .testTarget(name: "FairyShellTests", dependencies: ["FairyShell"], swiftSettings: [.swiftLanguageMode(.v5)]),
  ]
```

- [ ] **Step 2: `ProcessDaemonLauncher.swift` (real DaemonLauncher)**

```swift
import Foundation
import FairyShell

/// Launches the daemon via Foundation Process. Resolves the executable on PATH
/// through /usr/bin/env so `bun` is found without an absolute path.
final class ProcessDaemonLauncher: DaemonLauncher {
  private var process: Process?

  func launch(_ config: DaemonLaunchConfig, onExit: @escaping () -> Void) throws {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    p.arguments = [config.executable] + config.arguments
    p.currentDirectoryURL = config.workdir
    p.environment = ProcessInfo.processInfo.environment.merging(config.environment) { _, new in new }
    p.terminationHandler = { _ in onExit() }
    try p.run()
    process = p
  }

  func terminate() {
    process?.terminationHandler = nil
    process?.terminate()
    process = nil
  }
}
```

- [ ] **Step 3: `URLSessionTransport.swift` (real HTTPTransport)**

```swift
import Foundation
import FairyShell

/// Real HTTP GET over URLSession (loopback). nil on a connection error.
struct URLSessionTransport: HTTPTransport {
  func get(_ url: URL, bearer: String) async -> (status: Int, body: Data)? {
    var req = URLRequest(url: url)
    req.httpMethod = "GET"
    req.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
    req.timeoutInterval = 2
    guard let (data, resp) = try? await URLSession.shared.data(for: req),
          let http = resp as? HTTPURLResponse else { return nil }
    return (http.statusCode, data)
  }
}
```

- [ ] **Step 4: `AppDelegate.swift` (tray + wiring)**

```swift
import AppKit
import FairyShell

final class AppDelegate: NSObject, NSApplicationDelegate {
  private var statusItem: NSStatusItem!
  private var controller: DaemonController!

  func applicationDidFinishLaunching(_ notification: Notification) {
    statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    let appData = FileManager.default.homeDirectoryForCurrentUser
      .appendingPathComponent("Library/Application Support/fairy") // matches the daemon's APP_DIR
    let repo = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
      .deletingLastPathComponent() // packages/ -> repo root (dev: run from packages/mac-shell)
    let config = DaemonLaunchConfig(
      executable: "bun", arguments: ["run", "src/main.ts"],
      workdir: repo.appendingPathComponent("pi-daemon")
    )
    let status = StatusClient(baseURL: URL(string: "http://127.0.0.1:51789")!,
                              tokenURL: appData.appendingPathComponent("token.json"),
                              transport: URLSessionTransport())
    controller = DaemonController(launcher: ProcessDaemonLauncher(), status: status, config: config)
    controller.onState = { [weak self] state in
      DispatchQueue.main.async { self?.render(state) }
    }
    render(.stopped)
    buildMenu()
    Task { await controller.start() }
  }

  private func render(_ state: DaemonState) {
    let (glyph, line): (String, String) = {
      switch state {
      case .stopped: return ("○", "Daemon: stopped")
      case .starting: return ("◌", "Daemon: starting…")
      case .running: return ("●", "Daemon: running")
      case .failed(let why): return ("⚠", "Daemon: failed — \(why)")
      }
    }()
    statusItem.button?.title = "🧚\(glyph)"
    statusMenuItem?.title = line
  }

  private var statusMenuItem: NSMenuItem?
  private func buildMenu() {
    let menu = NSMenu()
    let status = NSMenuItem(title: "Daemon: …", action: nil, keyEquivalent: "")
    status.isEnabled = false
    statusMenuItem = status
    menu.addItem(status)
    menu.addItem(.separator())
    menu.addItem(NSMenuItem(title: "Restart daemon", action: #selector(restart), keyEquivalent: ""))
    menu.addItem(.separator())
    menu.addItem(NSMenuItem(title: "Quit Fairy", action: #selector(quit), keyEquivalent: "q"))
    for item in menu.items where item.action != nil { item.target = self }
    statusItem.menu = menu
  }

  @objc private func restart() { Task { await controller.restart() } }
  @objc private func quit() { controller.stop(); NSApp.terminate(nil) }
}
```

- [ ] **Step 5: `main.swift`**

```swift
import AppKit

let app = NSApplication.shared
app.setActivationPolicy(.accessory) // menu-bar only, no Dock icon
let delegate = AppDelegate()
app.delegate = delegate
app.run()
```

- [ ] **Step 6: Build + smoke-run**

Run from `packages/mac-shell/`: `swift build` (PASS — the whole package compiles incl. the executable). Then `swift test` (the library tests still pass; the executable has no tests). Optionally launch it: `swift run fairy-shell` — a 🧚 menu-bar item appears; with the daemon launchable (bun on PATH + the repo present) it should go ● running; **Quit Fairy** stops it. (Manual/runtime check — the executable is glue.)

- [ ] **Step 7: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/mac-shell/Package.swift packages/mac-shell/Sources/fairy-shell/
git commit -F - <<'MSG'
feat(mac-shell): AppKit tray + real Process launcher / URLSession transport

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

## Self-Review

**1. Spec coverage.**
- SPM library/executable split → Task 1 (Package.swift) + Task 3 (executable target).
- `StatusClient`: `token.json` bearer + `GET /status`, transport injected; healthy/unauthorized/unreachable; missing token = not-ready → Task 1 (+ 4 tests).
- `DaemonController`: adopt-or-spawn, poll-to-running, spawn-fail/timeout/unauthorized/unexpected-exit → failed, restart, stop (terminate spawned / leave adopted) → Task 2 (+ 8 tests).
- AppKit tray (accessory, NSStatusItem icon+menu, Restart, Quit→stop+terminate), real `Process` launcher (env-resolved `bun`), real URLSession transport → Task 3.
- Dev launch = `bun run src/main.ts` in `pi-daemon` → Task 2/3 config.
- Coverage ≥90% on `FairyShell`; executable is glue (not unit-tested) → Task 2 step 6 + noted throughout.
  No spec requirement is left without a task.

**2. Placeholder scan.** Every step has complete Swift; tests are full with concrete assertions. The one runtime-only step (Task 3 step 6 smoke-run) is explicitly a manual glue check. No "TBD"/"add error handling"/"similar to Task N".

**3. Type consistency.** `DaemonHealth`/`DaemonState`/`DaemonLaunchConfig` (Task 1 Models) are used by `StatusClient` (Task 1), `DaemonController` (Task 2), and the executable (Task 3). `HTTPTransport.get(_:bearer:)` (Task 1) is implemented by `FakeTransport` (Task 1 test) and `URLSessionTransport` (Task 3). `StatusProbing.probe()` (Task 1) is implemented by `StatusClient` + `FakeStatus` (Task 2 test). `DaemonLauncher.launch(_:onExit:)`/`terminate()` (Task 2) is implemented by `FakeLauncher` (Task 2 test) + `ProcessDaemonLauncher` (Task 3). `DaemonController(launcher:status:config:pollIntervalMs:maxStartupPolls:sleep:)` + `start/restart/stop/onState/state` are consistent across Task 2's impl, its tests, and Task 3's `AppDelegate`.
