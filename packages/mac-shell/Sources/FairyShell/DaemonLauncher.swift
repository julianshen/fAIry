import Foundation

/// Starts/stops the daemon child process. Real impl (Process) lives in the
/// executable; tests inject a fake.
public protocol DaemonLauncher: AnyObject {
  /// Launch the daemon. `onExit` fires if the process terminates on its own; it
  /// is `@MainActor`-isolated, so the real launcher MUST deliver it on the main
  /// actor (the controller's state is main-actor isolated).
  func launch(_ config: DaemonLaunchConfig, onExit: @escaping @MainActor () -> Void) throws
  func terminate()
}
