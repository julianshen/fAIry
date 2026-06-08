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
                              tokenURL: tokenFile(nil),
                              transport: FakeTransport((status: 200, body: Data())))
    let health = await client.probe()
    XCTAssertEqual(health, .unreachable)
  }
}
