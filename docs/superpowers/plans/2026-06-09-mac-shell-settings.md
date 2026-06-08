# macOS shell — native Settings UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A SwiftUI Settings window, opened from the status menu, that loads the daemon's redacted config and saves edits (provider keys, default provider/model, enabled models) via `PUT /settings` — honoring the redaction/merge contract.

**Architecture:** A tested pure core in the `FairyShell` library — `SettingsModels` (decode redacted / encode payload), `KnownProviders`, `SettingsForm` (the `buildUpdate()` contract encoder), `SettingsClient` (load/save over the injected transport), and a shared `TokenReader` — plus coverage-excluded SwiftUI/AppKit glue in the `fairy-shell` executable (`SettingsView`, `SettingsViewModel`, `SettingsWindowController`, the `AppDelegate` menu item, and the URLSession `put`).

**Tech Stack:** Swift 6 / SPM (language mode 5), XCTest, SwiftUI + AppKit (executable only). Run `swift` from `packages/mac-shell/`.

**Spec:** `docs/superpowers/specs/2026-06-09-mac-shell-settings-design.md`.

Daemon contract (confirmed in `packages/pi-daemon/src/settings.ts` + `httpServer.ts`):
- `GET /settings` → `{ providers: [{id, hasKey}], defaultProvider?, defaultModel?, enabledModels? }` (bearer-auth; secrets redacted).
- `PUT /settings` body = `{ providers: [{id, apiKey}], defaultProvider?, defaultModel?, enabledModels? }`; validated by `isPiConfig`; merged by `mergeProviderKeys` (blank key keeps stored, non-blank replaces, omitted provider removed); returns `200` with the re-redacted config.

Commit trailer MUST be exactly:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 1: `TokenReader` (shared token read; refactor `StatusClient` onto it)

**Files:**
- Create: `packages/mac-shell/Sources/FairyShell/TokenReader.swift`
- Test: `packages/mac-shell/Tests/FairyShellTests/TokenReaderTests.swift`
- Modify: `packages/mac-shell/Sources/FairyShell/StatusClient.swift` (delegate its private read)

- [ ] **Step 1: Write the failing test**

Create `packages/mac-shell/Tests/FairyShellTests/TokenReaderTests.swift`:

```swift
import XCTest
@testable import FairyShell

final class TokenReaderTests: XCTestCase {
  private func file(_ contents: String?) -> URL {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let f = dir.appendingPathComponent("token.json")
    if let c = contents { try? c.write(to: f, atomically: true, encoding: .utf8) }
    return f
  }

  func testReadsTheToken() {
    XCTAssertEqual(TokenReader.read(from: file("{\"token\":\"abc123\"}")), "abc123")
  }
  func testNilWhenFileMissing() { XCTAssertNil(TokenReader.read(from: file(nil))) }
  func testNilWhenMalformed() { XCTAssertNil(TokenReader.read(from: file("not json"))) }
  func testNilWhenTokenEmpty() { XCTAssertNil(TokenReader.read(from: file("{\"token\":\"\"}"))) }
  func testNilWhenTokenAbsent() { XCTAssertNil(TokenReader.read(from: file("{}"))) }
}
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `cd packages/mac-shell && swift test --filter TokenReaderTests`
Expected: FAIL — `TokenReader` doesn't exist (compile error).

- [ ] **Step 3: Implement `TokenReader.swift`**

```swift
import Foundation

/// Reads the shell's bearer token from `token.json` (`{ "token": String }`).
/// Pure (URL injected) and shared by `StatusClient` + `SettingsClient`.
public enum TokenReader {
  /// The token, or nil if the file is missing/unreadable/malformed or empty.
  public static func read(from url: URL) -> String? {
    guard let data = try? Data(contentsOf: url) else { return nil }
    struct TokenFile: Decodable { let token: String }
    let token = (try? JSONDecoder().decode(TokenFile.self, from: data))?.token
    return (token?.isEmpty == false) ? token : nil
  }
}
```

- [ ] **Step 4: Refactor `StatusClient` to delegate**

In `packages/mac-shell/Sources/FairyShell/StatusClient.swift`, replace the `private func readToken()` body so it delegates (keeps behavior identical, removes the duplicate):

```swift
  private func readToken() -> String? { TokenReader.read(from: tokenURL) }
```

- [ ] **Step 5: Run it, expect PASS (5 new + StatusClient's 4 still green)**

Run: `swift test --filter TokenReaderTests` then `swift test --filter StatusClientTests`
Expected: both PASS.

- [ ] **Step 6: Build + commit**

```bash
cd /Users/julianshen/prj/fAIry
swift -version >/dev/null && (cd packages/mac-shell && swift build)
git add packages/mac-shell/Sources/FairyShell/TokenReader.swift \
        packages/mac-shell/Tests/FairyShellTests/TokenReaderTests.swift \
        packages/mac-shell/Sources/FairyShell/StatusClient.swift
git commit -F - <<'MSG'
refactor(mac-shell): extract TokenReader shared by StatusClient + SettingsClient

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 2: `SettingsModels` (decode redacted / encode payload)

**Files:**
- Create: `packages/mac-shell/Sources/FairyShell/SettingsModels.swift`
- Test: `packages/mac-shell/Tests/FairyShellTests/SettingsModelsTests.swift`

- [ ] **Step 1: Write the failing test**

Create `packages/mac-shell/Tests/FairyShellTests/SettingsModelsTests.swift`:

```swift
import XCTest
@testable import FairyShell

final class SettingsModelsTests: XCTestCase {
  func testDecodesRedactedConfigWithOptionals() throws {
    let json = Data(#"{"providers":[{"id":"anthropic","hasKey":true}],"defaultProvider":"anthropic","defaultModel":"claude","enabledModels":["a","b"]}"#.utf8)
    let cfg = try JSONDecoder().decode(RedactedConfig.self, from: json)
    XCTAssertEqual(cfg.providers, [RedactedProvider(id: "anthropic", hasKey: true)])
    XCTAssertEqual(cfg.defaultProvider, "anthropic")
    XCTAssertEqual(cfg.defaultModel, "claude")
    XCTAssertEqual(cfg.enabledModels, ["a", "b"])
  }

  func testDecodesRedactedConfigWithoutOptionals() throws {
    let cfg = try JSONDecoder().decode(RedactedConfig.self, from: Data(#"{"providers":[]}"#.utf8))
    XCTAssertEqual(cfg.providers, [])
    XCTAssertNil(cfg.defaultProvider)
    XCTAssertNil(cfg.enabledModels)
  }

  func testPayloadOmitsNilOptionals() throws {
    let payload = PiConfigPayload(providers: [ProviderPayload(id: "openai", apiKey: "sk-x")])
    let data = try JSONEncoder().encode(payload)
    let obj = try JSONSerialization.jsonObject(with: data) as! [String: Any]
    XCTAssertEqual(Set(obj.keys), ["providers"])  // defaults/enabledModels omitted
    let provs = obj["providers"] as! [[String: Any]]
    XCTAssertEqual(provs.first?["apiKey"] as? String, "sk-x")
  }

  func testPayloadEncodesPresentOptionals() throws {
    let payload = PiConfigPayload(providers: [], defaultProvider: "anthropic",
                                  defaultModel: "claude", enabledModels: ["m"])
    let obj = try JSONSerialization.jsonObject(with: JSONEncoder().encode(payload)) as! [String: Any]
    XCTAssertEqual(obj["defaultProvider"] as? String, "anthropic")
    XCTAssertEqual(obj["enabledModels"] as? [String], ["m"])
  }
}
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `swift test --filter SettingsModelsTests`
Expected: FAIL — the types don't exist (compile error).

- [ ] **Step 3: Implement `SettingsModels.swift`**

```swift
import Foundation

/// One provider as `GET /settings` reports it: the id and whether a key is set
/// (never the key itself — the daemon redacts secrets).
public struct RedactedProvider: Decodable, Equatable, Sendable {
  public let id: String
  public let hasKey: Bool
  public init(id: String, hasKey: Bool) { self.id = id; self.hasKey = hasKey }
}

/// The redacted config returned by `GET /settings`. Keys are never present.
public struct RedactedConfig: Decodable, Equatable, Sendable {
  public let providers: [RedactedProvider]
  public let defaultProvider: String?
  public let defaultModel: String?
  public let enabledModels: [String]?
  public init(providers: [RedactedProvider], defaultProvider: String? = nil,
              defaultModel: String? = nil, enabledModels: [String]? = nil) {
    self.providers = providers; self.defaultProvider = defaultProvider
    self.defaultModel = defaultModel; self.enabledModels = enabledModels
  }
}

/// One provider in a `PUT /settings` body: id + the (possibly blank) key.
public struct ProviderPayload: Encodable, Equatable, Sendable {
  public let id: String
  public let apiKey: String
  public init(id: String, apiKey: String) { self.id = id; self.apiKey = apiKey }
}

/// The full config `PUT /settings` accepts. Nil optionals are omitted from the
/// JSON (synthesized `encodeIfPresent`), matching the daemon's optional-field rules.
public struct PiConfigPayload: Encodable, Equatable, Sendable {
  public let providers: [ProviderPayload]
  public let defaultProvider: String?
  public let defaultModel: String?
  public let enabledModels: [String]?
  public init(providers: [ProviderPayload], defaultProvider: String? = nil,
              defaultModel: String? = nil, enabledModels: [String]? = nil) {
    self.providers = providers; self.defaultProvider = defaultProvider
    self.defaultModel = defaultModel; self.enabledModels = enabledModels
  }
}
```

- [ ] **Step 4: Run it, expect PASS (4 tests)**

Run: `swift test --filter SettingsModelsTests`

- [ ] **Step 5: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/mac-shell/Sources/FairyShell/SettingsModels.swift \
        packages/mac-shell/Tests/FairyShellTests/SettingsModelsTests.swift
git commit -F - <<'MSG'
feat(mac-shell): settings wire models (RedactedConfig decode, PiConfigPayload encode)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 3: `KnownProviders`

**Files:**
- Create: `packages/mac-shell/Sources/FairyShell/KnownProviders.swift`
- Test: `packages/mac-shell/Tests/FairyShellTests/KnownProvidersTests.swift`

- [ ] **Step 1: Write the failing test**

Create `packages/mac-shell/Tests/FairyShellTests/KnownProvidersTests.swift`:

```swift
import XCTest
@testable import FairyShell

final class KnownProvidersTests: XCTestCase {
  func testHasCommonProviders() {
    XCTAssertTrue(KnownProviders.ids.contains("anthropic"))
    XCTAssertTrue(KnownProviders.ids.contains("openai"))
  }
  func testNoBlanksOrDuplicates() {
    XCTAssertFalse(KnownProviders.ids.contains(""))
    XCTAssertEqual(KnownProviders.ids.count, Set(KnownProviders.ids).count)
  }
}
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `swift test --filter KnownProvidersTests`
Expected: FAIL — `KnownProviders` doesn't exist.

- [ ] **Step 3: Implement `KnownProviders.swift`**

```swift
/// Well-known Pi provider ids surfaced as ready rows in Settings. Not exhaustive
/// (the UI also allows a custom id) and may drift from Pi over time.
public enum KnownProviders {
  public static let ids: [String] = ["anthropic", "openai", "google", "openrouter", "groq"]
}
```

- [ ] **Step 4: Run it, expect PASS (2 tests)**

Run: `swift test --filter KnownProvidersTests`

- [ ] **Step 5: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/mac-shell/Sources/FairyShell/KnownProviders.swift \
        packages/mac-shell/Tests/FairyShellTests/KnownProvidersTests.swift
git commit -F - <<'MSG'
feat(mac-shell): curated known provider ids for the Settings rows

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 4: `SettingsForm` (the merge-contract encoder)

**Files:**
- Create: `packages/mac-shell/Sources/FairyShell/SettingsForm.swift`
- Test: `packages/mac-shell/Tests/FairyShellTests/SettingsFormTests.swift`

This is the heart — the `buildUpdate()` contract must be exact.

- [ ] **Step 1: Write the failing test**

Create `packages/mac-shell/Tests/FairyShellTests/SettingsFormTests.swift`:

```swift
import XCTest
@testable import FairyShell

final class SettingsFormTests: XCTestCase {
  // MARK: from()
  func testFromUnionsRedactedAndKnown() {
    let redacted = RedactedConfig(providers: [RedactedProvider(id: "custom", hasKey: true)])
    let form = SettingsForm.from(redacted, known: ["anthropic", "custom"])
    // existing custom row preserved (hasKey true) + known "anthropic" appended (hasKey false)
    XCTAssertEqual(form.providers.map(\.id), ["custom", "anthropic"])
    XCTAssertEqual(form.providers.first { $0.id == "custom" }?.hasKey, true)
    XCTAssertEqual(form.providers.first { $0.id == "anthropic" }?.hasKey, false)
  }
  func testFromNilOptionalsBecomeEmpty() {
    let form = SettingsForm.from(RedactedConfig(providers: []), known: [])
    XCTAssertEqual(form.defaultProvider, "")
    XCTAssertEqual(form.defaultModel, "")
    XCTAssertEqual(form.enabledModels, [])
  }

  // MARK: buildUpdate() — the contract matrix
  func testUntouchedHasKeyRowSendsBlankKey() {
    let form = SettingsForm(providers: [ProviderRow(id: "anthropic", hasKey: true)])
    let p = form.buildUpdate().providers
    XCTAssertEqual(p, [ProviderPayload(id: "anthropic", apiKey: "")])  // blank → daemon keeps stored
  }
  func testTypedKeyReplaces() {
    let form = SettingsForm(providers: [ProviderRow(id: "openai", hasKey: false, keyInput: "sk-new")])
    XCTAssertEqual(form.buildUpdate().providers, [ProviderPayload(id: "openai", apiKey: "sk-new")])
  }
  func testRemovedRowOmitted() {
    let form = SettingsForm(providers: [ProviderRow(id: "anthropic", hasKey: true, keyInput: "", removed: true)])
    XCTAssertEqual(form.buildUpdate().providers, [])  // omitted → daemon drops it (clears the key)
  }
  func testEmptyCuratedRowOmitted() {
    let form = SettingsForm(providers: [ProviderRow(id: "google", hasKey: false, keyInput: "  ")])
    XCTAssertEqual(form.buildUpdate().providers, [])  // no stored key, no real input → not sent
  }
  func testDefaultsTrimmedAndOmittedWhenEmpty() {
    let withDefaults = SettingsForm(providers: [], defaultProvider: " anthropic ", defaultModel: "claude")
    let u = withDefaults.buildUpdate()
    XCTAssertEqual(u.defaultProvider, "anthropic")
    XCTAssertEqual(u.defaultModel, "claude")
    let empty = SettingsForm(providers: [], defaultProvider: "  ", defaultModel: "")
    XCTAssertNil(empty.buildUpdate().defaultProvider)
    XCTAssertNil(empty.buildUpdate().defaultModel)
  }
  func testEnabledModelsBlankFilteredAndOmittedWhenEmpty() {
    let form = SettingsForm(providers: [], enabledModels: ["a", "", "  ", "b"])
    XCTAssertEqual(form.buildUpdate().enabledModels, ["a", "b"])
    XCTAssertNil(SettingsForm(providers: [], enabledModels: ["", " "]).buildUpdate().enabledModels)
  }
}
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `swift test --filter SettingsFormTests`
Expected: FAIL — `SettingsForm`/`ProviderRow` don't exist.

- [ ] **Step 3: Implement `SettingsForm.swift`**

```swift
import Foundation

/// One editable provider row in the Settings form.
public struct ProviderRow: Equatable, Sendable {
  public var id: String
  public var hasKey: Bool       // a key is already stored (from the redacted GET)
  public var keyInput: String   // what the user typed; blank = leave the stored key
  public var removed: Bool      // user dropped this provider (omitting it clears its key)
  public init(id: String, hasKey: Bool, keyInput: String = "", removed: Bool = false) {
    self.id = id; self.hasKey = hasKey; self.keyInput = keyInput; self.removed = removed
  }
}

/// The editable Settings state, built from the redacted config + known providers.
/// `buildUpdate()` encodes the daemon's merge contract into a `PUT` payload.
public struct SettingsForm: Equatable, Sendable {
  public var providers: [ProviderRow]
  public var defaultProvider: String
  public var defaultModel: String
  public var enabledModels: [String]
  public init(providers: [ProviderRow], defaultProvider: String = "",
              defaultModel: String = "", enabledModels: [String] = []) {
    self.providers = providers; self.defaultProvider = defaultProvider
    self.defaultModel = defaultModel; self.enabledModels = enabledModels
  }

  /// Build the editable form from a redacted config, unioned with the known
  /// provider ids (known ids absent from the config appear as empty rows).
  public static func from(_ redacted: RedactedConfig, known: [String] = KnownProviders.ids) -> SettingsForm {
    var rows = redacted.providers.map { ProviderRow(id: $0.id, hasKey: $0.hasKey) }
    let present = Set(rows.map(\.id))
    for id in known where !present.contains(id) { rows.append(ProviderRow(id: id, hasKey: false)) }
    return SettingsForm(
      providers: rows,
      defaultProvider: redacted.defaultProvider ?? "",
      defaultModel: redacted.defaultModel ?? "",
      enabledModels: redacted.enabledModels ?? []
    )
  }

  /// Encode the form to a `PUT /settings` payload, honoring the merge contract:
  /// a row is sent iff it isn't removed and either has a stored key or a typed
  /// one; its `apiKey` is the typed value (blank → daemon keeps the stored key);
  /// removed/empty rows are omitted (the only way to clear a key). Empty defaults
  /// and an empty enabledModels list are omitted (nil) so they don't overwrite.
  public func buildUpdate() -> PiConfigPayload {
    let provs = providers
      .filter { !$0.removed && ($0.hasKey || !$0.keyInput.trimmingCharacters(in: .whitespaces).isEmpty) }
      .map { ProviderPayload(id: $0.id, apiKey: $0.keyInput) }
    let models = enabledModels
      .map { $0.trimmingCharacters(in: .whitespaces) }
      .filter { !$0.isEmpty }
    return PiConfigPayload(
      providers: provs,
      defaultProvider: nonEmpty(defaultProvider),
      defaultModel: nonEmpty(defaultModel),
      enabledModels: models.isEmpty ? nil : models
    )
  }

  private func nonEmpty(_ s: String) -> String? {
    let t = s.trimmingCharacters(in: .whitespaces)
    return t.isEmpty ? nil : t
  }
}
```

- [ ] **Step 4: Run it, expect PASS (9 tests)**

Run: `swift test --filter SettingsFormTests`

- [ ] **Step 5: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/mac-shell/Sources/FairyShell/SettingsForm.swift \
        packages/mac-shell/Tests/FairyShellTests/SettingsFormTests.swift
git commit -F - <<'MSG'
feat(mac-shell): SettingsForm + buildUpdate (blank-keeps / omit-removes contract)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 5: `HTTPTransport.put` + `SettingsClient`

**Files:**
- Modify: `packages/mac-shell/Sources/FairyShell/HTTPTransport.swift` (add `put`)
- Create: `packages/mac-shell/Sources/FairyShell/SettingsClient.swift`
- Modify: `packages/mac-shell/Tests/FairyShellTests/StatusClientTests.swift` (extend `FakeTransport` with `put`)
- Test: `packages/mac-shell/Tests/FairyShellTests/SettingsClientTests.swift`

- [ ] **Step 1: Add `put` to the transport protocol**

In `packages/mac-shell/Sources/FairyShell/HTTPTransport.swift`, add the `put` requirement:

```swift
import Foundation

/// Minimal GET/PUT seam so the clients are testable without real networking.
/// Returns (HTTP status, body) or nil on a connection-level error.
public protocol HTTPTransport: Sendable {
  func get(_ url: URL, bearer: String) async -> (status: Int, body: Data)?
  func put(_ url: URL, bearer: String, body: Data) async -> (status: Int, body: Data)?
}
```

- [ ] **Step 2: Extend `FakeTransport` so it still conforms (and records the PUT body)**

In `packages/mac-shell/Tests/FairyShellTests/StatusClientTests.swift`, replace the `FakeTransport` class with:

```swift
/// A transport that returns canned (status, body) values (or nil = connection error)
/// for GET and PUT, recording the last request for assertions.
final class FakeTransport: HTTPTransport {
  var result: (status: Int, body: Data)?     // GET result
  var putResult: (status: Int, body: Data)?  // PUT result
  var lastURL: URL?
  var lastBearer: String?
  var lastPutBody: Data?
  init(_ result: (status: Int, body: Data)?) { self.result = result }
  func get(_ url: URL, bearer: String) async -> (status: Int, body: Data)? {
    lastURL = url; lastBearer = bearer; return result
  }
  func put(_ url: URL, bearer: String, body: Data) async -> (status: Int, body: Data)? {
    lastURL = url; lastBearer = bearer; lastPutBody = body; return putResult
  }
}
```

(The existing `StatusClientTests` calls — `FakeTransport((status: 200, body: …))` — are unchanged; only the new `put` method and PUT-recording fields are added.)

- [ ] **Step 3: Write the failing `SettingsClient` test**

Create `packages/mac-shell/Tests/FairyShellTests/SettingsClientTests.swift`:

```swift
import XCTest
@testable import FairyShell

final class SettingsClientTests: XCTestCase {
  private func tokenFile(_ contents: String?) -> URL {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let f = dir.appendingPathComponent("token.json")
    if let c = contents { try? c.write(to: f, atomically: true, encoding: .utf8) }
    return f
  }
  private func client(_ transport: FakeTransport, token: String? = "{\"token\":\"t\"}") -> SettingsClient {
    SettingsClient(baseURL: URL(string: "http://127.0.0.1:51789")!,
                   tokenURL: tokenFile(token), transport: transport)
  }

  func testLoadDecodesRedactedAndHitsSettingsURL() async {
    let t = FakeTransport((status: 200, body: Data(#"{"providers":[{"id":"anthropic","hasKey":true}]}"#.utf8)))
    let result = await client(t).load()
    XCTAssertEqual(try? result.get().providers, [RedactedProvider(id: "anthropic", hasKey: true)])
    XCTAssertEqual(t.lastURL?.absoluteString, "http://127.0.0.1:51789/settings")
    XCTAssertEqual(t.lastBearer, "t")
  }
  func testLoadUnauthorizedOn401() async {
    let result = await client(FakeTransport((status: 401, body: Data()))).load()
    XCTAssertEqual(result, .failure(.unauthorized))
  }
  func testLoadServerOnOtherStatus() async {
    let result = await client(FakeTransport((status: 500, body: Data()))).load()
    XCTAssertEqual(result, .failure(.server(status: 500)))
  }
  func testLoadUnreachableOnTransportNil() async {
    let result = await client(FakeTransport(nil)).load()
    XCTAssertEqual(result, .failure(.unreachable))
  }
  func testLoadUnreachableWhenTokenMissing() async {
    let result = await client(FakeTransport((status: 200, body: Data())), token: nil).load()
    XCTAssertEqual(result, .failure(.unreachable))
  }
  func testLoadDecodeErrorOnBadBody() async {
    let result = await client(FakeTransport((status: 200, body: Data("nope".utf8)))).load()
    XCTAssertEqual(result, .failure(.decode))
  }
  func testSavePutsEncodedPayloadAndDecodesResult() async {
    let t = FakeTransport(nil)
    t.putResult = (status: 200, body: Data(#"{"providers":[{"id":"openai","hasKey":true}]}"#.utf8))
    let payload = PiConfigPayload(providers: [ProviderPayload(id: "openai", apiKey: "sk-x")])
    let result = await client(t).save(payload)
    XCTAssertEqual(try? result.get().providers, [RedactedProvider(id: "openai", hasKey: true)])
    XCTAssertEqual(t.lastURL?.absoluteString, "http://127.0.0.1:51789/settings")
    let sent = try! JSONSerialization.jsonObject(with: t.lastPutBody!) as! [String: Any]
    let provs = sent["providers"] as! [[String: Any]]
    XCTAssertEqual(provs.first?["apiKey"] as? String, "sk-x")
  }
  func testSaveServerOnNon200() async {
    let t = FakeTransport(nil); t.putResult = (status: 400, body: Data())
    let result = await client(t).save(PiConfigPayload(providers: []))
    XCTAssertEqual(result, .failure(.server(status: 400)))
  }
}
```

- [ ] **Step 4: Run it, expect FAIL**

Run: `swift test --filter SettingsClientTests`
Expected: FAIL — `SettingsClient`/`SettingsError` don't exist.

- [ ] **Step 5: Implement `SettingsClient.swift`**

```swift
import Foundation

/// Why a settings load/save could not complete.
public enum SettingsError: Error, Equatable, Sendable {
  case unreachable          // no token, or a transport-level connection error
  case unauthorized         // 401 — token mismatch
  case server(status: Int)  // any other non-200
  case decode               // 200 but the body wasn't the expected JSON
}

/// Loads/saves the daemon's settings over the bearer-authenticated control plane.
/// Pure logic — the token path + transport are injected (mirrors `StatusClient`).
public struct SettingsClient: Sendable {
  private let settingsURL: URL
  private let tokenURL: URL
  private let transport: HTTPTransport

  public init(baseURL: URL, tokenURL: URL, transport: HTTPTransport) {
    self.settingsURL = baseURL.appendingPathComponent("settings")
    self.tokenURL = tokenURL
    self.transport = transport
  }

  /// `GET /settings` → the redacted config.
  public func load() async -> Result<RedactedConfig, SettingsError> {
    guard let token = TokenReader.read(from: tokenURL) else { return .failure(.unreachable) }
    guard let (status, body) = await transport.get(settingsURL, bearer: token) else { return .failure(.unreachable) }
    return decode(status: status, body: body)
  }

  /// `PUT /settings` with the payload → the re-redacted config.
  public func save(_ payload: PiConfigPayload) async -> Result<RedactedConfig, SettingsError> {
    guard let token = TokenReader.read(from: tokenURL) else { return .failure(.unreachable) }
    guard let data = try? JSONEncoder().encode(payload) else { return .failure(.decode) }
    guard let (status, body) = await transport.put(settingsURL, bearer: token, body: data) else { return .failure(.unreachable) }
    return decode(status: status, body: body)
  }

  private func decode(status: Int, body: Data) -> Result<RedactedConfig, SettingsError> {
    switch status {
    case 200:
      guard let cfg = try? JSONDecoder().decode(RedactedConfig.self, from: body) else { return .failure(.decode) }
      return .success(cfg)
    case 401: return .failure(.unauthorized)
    default: return .failure(.server(status: status))
    }
  }
}
```

- [ ] **Step 6: Run it, expect PASS (8 new; StatusClientTests still green)**

Run: `swift test`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/mac-shell/Sources/FairyShell/HTTPTransport.swift \
        packages/mac-shell/Sources/FairyShell/SettingsClient.swift \
        packages/mac-shell/Tests/FairyShellTests/StatusClientTests.swift \
        packages/mac-shell/Tests/FairyShellTests/SettingsClientTests.swift
git commit -F - <<'MSG'
feat(mac-shell): SettingsClient load/save over GET/PUT /settings (+ transport put)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 6: Glue — SwiftUI view, window, menu wiring, URLSession PUT

**Files:**
- Create: `packages/mac-shell/Sources/fairy-shell/SettingsViewModel.swift`
- Create: `packages/mac-shell/Sources/fairy-shell/SettingsView.swift`
- Create: `packages/mac-shell/Sources/fairy-shell/SettingsWindowController.swift`
- Modify: `packages/mac-shell/Sources/fairy-shell/URLSessionTransport.swift` (add `put`)
- Modify: `packages/mac-shell/Sources/fairy-shell/AppDelegate.swift` (menu item + owns the window controller)

AppKit/SwiftUI glue — runtime-verified by launching, not unit-tested (the executable target mirrors M5-1/M5-2). The library tests must stay green.

- [ ] **Step 1: Add `put` to `URLSessionTransport`**

In `packages/mac-shell/Sources/fairy-shell/URLSessionTransport.swift`, add the `put` method (and keep the existing `get`):

```swift
  func put(_ url: URL, bearer: String, body: Data) async -> (status: Int, body: Data)? {
    var req = URLRequest(url: url)
    req.httpMethod = "PUT"
    req.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.httpBody = body
    req.timeoutInterval = 5
    guard let (data, resp) = try? await URLSession.shared.data(for: req),
          let http = resp as? HTTPURLResponse else { return nil }
    return (http.statusCode, data)
  }
```

- [ ] **Step 2: Create `SettingsViewModel.swift`** (thin @MainActor orchestration over the tested client)

```swift
import Foundation
import FairyShell

@MainActor
final class SettingsViewModel: ObservableObject {
  enum Phase: Equatable { case loading, ready, loadFailed(String) }
  @Published var phase: Phase = .loading
  @Published var form = SettingsForm(providers: [])
  @Published var status = ""
  @Published var saving = false

  private let client: SettingsClient
  init(client: SettingsClient) { self.client = client }

  func load() async {
    phase = .loading; status = ""
    switch await client.load() {
    case .success(let cfg): form = SettingsForm.from(cfg); phase = .ready
    case .failure(let e): phase = .loadFailed(Self.describe(e))
    }
  }

  func save() async {
    saving = true; status = ""
    switch await client.save(form.buildUpdate()) {
    case .success(let cfg): form = SettingsForm.from(cfg); status = "Saved."
    case .failure(let e): status = "Save failed: \(Self.describe(e))"
    }
    saving = false
  }

  func addCustomProvider(_ id: String) {
    let t = id.trimmingCharacters(in: .whitespaces)
    guard !t.isEmpty, !form.providers.contains(where: { $0.id == t }) else { return }
    form.providers.append(ProviderRow(id: t, hasKey: false))
  }

  static func describe(_ e: SettingsError) -> String {
    switch e {
    case .unreachable: return "couldn't reach the daemon — is it running?"
    case .unauthorized: return "unauthorized (401)"
    case .server(let s): return "daemon returned \(s)"
    case .decode: return "unexpected response"
    }
  }
}
```

- [ ] **Step 3: Create `SettingsView.swift`**

```swift
import SwiftUI
import FairyShell

struct SettingsView: View {
  @ObservedObject var model: SettingsViewModel
  @State private var customId = ""

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Fairy Settings").font(.title2).bold()
      switch model.phase {
      case .loading:
        ProgressView("Loading…").frame(maxWidth: .infinity, maxHeight: .infinity)
      case .loadFailed(let why):
        VStack(alignment: .leading, spacing: 8) {
          Text("Couldn't load settings: \(why)").foregroundColor(.red)
          Button("Retry") { Task { await model.load() } }
        }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      case .ready:
        readyForm
      }
    }
    .padding(20)
    .frame(width: 480, height: 560)
    .task { await model.load() }
  }

  private var readyForm: some View {
    VStack(alignment: .leading, spacing: 14) {
      ScrollView {
        VStack(alignment: .leading, spacing: 18) {
          providersSection
          Divider(); defaultsSection
          Divider(); enabledModelsSection
        }
      }
      Divider()
      HStack {
        Text(model.status)
          .foregroundColor(model.status.hasPrefix("Save failed") ? .red : .secondary)
        Spacer()
        Button(model.saving ? "Saving…" : "Save") { Task { await model.save() } }
          .keyboardShortcut(.defaultAction).disabled(model.saving)
      }
    }
  }

  private func keyBinding(_ i: Int) -> Binding<String> {
    Binding(get: { model.form.providers[i].keyInput },
            set: { model.form.providers[i].keyInput = $0 })
  }

  private var providersSection: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("Providers").font(.headline)
      ForEach(model.form.providers.indices, id: \.self) { i in
        HStack {
          Text(model.form.providers[i].id).frame(width: 110, alignment: .leading)
          if model.form.providers[i].removed {
            Text("removed").foregroundColor(.secondary)
            Button("Undo") { model.form.providers[i].removed = false }
          } else {
            SecureField(model.form.providers[i].hasKey ? "key is set — type to replace" : "API key",
                        text: keyBinding(i)).textFieldStyle(.roundedBorder)
            Button(role: .destructive) { model.form.providers[i].removed = true } label: {
              Image(systemName: "trash")
            }
          }
        }
      }
      HStack {
        TextField("Add custom provider id", text: $customId).textFieldStyle(.roundedBorder)
        Button("Add") { model.addCustomProvider(customId); customId = "" }
      }
    }
  }

  private var defaultsSection: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("Defaults").font(.headline)
      HStack {
        Text("Provider").frame(width: 110, alignment: .leading)
        TextField("e.g. anthropic",
                  text: Binding(get: { model.form.defaultProvider },
                                set: { model.form.defaultProvider = $0 })).textFieldStyle(.roundedBorder)
      }
      HStack {
        Text("Model").frame(width: 110, alignment: .leading)
        TextField("e.g. claude-sonnet-4-6",
                  text: Binding(get: { model.form.defaultModel },
                                set: { model.form.defaultModel = $0 })).textFieldStyle(.roundedBorder)
      }
    }
  }

  private var enabledModelsSection: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("Enabled models").font(.headline)
      ForEach(model.form.enabledModels.indices, id: \.self) { i in
        HStack {
          TextField("model id",
                    text: Binding(get: { model.form.enabledModels[i] },
                                  set: { model.form.enabledModels[i] = $0 })).textFieldStyle(.roundedBorder)
          Button(role: .destructive) { model.form.enabledModels.remove(at: i) } label: {
            Image(systemName: "minus.circle")
          }
        }
      }
      Button("Add model") { model.form.enabledModels.append("") }
    }
  }
}
```

- [ ] **Step 4: Create `SettingsWindowController.swift`**

```swift
import AppKit
import SwiftUI
import FairyShell

/// Owns the single Settings NSWindow hosting the SwiftUI `SettingsView`.
@MainActor
final class SettingsWindowController {
  private var window: NSWindow?
  private let makeClient: () -> SettingsClient
  init(makeClient: @escaping () -> SettingsClient) { self.makeClient = makeClient }

  func show() {
    if let w = window {
      w.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true); return
    }
    let model = SettingsViewModel(client: makeClient())
    let w = NSWindow(contentViewController: NSHostingController(rootView: SettingsView(model: model)))
    w.title = "Fairy Settings"
    w.styleMask = [.titled, .closable]
    w.isReleasedWhenClosed = false
    w.center()
    window = w
    w.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }
}
```

- [ ] **Step 5: Wire `AppDelegate`** — own the controller + add the menu item

In `applicationDidFinishLaunching`, after `pairingFileURL = …` and before `buildMenu()`, add (reuse the `appData` already computed; factor the base URL):

```swift
    let baseURL = URL(string: "http://127.0.0.1:51789")!
    let tokenURL = appData.appendingPathComponent("token.json")
    settingsWindow = SettingsWindowController {
      SettingsClient(baseURL: baseURL, tokenURL: tokenURL, transport: URLSessionTransport())
    }
```

Add the stored property next to the others near the top of the class:

```swift
  private var settingsWindow: SettingsWindowController!
```

Update the existing `StatusClient(...)` construction to reuse `baseURL`/`tokenURL` (replaces the inline `URL(string:)`/`appendingPathComponent("token.json")` so they're defined once):

```swift
    let status = StatusClient(baseURL: baseURL, tokenURL: tokenURL, transport: URLSessionTransport())
```

In `buildMenu()`, insert a Settings item between the pairing section's trailing separator and the Restart item:

```swift
    let settings = NSMenuItem(title: "Settings…", action: #selector(openSettings), keyEquivalent: ",")
    settings.target = self
    menu.addItem(settings)
    menu.addItem(.separator())
```

Add the action (next to `restart`/`quit`):

```swift
  @objc private func openSettings() { settingsWindow.show() }
```

- [ ] **Step 6: Build + library tests + manual smoke**

Run from `packages/mac-shell/`: `swift build` (PASS — the exe compiles with SwiftUI + the new window). `swift test` (the library suite — now incl. Tasks 1–5 — still PASS).

Manual smoke (human, not headless): `swift run fairy-shell`, open the menu → **Settings…**, confirm the window loads providers, typing a key + **Save** round-trips (status line shows "Saved."), and a daemon-down case shows the "couldn't reach" state with Retry.

- [ ] **Step 7: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/mac-shell/Sources/fairy-shell/SettingsViewModel.swift \
        packages/mac-shell/Sources/fairy-shell/SettingsView.swift \
        packages/mac-shell/Sources/fairy-shell/SettingsWindowController.swift \
        packages/mac-shell/Sources/fairy-shell/URLSessionTransport.swift \
        packages/mac-shell/Sources/fairy-shell/AppDelegate.swift
git commit -F - <<'MSG'
feat(mac-shell): Settings window — SwiftUI form over GET/PUT /settings

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 7: Coverage gate + final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full suite with coverage**

Run from `packages/mac-shell/`:
```bash
swift test --enable-code-coverage 2>&1 | tail -5
```
Expected: all tests pass (Tasks 1–5 added TokenReader 5 + SettingsModels 4 + KnownProviders 2 + SettingsForm 9 + SettingsClient 8 = 28 new, on top of the existing 24).

- [ ] **Step 2: Confirm FairyShell library coverage ≥90%**

```bash
BIN=$(swift build --show-bin-path)
xcrun llvm-cov report \
  "$BIN/fairy-shellPackageTests.xctest/Contents/MacOS/fairy-shellPackageTests" \
  -instr-profile "$BIN/codecov/default.profdata" \
  Sources/FairyShell 2>/dev/null | tail -20
```
Expected: every `Sources/FairyShell/*.swift` line-coverage ≥90% (the new `SettingsModels`/`SettingsForm`/`SettingsClient`/`KnownProviders`/`TokenReader` are fully exercised; the `fairy-shell` glue files are not in this path and are excluded by convention).

---

## Self-Review

**1. Spec coverage.**
- Redacted decode / payload encode (`RedactedConfig`, `PiConfigPayload`, nil-omit) → Task 2.
- Curated provider ids + custom → `KnownProviders` (Task 3) + `SettingsForm.from` union (Task 4) + the "Add custom provider" row (Task 6 view).
- The merge contract (blank-keeps, typed-replaces, removed/empty-omitted; defaults + enabledModels include-when-nonempty) → `SettingsForm.buildUpdate` (Task 4) with the full test matrix.
- `SettingsClient` load/save over bearer GET/PUT, error taxonomy (`unreachable`/`unauthorized`/`server`/`decode`) → Task 5; `HTTPTransport.put` → Task 5; secrets-never-round-trip is structural (the form only holds `hasKey` + typed input; never reads a key) → Tasks 4–6.
- Window opened from the status menu, explicit Save + status line, load-failure Retry state → Task 6 (`SettingsView`/`SettingsViewModel`/`SettingsWindowController`/`AppDelegate`).
- Shared token read (DRY) → `TokenReader` (Task 1), used by both clients.
- Coverage ≥90% on `FairyShell`; glue excluded → Task 7.
  No spec requirement is left without a task.

**2. Placeholder scan.** Every code step shows complete Swift (full file bodies for new files; exact insertions for modified ones). The one runtime-only step (Task 6 step 6 manual smoke) is explicitly a human glue check. No "TBD"/"add validation"/"similar to Task N".

**3. Type consistency.** `RedactedConfig`/`RedactedProvider`/`PiConfigPayload`/`ProviderPayload` (Task 2) are consumed by `SettingsForm` (Task 4) and `SettingsClient` (Task 5) and constructed in their tests with the same initializers. `ProviderRow` fields (`id`/`hasKey`/`keyInput`/`removed`, Task 4) match the view's bindings (Task 6). `SettingsClient(baseURL:tokenURL:transport:)` (Task 5) matches the `AppDelegate` construction (Task 6) and mirrors `StatusClient`'s signature. `HTTPTransport.put(_:bearer:body:)` (Task 5 protocol) matches `FakeTransport.put` (Task 5 test) and `URLSessionTransport.put` (Task 6). `SettingsError` cases (Task 5) match `SettingsViewModel.describe` (Task 6). `TokenReader.read(from:)` (Task 1) is called by both `StatusClient` (Task 1 refactor) and `SettingsClient` (Task 5).
