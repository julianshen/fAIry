import Foundation
import ServiceManagement
import FairyShell

/// Real launch-at-login via `SMAppService.mainApp` (macOS 13+). Only functions
/// from a signed `.app`; under `swift run` (no bundle identity) `register()` throws,
/// which `LoginItemController.toggle()` swallows so the menu stays truthful.
struct SMAppServiceLoginItem: LoginItemService {
  var isEnabled: Bool { SMAppService.mainApp.status == .enabled }
  func enable() throws { try SMAppService.mainApp.register() }
  func disable() throws { try SMAppService.mainApp.unregister() }
}
