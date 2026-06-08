import Foundation

/// The result of a single health probe of the daemon's `GET /status`.
public enum DaemonHealth: Equatable, Sendable {
  case healthy        // 200
  case unauthorized   // 401 — token mismatch
  case unreachable    // connection refused, no token yet, or any other status
}

/// The shell's view of the daemon process lifecycle.
public enum DaemonState: Equatable, Sendable {
  case stopped
  case starting
  case running
  case failed(String)
}

/// How to launch the daemon in dev (a shipped bundled binary is M6).
public struct DaemonLaunchConfig: Sendable {
  public let executable: String
  public let arguments: [String]
  public let workdir: URL
  public let environment: [String: String]
  public init(executable: String, arguments: [String], workdir: URL, environment: [String: String] = [:]) {
    self.executable = executable; self.arguments = arguments; self.workdir = workdir; self.environment = environment
  }
}
