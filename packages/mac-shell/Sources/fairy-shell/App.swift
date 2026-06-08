import AppKit

/// Entry point. `@main` + `@MainActor` so the AppKit setup (which is main-actor
/// isolated) runs on the main actor. A file named `main.swift` can't use `@main`,
/// hence this separate file.
@main
@MainActor
enum FairyShellApp {
  static func main() {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory) // menu-bar only, no Dock icon
    let delegate = AppDelegate()
    app.delegate = delegate
    app.run()
  }
}
