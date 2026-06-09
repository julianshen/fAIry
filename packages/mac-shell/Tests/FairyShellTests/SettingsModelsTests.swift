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
    XCTAssertEqual(Set(obj.keys), ["providers"])
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
