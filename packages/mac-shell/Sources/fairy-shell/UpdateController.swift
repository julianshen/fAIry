import AppKit
import Sparkle

/// Wraps Sparkle's standard updater controller, which creates the updater, starts
/// background checks (per `SUEnableAutomaticChecks`), and provides the standard
/// update UI. Reads `SUFeedURL`/`SUPublicEDKey` from the app's Info.plist.
@MainActor
final class UpdateController {
  private let controller: SPUStandardUpdaterController

  init() {
    controller = SPUStandardUpdaterController(
      startingUpdater: true,
      updaterDelegate: nil,
      userDriverDelegate: nil
    )
  }

  /// Trigger a user-initiated update check (the "Check for Updates…" menu item).
  func checkForUpdates() {
    controller.checkForUpdates(nil)
  }
}
