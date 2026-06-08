import Foundation

/// Starts/stops the daemon child process. Real impl (Process) lives in the
/// executable; tests inject a fake.
public protocol DaemonLauncher: AnyObject {
  func launch(_ config: DaemonLaunchConfig, onExit: @escaping () -> Void) throws
  func terminate()
}
