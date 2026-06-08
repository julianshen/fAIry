import XCTest
@testable import FairyShell

final class SettingsFormTests: XCTestCase {
  // MARK: from()
  func testFromUnionsRedactedAndKnown() {
    let redacted = RedactedConfig(providers: [RedactedProvider(id: "custom", hasKey: true)])
    let form = SettingsForm.from(redacted, known: ["anthropic", "custom"])
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
    XCTAssertEqual(form.buildUpdate().providers, [ProviderPayload(id: "anthropic", apiKey: "")])
  }
  func testTypedKeyReplaces() {
    let form = SettingsForm(providers: [ProviderRow(id: "openai", hasKey: false, keyInput: "sk-new")])
    XCTAssertEqual(form.buildUpdate().providers, [ProviderPayload(id: "openai", apiKey: "sk-new")])
  }
  func testRemovedRowOmitted() {
    let form = SettingsForm(providers: [ProviderRow(id: "anthropic", hasKey: true, keyInput: "", removed: true)])
    XCTAssertEqual(form.buildUpdate().providers, [])
  }
  func testEmptyCuratedRowOmitted() {
    let form = SettingsForm(providers: [ProviderRow(id: "google", hasKey: false, keyInput: "  ")])
    XCTAssertEqual(form.buildUpdate().providers, [])
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
