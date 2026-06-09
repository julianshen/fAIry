# macOS shell — conversation panel transport (M5-4a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The native shell can discover the conversation port (`GET /info`) and run a daemon conversation over a WebSocket — auth-first handshake, beat streaming, and `start`/`stop`/`resolveProposal` commands — with all protocol logic unit-tested behind an injectable socket seam.

**Architecture:** A tested pure core in the `FairyShell` library — `InfoClient` (`GET /info` → `DaemonInfo`, mirroring `SettingsClient`) and `ConversationClient` (the auth/queue/beat/command logic over an injected `ConversationSocket`) — plus a coverage-excluded `URLSessionConversationSocket` (the real WS). No WebView/UI yet; that's PR-4b.

**Tech Stack:** Swift 6 / SPM (language mode 5), XCTest, URLSession (`URLSessionWebSocketTask`, executable only). Run `swift` from `packages/mac-shell/`.

**Spec:** `docs/superpowers/specs/2026-06-09-mac-shell-panel-design.md` (this is PR-4a of two — the native transport; PR-4b adds the WebView host + agent-panel shell build + bridge + menu wiring).

Daemon contract (confirmed): `GET /info` (bearer) → `{ bridgePort, conversationPort }` (`packages/pi-daemon/src/daemon.ts:223`). Conversation WS at `ws://127.0.0.1:<conversationPort>`: first frame `{ type: "auth", token }`, then inbound `{ type: "beat", beat }`, outbound `{ type: "start", task }` / `{ type: "stop" }` / `{ type: "resolveProposal", proposal, accept }`. The daemon's `isAllowedOrigin` allows a missing Origin (a native `URLSessionWebSocketTask` sends none) — so the native client is accepted where a WebView (`"null"` origin) would be rejected.

Commit trailer MUST be EXACTLY (use `git commit -F -` heredoc — backticks in double-quoted bash get command-substituted):
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

Reuse note: `SettingsError` (`.unreachable/.unauthorized/.server(status:)/.decode`), `TokenReader`, `HTTPTransport`, and the test `FakeTransport` already exist from M5-1/M5-3. `InfoClient` reuses all of them.

---

### Task 1: `InfoClient` — `GET /info` → the conversation port

**Files:**
- Create: `packages/mac-shell/Sources/FairyShell/InfoModels.swift`
- Create: `packages/mac-shell/Sources/FairyShell/InfoClient.swift`
- Test: `packages/mac-shell/Tests/FairyShellTests/InfoClientTests.swift`

- [ ] **Step 1: Write the failing test**

Create `packages/mac-shell/Tests/FairyShellTests/InfoClientTests.swift`:

```swift
import XCTest
@testable import FairyShell

final class InfoClientTests: XCTestCase {
  private func tokenFile(_ contents: String?) -> URL {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let f = dir.appendingPathComponent("token.json")
    if let c = contents { try? c.write(to: f, atomically: true, encoding: .utf8) }
    return f
  }
  private func client(_ transport: FakeTransport, token: String? = "{\"token\":\"t\"}") -> InfoClient {
    InfoClient(baseURL: URL(string: "http://127.0.0.1:51789")!,
               tokenURL: tokenFile(token), transport: transport)
  }

  func testFetchDecodesPortsAndHitsInfoURL() async {
    let t = FakeTransport((status: 200, body: Data(#"{"bridgePort":111,"conversationPort":222}"#.utf8)))
    let result = await client(t).fetch()
    XCTAssertEqual(try? result.get(), DaemonInfo(bridgePort: 111, conversationPort: 222))
    XCTAssertEqual(t.lastURL?.absoluteString, "http://127.0.0.1:51789/info")
    XCTAssertEqual(t.lastBearer, "t")
  }
  func testUnauthorizedOn401() async {
    let r = await client(FakeTransport((status: 401, body: Data()))).fetch()
    XCTAssertEqual(r, .failure(.unauthorized))
  }
  func testServerOnOtherStatus() async {
    let r = await client(FakeTransport((status: 503, body: Data()))).fetch()
    XCTAssertEqual(r, .failure(.server(status: 503)))
  }
  func testUnreachableOnTransportNil() async {
    let r = await client(FakeTransport(nil)).fetch()
    XCTAssertEqual(r, .failure(.unreachable))
  }
  func testUnreachableWhenTokenMissing() async {
    let r = await client(FakeTransport((status: 200, body: Data())), token: nil).fetch()
    XCTAssertEqual(r, .failure(.unreachable))
  }
  func testDecodeErrorOnBadBody() async {
    let r = await client(FakeTransport((status: 200, body: Data("nope".utf8)))).fetch()
    XCTAssertEqual(r, .failure(.decode))
  }
}
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `cd packages/mac-shell && swift test --filter InfoClientTests`
Expected: FAIL — `DaemonInfo`/`InfoClient` don't exist (compile error).

- [ ] **Step 3: Implement `InfoModels.swift`**

```swift
import Foundation

/// The daemon's connection info from `GET /info`: the ephemeral WS ports.
public struct DaemonInfo: Decodable, Equatable, Sendable {
  public let bridgePort: Int
  public let conversationPort: Int
  public init(bridgePort: Int, conversationPort: Int) {
    self.bridgePort = bridgePort; self.conversationPort = conversationPort
  }
}
```

- [ ] **Step 4: Implement `InfoClient.swift`**

```swift
import Foundation

/// Fetches the daemon's `GET /info` (bearer-authenticated) to discover the
/// ephemeral conversation/bridge WS ports. Mirrors `SettingsClient`: token read
/// via `TokenReader`, transport injected; reuses `SettingsError`.
public struct InfoClient: Sendable {
  private let infoURL: URL
  private let tokenURL: URL
  private let transport: HTTPTransport

  public init(baseURL: URL, tokenURL: URL, transport: HTTPTransport) {
    self.infoURL = baseURL.appendingPathComponent("info")
    self.tokenURL = tokenURL
    self.transport = transport
  }

  public func fetch() async -> Result<DaemonInfo, SettingsError> {
    guard let token = TokenReader.read(from: tokenURL) else { return .failure(.unreachable) }
    guard let (status, body) = await transport.get(infoURL, bearer: token) else { return .failure(.unreachable) }
    switch status {
    case 200:
      guard let info = try? JSONDecoder().decode(DaemonInfo.self, from: body) else { return .failure(.decode) }
      return .success(info)
    case 401: return .failure(.unauthorized)
    default: return .failure(.server(status: status))
    }
  }
}
```

- [ ] **Step 5: Run it, expect PASS (6 tests)**

Run: `swift test --filter InfoClientTests`. Then `swift build` (clean).

- [ ] **Step 6: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/mac-shell/Sources/FairyShell/InfoModels.swift \
        packages/mac-shell/Sources/FairyShell/InfoClient.swift \
        packages/mac-shell/Tests/FairyShellTests/InfoClientTests.swift
git commit -F - <<'MSG'
feat(mac-shell): InfoClient — GET /info to discover the conversation port

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 2: `ConversationClient` — auth/queue/beat/command logic

**Files:**
- Create: `packages/mac-shell/Sources/FairyShell/ConversationSocket.swift`
- Create: `packages/mac-shell/Sources/FairyShell/ConversationClient.swift`
- Test: `packages/mac-shell/Tests/FairyShellTests/ConversationClientTests.swift`

- [ ] **Step 1: Write the failing test**

Create `packages/mac-shell/Tests/FairyShellTests/ConversationClientTests.swift`:

```swift
import XCTest
@testable import FairyShell

/// A synchronous fake WS: records sent frames and lets the test drive open/text/close.
final class FakeConversationSocket: ConversationSocket {
  private var openH: (() -> Void)?
  private var textH: ((String) -> Void)?
  private var closeH: (() -> Void)?
  private(set) var sent: [String] = []
  private(set) var connected = false
  private(set) var closeCount = 0
  func onOpen(_ h: @escaping () -> Void) { openH = h }
  func onText(_ h: @escaping (String) -> Void) { textH = h }
  func onClose(_ h: @escaping () -> Void) { closeH = h }
  func connect() { connected = true }
  func send(_ text: String) { sent.append(text) }
  func close() { closeCount += 1 }
  func simulateOpen() { openH?() }
  func simulateText(_ t: String) { textH?(t) }
  func simulateClose() { closeH?() }
}

/// Parse a sent frame into a dictionary (key order is not guaranteed in JSON output).
private func parse(_ frame: String) -> [String: Any] {
  (try? JSONSerialization.jsonObject(with: Data(frame.utf8))) as? [String: Any] ?? [:]
}

final class ConversationClientTests: XCTestCase {
  private func make(_ socket: FakeConversationSocket, onBeat: @escaping (String) -> Void = { _ in })
    -> ConversationClient {
    ConversationClient(socket: socket, token: "tok", onBeat: onBeat)
  }

  func testAuthFrameSentFirstOnOpen() {
    let s = FakeConversationSocket(); let c = make(s); c.connect()
    XCTAssertTrue(s.connected)
    s.simulateOpen()
    XCTAssertEqual(parse(s.sent[0])["type"] as? String, "auth")
    XCTAssertEqual(parse(s.sent[0])["token"] as? String, "tok")
  }

  func testCommandsBeforeOpenAreQueuedThenFlushedAfterAuth() {
    let s = FakeConversationSocket(); let c = make(s); c.connect()
    c.start("hello")            // queued (not open yet)
    XCTAssertTrue(s.sent.isEmpty)
    s.simulateOpen()
    XCTAssertEqual(s.sent.count, 2)                       // auth, then start
    XCTAssertEqual(parse(s.sent[0])["type"] as? String, "auth")
    XCTAssertEqual(parse(s.sent[1])["type"] as? String, "start")
    XCTAssertEqual(parse(s.sent[1])["task"] as? String, "hello")
  }

  func testBeatFrameDeliversRawBeatJSON() {
    var beats: [String] = []
    let s = FakeConversationSocket(); let c = make(s) { beats.append($0) }; c.connect(); s.simulateOpen()
    s.simulateText(#"{"type":"beat","beat":{"kind":"say","text":"hi"}}"#)
    XCTAssertEqual(beats.count, 1)
    XCTAssertEqual(parse(beats[0])["kind"] as? String, "say")
  }

  func testNonBeatAndMalformedFramesIgnored() {
    var beats: [String] = []
    let s = FakeConversationSocket(); let c = make(s) { beats.append($0) }; c.connect(); s.simulateOpen()
    s.simulateText(#"{"type":"other"}"#)
    s.simulateText("not json")
    XCTAssertTrue(beats.isEmpty)
  }

  func testStopFrame() {
    let s = FakeConversationSocket(); let c = make(s); c.connect(); s.simulateOpen()
    c.stop()
    XCTAssertEqual(parse(s.sent.last!)["type"] as? String, "stop")
  }

  func testResolveProposalFrame() {
    let s = FakeConversationSocket(); let c = make(s); c.connect(); s.simulateOpen()
    c.resolveProposal(#"{"kind":"skill","name":"x"}"#)
    let f = parse(s.sent.last!)
    XCTAssertEqual(f["type"] as? String, "resolveProposal")
    XCTAssertEqual(f["accept"] as? Bool, true)
    XCTAssertEqual((f["proposal"] as? [String: Any])?["kind"] as? String, "skill")
  }

  func testCloseStopsSendsAndClosesSocket() {
    let s = FakeConversationSocket(); let c = make(s); c.connect(); s.simulateOpen()
    let before = s.sent.count
    c.close()
    c.start("ignored")
    XCTAssertEqual(s.sent.count, before)   // nothing sent after close
    XCTAssertEqual(s.closeCount, 1)
  }
}
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `swift test --filter ConversationClientTests`
Expected: FAIL — `ConversationSocket`/`ConversationClient` don't exist.

- [ ] **Step 3: Implement `ConversationSocket.swift`**

```swift
import Foundation

/// Injectable WebSocket seam so `ConversationClient`'s protocol logic is unit-tested
/// without real networking. Handlers are registered before `connect()`.
public protocol ConversationSocket: AnyObject {
  func onOpen(_ handler: @escaping () -> Void)
  func onText(_ handler: @escaping (String) -> Void)
  func onClose(_ handler: @escaping () -> Void)
  func connect()
  func send(_ text: String)
  func close()
}
```

- [ ] **Step 4: Implement `ConversationClient.swift`**

```swift
import Foundation

/// Drives a daemon conversation over an injected `ConversationSocket`: sends the
/// `{type:auth,token}` handshake first on open, flushes any queued commands, decodes
/// inbound `{type:"beat",beat}` frames to `onBeat` (the beat passed through as raw
/// JSON for the WebView), and encodes `start`/`stop`/`resolveProposal` commands
/// (queued until open). Mirrors the extension's `connectConversation` semantics.
public final class ConversationClient {
  private let socket: ConversationSocket
  private let token: String
  private let onBeat: (String) -> Void
  private var open = false
  private var closed = false
  private var queue: [String] = []

  public init(socket: ConversationSocket, token: String, onBeat: @escaping (String) -> Void) {
    self.socket = socket
    self.token = token
    self.onBeat = onBeat
    socket.onOpen { [weak self] in self?.handleOpen() }
    socket.onText { [weak self] in self?.handleText($0) }
    socket.onClose { [weak self] in self?.handleClose() }
  }

  /// Open the socket (the handshake is sent automatically once it opens).
  public func connect() { socket.connect() }

  public func start(_ task: String) { send(["type": "start", "task": task]) }
  public func stop() { send(["type": "stop"]) }

  /// Resolve a save proposal. `proposalJSON` is the opaque proposal object as JSON
  /// (the panel produced it); it's embedded verbatim into the frame.
  public func resolveProposal(_ proposalJSON: String) {
    guard let data = proposalJSON.data(using: .utf8),
          let proposal = try? JSONSerialization.jsonObject(with: data) else { return }
    send(["type": "resolveProposal", "proposal": proposal, "accept": true])
  }

  public func close() {
    closed = true
    socket.close()
  }

  // MARK: - Socket callbacks

  private func handleOpen() {
    open = true
    socket.send(encode(["type": "auth", "token": token]))  // auth must be the first frame
    for frame in queue { socket.send(frame) }
    queue.removeAll()
  }

  private func handleText(_ text: String) {
    guard !closed,
          let obj = (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any],
          (obj["type"] as? String) == "beat",
          let beat = obj["beat"],
          let beatData = try? JSONSerialization.data(withJSONObject: beat),
          let beatJSON = String(data: beatData, encoding: .utf8) else { return }
    onBeat(beatJSON)
  }

  private func handleClose() {
    open = false
    closed = true
  }

  // MARK: - Outbound

  private func send(_ value: [String: Any]) {
    if closed { return }
    let frame = encode(value)
    if open { socket.send(frame) } else { queue.append(frame) }
  }

  private func encode(_ value: [String: Any]) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: value),
          let s = String(data: data, encoding: .utf8) else { return "{}" }
    return s
  }
}
```

- [ ] **Step 5: Run it, expect PASS (7 tests)**

Run: `swift test --filter ConversationClientTests`. Then `swift build` (clean).

- [ ] **Step 6: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/mac-shell/Sources/FairyShell/ConversationSocket.swift \
        packages/mac-shell/Sources/FairyShell/ConversationClient.swift \
        packages/mac-shell/Tests/FairyShellTests/ConversationClientTests.swift
git commit -F - <<'MSG'
feat(mac-shell): ConversationClient — auth-first WS protocol over an injected socket

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 3: `URLSessionConversationSocket` — the real WS (glue)

**Files:**
- Create: `packages/mac-shell/Sources/fairy-shell/URLSessionConversationSocket.swift`

Glue — coverage-excluded, runtime-verified (no unit test), consistent with `URLSessionTransport`.

- [ ] **Step 1: Implement `URLSessionConversationSocket.swift`**

```swift
import Foundation
import FairyShell

/// Real conversation WebSocket via `URLSessionWebSocketTask`. Sends no `Origin`
/// header, so the daemon's `isAllowedOrigin` accepts it (a WebView's `"null"`
/// origin would be rejected). `resume()` queues sends until the socket connects,
/// so we treat resume as "open" and fire the handshake immediately; a receive
/// failure (e.g. daemon down / closed) surfaces as `onClose`.
final class URLSessionConversationSocket: ConversationSocket {
  private let url: URL
  private var task: URLSessionWebSocketTask?
  private var openHandler: (() -> Void)?
  private var textHandler: ((String) -> Void)?
  private var closeHandler: (() -> Void)?
  private var didClose = false

  init(url: URL) { self.url = url }

  func onOpen(_ handler: @escaping () -> Void) { openHandler = handler }
  func onText(_ handler: @escaping (String) -> Void) { textHandler = handler }
  func onClose(_ handler: @escaping () -> Void) { closeHandler = handler }

  func connect() {
    let t = URLSession.shared.webSocketTask(with: url)
    task = t
    t.resume()
    openHandler?()       // sends queue until the socket actually connects
    receive()
  }

  private func receive() {
    task?.receive { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(let message):
        if case .string(let text) = message { self.textHandler?(text) }
        self.receive()
      case .failure:
        self.fireClose()
      }
    }
  }

  func send(_ text: String) { task?.send(.string(text)) { _ in } }

  func close() {
    task?.cancel(with: .goingAway, reason: nil)
    task = nil
    fireClose()
  }

  private func fireClose() {
    if didClose { return }
    didClose = true
    closeHandler?()
  }
}
```

- [ ] **Step 2: Build + library tests**

Run from `packages/mac-shell/`: `swift build` (PASS — the exe compiles with the new socket). `swift test` (the library suite — now incl. Tasks 1–2's InfoClient + ConversationClient — still PASS; the total is the prior 51 + 6 + 7 = 64).

(No GUI to launch in PR-4a — the socket is exercised end-to-end in PR-4b when the panel window drives it. Its protocol partner `ConversationClient` is fully unit-tested.)

- [ ] **Step 3: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/mac-shell/Sources/fairy-shell/URLSessionConversationSocket.swift
git commit -F - <<'MSG'
feat(mac-shell): URLSessionConversationSocket — real conversation WS (no Origin)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 4: Coverage gate + final verification

**Files:** none (verification only)

- [ ] **Step 1: Full suite with coverage**

Run from `packages/mac-shell/`:
```bash
swift test --enable-code-coverage 2>&1 | grep -E "Executed [0-9]+ tests" | tail -1
```
Expected: 64 tests, 0 failures (51 prior + 6 InfoClient + 7 ConversationClient).

- [ ] **Step 2: Confirm FairyShell library coverage ≥90%**

```bash
BIN=$(swift build --show-bin-path)
xcrun llvm-cov report \
  "$BIN/fairy-shellPackageTests.xctest/Contents/MacOS/fairy-shellPackageTests" \
  -instr-profile "$BIN/codecov/default.profdata" \
  Sources/FairyShell 2>/dev/null | grep -E "Filename|---|\.swift|TOTAL" | sed 's|.*/Sources/FairyShell/||'
```
Expected: `InfoClient.swift`, `InfoModels.swift`, `ConversationClient.swift` at 100% lines; `ConversationSocket.swift` is a protocol (no executable lines); TOTAL line coverage well above 90%. (`URLSessionConversationSocket` lives under `Sources/fairy-shell/`, not this path — glue, excluded by convention.)

---

## Self-Review

**1. Spec coverage (PR-4a scope).**
- `InfoClient` (`GET /info` → `DaemonInfo { bridgePort, conversationPort }`, `SettingsError` taxonomy, `TokenReader` + `get` transport) → Task 1.
- `ConversationSocket` seam + `ConversationClient` (auth-first handshake, pre-open queue flush, `{type:beat}` decode → raw beat JSON, `start`/`stop`/`resolveProposal` encode, close stops sends) → Task 2.
- `URLSessionConversationSocket` (real WS, no Origin so the daemon accepts it) → Task 3.
- Coverage ≥90% on `FairyShell`; glue excluded → Task 4.
- Deferred to PR-4b (own plan, same spec): `PanelBridge`, `PanelWindowController`, the `agent-panel` `nativeBridge`/`shell` host + `build:shell`, `Package.swift` `resources`, the "Open Panel" menu item. No PR-4a spec requirement is left without a task.

**2. Placeholder scan.** Every code step shows complete Swift (full file bodies; complete test bodies). The glue file (Task 3) is fully written; its runtime verification is explicitly deferred to PR-4b (where a consumer exists). No "TBD"/"add validation"/"similar to Task N".

**3. Type consistency.** `DaemonInfo(bridgePort:conversationPort:)` (Task 1) matches the test and `InfoClient.fetch` decode. `InfoClient(baseURL:tokenURL:transport:)` mirrors `SettingsClient` and reuses `SettingsError` + `TokenReader` + `FakeTransport` (existing). `ConversationSocket`'s six methods (Task 3 protocol) are exactly those `FakeConversationSocket` (Task 2 test) and `URLSessionConversationSocket` (Task 3) implement, and those `ConversationClient` (Task 2) calls/registers. `ConversationClient(socket:token:onBeat:)` with `onBeat: (String) -> Void` matches the test's usage and the raw-beat-JSON contract the spec's data flow describes. `start(_:)`/`stop()`/`resolveProposal(_:)`/`connect()`/`close()` names are consistent across the impl and tests.
