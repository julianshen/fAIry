import Foundation
import FairyShell

/// Launches the daemon via Foundation Process, resolving the executable on PATH
/// through /usr/bin/env (so `bun` is found without an absolute path).
final class ProcessDaemonLauncher: DaemonLauncher {
  private var process: Process?

  func launch(_ config: DaemonLaunchConfig, onExit: @escaping () -> Void) throws {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    p.arguments = [config.executable] + config.arguments
    p.currentDirectoryURL = config.workdir
    p.environment = ProcessInfo.processInfo.environment.merging(config.environment) { _, new in new }
    p.terminationHandler = { _ in onExit() }
    try p.run()
    process = p
  }

  func terminate() {
    process?.terminationHandler = nil
    process?.terminate()
    process = nil
  }
}
