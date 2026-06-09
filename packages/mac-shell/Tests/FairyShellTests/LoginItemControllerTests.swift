import XCTest
@testable import FairyShell

/// A fake login-item service: tracks calls and can simulate a thrown register/unregister.
final class FakeLoginItemService: LoginItemService {
  var isEnabled: Bool
  var throwOnEnable = false
  var throwOnDisable = false
  private(set) var enableCount = 0
  private(set) var disableCount = 0
  init(isEnabled: Bool) { self.isEnabled = isEnabled }
  func enable() throws {
    enableCount += 1
    if throwOnEnable { throw NSError(domain: "test", code: 1) }
    isEnabled = true
  }
  func disable() throws {
    disableCount += 1
    if throwOnDisable { throw NSError(domain: "test", code: 1) }
    isEnabled = false
  }
}

final class LoginItemControllerTests: XCTestCase {
  func testEnablesWhenDisabled() {
    let s = FakeLoginItemService(isEnabled: false)
    let c = LoginItemController(service: s)
    XCTAssertTrue(c.toggle())
    XCTAssertEqual(s.enableCount, 1)
    XCTAssertEqual(s.disableCount, 0)
    XCTAssertTrue(c.isEnabled)
  }

  func testDisablesWhenEnabled() {
    let s = FakeLoginItemService(isEnabled: true)
    let c = LoginItemController(service: s)
    XCTAssertFalse(c.toggle())
    XCTAssertEqual(s.disableCount, 1)
    XCTAssertFalse(c.isEnabled)
  }

  func testEnableThrowLeavesDisabled() {
    let s = FakeLoginItemService(isEnabled: false); s.throwOnEnable = true
    let c = LoginItemController(service: s)
    XCTAssertFalse(c.toggle())
    XCTAssertFalse(c.isEnabled)
  }

  func testDisableThrowLeavesEnabled() {
    let s = FakeLoginItemService(isEnabled: true); s.throwOnDisable = true
    let c = LoginItemController(service: s)
    XCTAssertTrue(c.toggle())
    XCTAssertTrue(c.isEnabled)
  }

  func testIsEnabledDelegatesToService() {
    XCTAssertTrue(LoginItemController(service: FakeLoginItemService(isEnabled: true)).isEnabled)
    XCTAssertFalse(LoginItemController(service: FakeLoginItemService(isEnabled: false)).isEnabled)
  }
}
