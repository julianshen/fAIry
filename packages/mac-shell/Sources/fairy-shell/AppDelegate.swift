import AppKit
import FairyShell

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
  private var statusItem: NSStatusItem!
  private var statusMenuItem: NSMenuItem?
  private var controller: DaemonController!

  func applicationDidFinishLaunching(_ notification: Notification) {
    statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)

    let appData = FileManager.default.homeDirectoryForCurrentUser
      .appendingPathComponent("Library/Application Support/fairy")
    // Dev: run from packages/mac-shell, so cwd/.. is packages/ and ../pi-daemon is the daemon.
    // Dev: resolve the daemon relative to THIS source file (baked in at build),
    // so it works regardless of the launch CWD (Xcode/Finder/terminal). The
    // shipped build bundles the daemon binary instead — that's M6.
    // #filePath = …/packages/mac-shell/Sources/fairy-shell/AppDelegate.swift
    let packagesDir = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent() // fairy-shell/
      .deletingLastPathComponent() // Sources/
      .deletingLastPathComponent() // mac-shell/
      .deletingLastPathComponent() // packages/
    let config = DaemonLaunchConfig(
      executable: "bun",
      arguments: ["run", "src/main.ts"],
      workdir: packagesDir.appendingPathComponent("pi-daemon")
    )
    let status = StatusClient(
      baseURL: URL(string: "http://127.0.0.1:51789")!,
      tokenURL: appData.appendingPathComponent("token.json"),
      transport: URLSessionTransport()
    )
    controller = DaemonController(launcher: ProcessDaemonLauncher(), status: status, config: config)
    controller.onState = { [weak self] state in
      DispatchQueue.main.async { self?.render(state) }
    }

    buildMenu()
    render(.stopped)
    Task { await controller.start() }
  }

  private func render(_ state: DaemonState) {
    let glyph: String
    let line: String
    switch state {
    case .stopped: glyph = "○"; line = "Daemon: stopped"
    case .starting: glyph = "◌"; line = "Daemon: starting…"
    case .running: glyph = "●"; line = "Daemon: running"
    case .failed(let why): glyph = "⚠"; line = "Daemon: failed — \(why)"
    }
    statusItem.button?.title = "🧚\(glyph)"
    statusMenuItem?.title = line
  }

  private func buildMenu() {
    let menu = NSMenu()
    let status = NSMenuItem(title: "Daemon: …", action: nil, keyEquivalent: "")
    status.isEnabled = false
    statusMenuItem = status
    menu.addItem(status)
    menu.addItem(.separator())
    menu.addItem(NSMenuItem(title: "Restart daemon", action: #selector(restart), keyEquivalent: ""))
    menu.addItem(.separator())
    menu.addItem(NSMenuItem(title: "Quit Fairy", action: #selector(quit), keyEquivalent: "q"))
    for item in menu.items where item.action != nil { item.target = self }
    statusItem.menu = menu
  }

  @objc private func restart() { Task { await controller.restart() } }
  @objc private func quit() { controller.stop(); NSApp.terminate(nil) }
}
