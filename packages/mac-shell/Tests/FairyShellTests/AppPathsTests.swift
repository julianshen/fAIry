import XCTest
@testable import FairyShell

final class AppPathsTests: XCTestCase {
  private let home = URL(fileURLWithPath: "/Users/alex")

  func testDefaultsToApplicationSupportBrandDir() {
    let p = AppPaths.appData(env: [:], home: home)
    XCTAssertEqual(p.path, "/Users/alex/Library/Application Support/fAIry")
  }

  func testFairyHomeOverrideWins() {
    let p = AppPaths.appData(env: ["FAIRY_HOME": "/tmp/custom"], home: home)
    XCTAssertEqual(p.path, "/tmp/custom")
  }

  func testBlankFairyHomeIsIgnored() {
    let p = AppPaths.appData(env: ["FAIRY_HOME": "   "], home: home)
    XCTAssertEqual(p.path, "/Users/alex/Library/Application Support/fAIry")
  }
}
