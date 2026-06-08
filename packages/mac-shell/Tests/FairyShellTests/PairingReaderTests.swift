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
