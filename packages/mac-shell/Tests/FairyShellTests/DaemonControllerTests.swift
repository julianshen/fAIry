import XCTest
@testable import FairyShell

final class FakeLauncher: DaemonLauncher {
  private(set) var launchCount = 0
  private(set) var terminateCount = 0
  var throwOnLaunch = false
  private var onExit: (() -> Void)?
  func launch(_ config: DaemonLaunchConfig, onExit: @escaping () -> Void) throws {
    if throwOnLaunch { throw NSError(domain: "test", code: 1) }
    launchCount += 1; self.onExit = onExit
  }
  func terminate() { terminateCount += 1 }
  func simulateExit() { onExit?() }
}

final class FakeStatus: StatusProbing {
  private var queue: [DaemonHealth]
  init(_ healths: [DaemonHealth]) { queue = healths }
  func probe() async -> DaemonHealth { queue.count > 1 ? queue.removeFirst() : (queue.first ?? .unreachable) }
}

private func makeConfig() -> DaemonLaunchConfig {
  DaemonLaunchConfig(executable: "bun", arguments: ["run", "src/main.ts"], workdir: URL(fileURLWithPath: "/tmp"))
}

final class DaemonControllerTests: XCTestCase {
  func testAdoptsAlreadyHealthyDaemonWithoutLaunching() async {
    let launcher = FakeLauncher()
    let c = DaemonController(launcher: launcher, status: FakeStatus([.healthy]), config: makeConfig(),
                            maxStartupPolls: 5, sleep: { _ in })
    await c.start()
    XCTAssertEqual(c.state, .running)
    XCTAssertEqual(launcher.launchCount, 0)
  }

  func testSpawnsThenRunsOnFirstHealthyPoll() async {
    let launcher = FakeLauncher()
    let c = DaemonController(launcher: launcher, status: FakeStatus([.unreachable, .unreachable, .healthy]),
                            config: makeConfig(), maxStartupPolls: 5, sleep: { _ in })
    await c.start()
    XCTAssertEqual(c.state, .running)
    XCTAssertEqual(launcher.launchCount, 1)
  }

  func testFailsWhenLaunchThrows() async {
    let launcher = FakeLauncher(); launcher.throwOnLaunch = true
    let c = DaemonController(launcher: launcher, status: FakeStatus([.unreachable]), config: makeConfig(),
                            maxStartupPolls: 5, sleep: { _ in })
    await c.start()
    if case .failed = c.state {} else { XCTFail("expected .failed, got \(c.state)") }
  }

  func testFailsWhenNeverHealthy() async {
    let c = DaemonController(launcher: FakeLauncher(), status: FakeStatus([.unreachable]), config: makeConfig(),
                            maxStartupPolls: 3, sleep: { _ in })
    await c.start()
    if case .failed = c.state {} else { XCTFail("expected .failed") }
  }

  func testUnauthorizedFailsFast() async {
    let c = DaemonController(launcher: FakeLauncher(), status: FakeStatus([.unreachable, .unauthorized]),
                            config: makeConfig(), maxStartupPolls: 10, sleep: { _ in })
    await c.start()
    if case .failed = c.state {} else { XCTFail("expected .failed") }
  }

  func testUnexpectedExitFails() async {
    let launcher = FakeLauncher()
    let c2 = DaemonController(launcher: launcher, status: FakeStatus([.unreachable, .healthy]),
                             config: makeConfig(), maxStartupPolls: 5, sleep: { _ in })
    await c2.start()
    XCTAssertEqual(c2.state, .running)
    launcher.simulateExit()
    if case .failed = c2.state {} else { XCTFail("expected .failed after exit, got \(c2.state)") }
  }

  func testStopTerminatesSpawnedAndGoesStopped() async {
    let launcher = FakeLauncher()
    let c = DaemonController(launcher: launcher, status: FakeStatus([.unreachable, .healthy]),
                            config: makeConfig(), maxStartupPolls: 5, sleep: { _ in })
    await c.start()
    c.stop()
    XCTAssertEqual(c.state, .stopped)
    XCTAssertEqual(launcher.terminateCount, 1)
  }

  func testStopLeavesAdoptedDaemonRunning() async {
    let launcher = FakeLauncher()
    let c = DaemonController(launcher: launcher, status: FakeStatus([.healthy]), config: makeConfig(),
                            maxStartupPolls: 5, sleep: { _ in })
    await c.start()
    c.stop()
    XCTAssertEqual(c.state, .stopped)
    XCTAssertEqual(launcher.terminateCount, 0)
  }

  func testRestartStopsThenStarts() async {
    let launcher = FakeLauncher()
    // start: unreachable→healthy (spawn+adopt healthy); restart's start: unreachable→healthy (spawn again)
    let c = DaemonController(launcher: launcher,
                            status: FakeStatus([.unreachable, .healthy, .unreachable, .healthy]),
                            config: makeConfig(), maxStartupPolls: 5, sleep: { _ in })
    await c.start()
    XCTAssertEqual(c.state, .running)
    XCTAssertEqual(launcher.launchCount, 1)
    await c.restart()
    XCTAssertEqual(c.state, .running)
    XCTAssertEqual(launcher.terminateCount, 1) // stop() terminated the spawned daemon
    XCTAssertEqual(launcher.launchCount, 2)    // start() spawned again
  }

  func testEmitsStateChangesToObserver() async {
    let launcher = FakeLauncher()
    let c = DaemonController(launcher: launcher, status: FakeStatus([.unreachable, .healthy]),
                            config: makeConfig(), maxStartupPolls: 5, sleep: { _ in })
    var observed: [DaemonState] = []
    c.onState = { observed.append($0) }
    await c.start()
    XCTAssertEqual(observed, [.starting, .running])
  }
}
