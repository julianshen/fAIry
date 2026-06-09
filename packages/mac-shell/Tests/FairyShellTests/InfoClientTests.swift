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
  func testDecodeErrorOnOutOfRangePort() async {
    let zero = await client(FakeTransport((status: 200, body: Data(#"{"bridgePort":0,"conversationPort":222}"#.utf8)))).fetch()
    XCTAssertEqual(zero, .failure(.decode))
    let huge = await client(FakeTransport((status: 200, body: Data(#"{"bridgePort":111,"conversationPort":70000}"#.utf8)))).fetch()
    XCTAssertEqual(huge, .failure(.decode))
  }
}
