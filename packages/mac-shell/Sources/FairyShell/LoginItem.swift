import Foundation

/// The OS-level "open at login" registration, abstracted so the toggle logic is
/// testable without `SMAppService` (which only functions from a signed .app).
public protocol LoginItemService {
  var isEnabled: Bool { get }
  func enable() throws
  func disable() throws
}

/// Toggles launch-at-login and reports the resulting state. On a thrown
/// enable/disable it leaves the state as the service reports (no optimistic flip),
/// so the UI stays truthful.
public final class LoginItemController {
  private let service: LoginItemService
  public init(service: LoginItemService) { self.service = service }

  public var isEnabled: Bool { service.isEnabled }

  @discardableResult
  public func toggle() -> Bool {
    do {
      if service.isEnabled { try service.disable() } else { try service.enable() }
    } catch {
      // Leave the state as the service reports it; return the real status below.
    }
    return service.isEnabled
  }
}
