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
