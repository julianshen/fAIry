import Foundation
import FairyShell

/// Launches the daemon via Foundation Process, resolving the executable on PATH
/// through /usr/bin/env (so `bun` is found without an absolute path).
final class ProcessDaemonLauncher: DaemonLauncher {
  private var process: Process?

  func launch(_ config: DaemonLaunchConfig, onExit: @escaping @MainActor () -> Void) throws {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    p.arguments = [config.executable] + config.arguments
    p.currentDirectoryURL = config.workdir
    p.environment = ProcessInfo.processInfo.environment.merging(config.environment) { _, new in new }
    // terminationHandler runs on a private background queue; hop to the main
    // actor to satisfy onExit's isolation (the controller's state lives there).
    p.terminationHandler = { _ in Task { @MainActor in onExit() } }
    try p.run()
    process = p
  }

  func terminate() {
    process?.terminationHandler = nil
    process?.terminate()
    process = nil
  }
}
