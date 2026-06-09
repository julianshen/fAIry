import XCTest
@testable import FairyShell

final class DaemonLocatorTests: XCTestCase {
  private let resources = URL(fileURLWithPath: "/App/Contents/Resources")
  private let dev = URL(fileURLWithPath: "/repo/packages")
  private let home = URL(fileURLWithPath: "/Users/alex")

  private func resolve(_ resourcesURL: URL?, path: String = "/usr/bin:/bin",
                       exists: @escaping (URL) -> Bool) -> DaemonLaunchConfig {
    DaemonLocator.resolve(resourcesURL: resourcesURL, devPackagesDir: dev,
                          homeDir: home, currentPath: path, exists: exists)
  }

  func testBundledWhenDaemonPresent() {
    let cfg = resolve(resources, exists: { $0.lastPathComponent == "fairy-daemon" })
    XCTAssertEqual(cfg.executable, "/App/Contents/Resources/fairy-daemon")
    XCTAssertTrue(cfg.arguments.isEmpty)
    XCTAssertEqual(cfg.workdir.path, "/App/Contents/Resources")
    XCTAssertEqual(cfg.environment["FAIRY_BROWSER_BRIDGE"], "/App/Contents/Resources/browser-bridge.ts")
    XCTAssertEqual(cfg.environment["FAIRY_SKILLS_ROOT"], "/App/Contents/Resources/skills")
  }

  func testBundledSeedsPathWithCommonInstallDirsThenInherited() {
    let cfg = resolve(resources, path: "/usr/bin:/bin", exists: { $0.lastPathComponent == "fairy-daemon" })
    let path = cfg.environment["PATH"]
    // common user-install dirs (so a GUI-launched app finds Homebrew/npm `pi`) first…
    XCTAssertEqual(path, "/opt/homebrew/bin:/usr/local/bin:/Users/alex/.local/bin:/Users/alex/.bun/bin:/usr/bin:/bin")
  }

  func testBundledOmitsBlankInheritedPath() {
    let cfg = resolve(resources, path: "", exists: { $0.lastPathComponent == "fairy-daemon" })
    XCTAssertEqual(cfg.environment["PATH"],
                   "/opt/homebrew/bin:/usr/local/bin:/Users/alex/.local/bin:/Users/alex/.bun/bin")
  }

  func testDevWhenDaemonAbsent() {
    let cfg = resolve(resources, exists: { _ in false })
    XCTAssertEqual(cfg.executable, "bun")
    XCTAssertEqual(cfg.arguments, ["run", "src/main.ts"])
    XCTAssertEqual(cfg.workdir.path, "/repo/packages/pi-daemon")
    XCTAssertTrue(cfg.environment.isEmpty)   // dev inherits the terminal's PATH — no override
  }

  func testDevWhenNoResourcesURL() {
    let cfg = resolve(nil, exists: { _ in true })
    XCTAssertEqual(cfg.executable, "bun")
    XCTAssertEqual(cfg.workdir.path, "/repo/packages/pi-daemon")
  }
}
