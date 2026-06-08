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
