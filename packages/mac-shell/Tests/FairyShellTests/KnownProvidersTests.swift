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
