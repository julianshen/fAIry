import AppKit
import SwiftUI
import FairyShell

/// Owns the single Settings NSWindow hosting the SwiftUI `SettingsView`.
@MainActor
final class SettingsWindowController {
  private var window: NSWindow?
  private let makeClient: () -> SettingsClient
  init(makeClient: @escaping () -> SettingsClient) { self.makeClient = makeClient }

  func show() {
    if let w = window {
      w.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true); return
    }
    let model = SettingsViewModel(client: makeClient())
    let w = NSWindow(contentViewController: NSHostingController(rootView: SettingsView(model: model)))
    w.title = "Fairy Settings"
    w.styleMask = [.titled, .closable]
    w.isReleasedWhenClosed = false
    w.center()
    window = w
    w.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }
}
