import XCTest
@testable import FairyShell

final class DaemonLocatorTests: XCTestCase {
  private let resources = URL(fileURLWithPath: "/App/Contents/Resources")
  private let dev = URL(fileURLWithPath: "/repo/packages")

  func testBundledWhenDaemonPresent() {
    let cfg = DaemonLocator.resolve(resourcesURL: resources, devPackagesDir: dev,
                                    exists: { $0.lastPathComponent == "fairy-daemon" })
    XCTAssertEqual(cfg.executable, "/App/Contents/Resources/fairy-daemon")
    XCTAssertTrue(cfg.arguments.isEmpty)
    XCTAssertEqual(cfg.workdir.path, "/App/Contents/Resources")
    XCTAssertEqual(cfg.environment["FAIRY_BROWSER_BRIDGE"], "/App/Contents/Resources/browser-bridge.ts")
    XCTAssertEqual(cfg.environment["FAIRY_SKILLS_ROOT"], "/App/Contents/Resources/skills")
  }

  func testDevWhenDaemonAbsent() {
    let cfg = DaemonLocator.resolve(resourcesURL: resources, devPackagesDir: dev, exists: { _ in false })
    XCTAssertEqual(cfg.executable, "bun")
    XCTAssertEqual(cfg.arguments, ["run", "src/main.ts"])
    XCTAssertEqual(cfg.workdir.path, "/repo/packages/pi-daemon")
    XCTAssertTrue(cfg.environment.isEmpty)
  }

  func testDevWhenNoResourcesURL() {
    let cfg = DaemonLocator.resolve(resourcesURL: nil, devPackagesDir: dev, exists: { _ in true })
    XCTAssertEqual(cfg.executable, "bun")
    XCTAssertEqual(cfg.workdir.path, "/repo/packages/pi-daemon")
  }
}
