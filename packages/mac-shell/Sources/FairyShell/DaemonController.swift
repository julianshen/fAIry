import Foundation

/// Brings the daemon up (adopting an already-healthy one, else spawning) and
/// tracks its health as a DaemonState. All I/O is injected, so the state machine
/// is unit-tested without real processes or networking.
public final class DaemonController {
  private let launcher: DaemonLauncher
  private let status: StatusProbing
  private let config: DaemonLaunchConfig
  private let maxStartupPolls: Int
  private let pollIntervalMs: Int
  private let sleep: (Int) async -> Void

  private var spawned = false   // true only when we launched it (so stop() terminates)
  private var stopping = false  // guards onExit during an intentional stop

  public private(set) var state: DaemonState = .stopped {
    didSet { if state != oldValue { onState?(state) } }
  }
  public var onState: ((DaemonState) -> Void)?

  public init(
    launcher: DaemonLauncher,
    status: StatusProbing,
    config: DaemonLaunchConfig,
    pollIntervalMs: Int = 300,
    maxStartupPolls: Int = 30,
    sleep: @escaping (Int) async -> Void = { ms in try? await Task.sleep(nanoseconds: UInt64(ms) * 1_000_000) }
  ) {
    self.launcher = launcher; self.status = status; self.config = config
    self.pollIntervalMs = pollIntervalMs; self.maxStartupPolls = maxStartupPolls; self.sleep = sleep
  }

  public func start() async {
    stopping = false
    if await status.probe() == .healthy { spawned = false; state = .running; return }
    state = .starting
    do {
      try launcher.launch(config) { [weak self] in self?.handleExit() }
      spawned = true
    } catch {
      state = .failed("could not start the daemon: \(error.localizedDescription)")
      return
    }
    for _ in 0..<maxStartupPolls {
      await sleep(pollIntervalMs)
      if case .stopped = state { return }
      switch await status.probe() {
      case .healthy: state = .running; return
      case .unauthorized: state = .failed("daemon rejected the shell token"); return
      case .unreachable: continue
      }
    }
    state = .failed("daemon did not become healthy")
  }

  public func restart() async { stop(); await start() }

  public func stop() {
    stopping = true
    if spawned { launcher.terminate() }
    spawned = false
    state = .stopped
  }

  private func handleExit() {
    if stopping { return }
    if state == .running || state == .starting { state = .failed("daemon exited") }
  }
}
