import AppKit
import FairyShell

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
  private var statusItem: NSStatusItem!
  private var statusMenuItem: NSMenuItem?
  private var controller: DaemonController!
  private var pairingFileURL: URL!
  private var pairingMenuItem: NSMenuItem?
  private var copyPairingItem: NSMenuItem?
  private var pairingCode: String?
  private var settingsWindow: SettingsWindowController!
  private var panelWindow: PanelWindowController!

  func applicationDidFinishLaunching(_ notification: Notification) {
    statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)

    // Mirror the daemon's path precedence (FAIRY_HOME → Application Support/fAIry)
    // so we read the same token.json / pairing.json the daemon wrote.
    let appData = AppPaths.appData(
      env: ProcessInfo.processInfo.environment,
      home: FileManager.default.homeDirectoryForCurrentUser
    )
    pairingFileURL = appData.appendingPathComponent("pairing.json")
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
    // Bundled: launch the compiled daemon from the .app's Resources (with bundled
    // asset envs). Dev: Bundle.main.resourceURL is the build dir — no fairy-daemon
    // there — so this falls back to `bun run src/main.ts`.
    let config = DaemonLocator.resolve(
      resourcesURL: Bundle.main.resourceURL,
      devPackagesDir: packagesDir,
      homeDir: FileManager.default.homeDirectoryForCurrentUser,
      currentPath: ProcessInfo.processInfo.environment["PATH"] ?? "",
      exists: { FileManager.default.fileExists(atPath: $0.path) }
    )
    let baseURL = URL(string: "http://127.0.0.1:51789")!
    let tokenURL = appData.appendingPathComponent("token.json")
    let status = StatusClient(baseURL: baseURL, tokenURL: tokenURL, transport: URLSessionTransport())
    settingsWindow = SettingsWindowController {
      SettingsClient(baseURL: baseURL, tokenURL: tokenURL, transport: URLSessionTransport())
    }
    panelWindow = PanelWindowController(baseURL: baseURL, tokenURL: tokenURL)
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
    menu.autoenablesItems = false // we manage enablement (Copy toggles with the code)
    menu.delegate = self

    let status = NSMenuItem(title: "Daemon: …", action: nil, keyEquivalent: "")
    status.isEnabled = false
    statusMenuItem = status
    menu.addItem(status)
    menu.addItem(.separator())

    let pairing = NSMenuItem(title: "Pairing code: …", action: nil, keyEquivalent: "")
    pairing.isEnabled = false
    pairingMenuItem = pairing
    menu.addItem(pairing)
    let copy = NSMenuItem(title: "Copy pairing code", action: #selector(copyPairingCode), keyEquivalent: "")
    copy.target = self
    copy.isEnabled = false
    copyPairingItem = copy
    menu.addItem(copy)
    menu.addItem(.separator())

    let panel = NSMenuItem(title: "Open Panel", action: #selector(openPanel), keyEquivalent: "o")
    panel.target = self
    menu.addItem(panel)
    menu.addItem(.separator())

    let settings = NSMenuItem(title: "Settings…", action: #selector(openSettings), keyEquivalent: ",")
    settings.target = self
    menu.addItem(settings)
    menu.addItem(.separator())

    let restart = NSMenuItem(title: "Restart daemon", action: #selector(restart), keyEquivalent: "")
    restart.target = self
    menu.addItem(restart)
    menu.addItem(.separator())

    let quit = NSMenuItem(title: "Quit Fairy", action: #selector(quit), keyEquivalent: "q")
    quit.target = self
    menu.addItem(quit)

    statusItem.menu = menu
    refreshPairing()
  }

  @objc private func restart() { Task { await controller.restart() } }
  @objc private func quit() { controller.stop(); NSApp.terminate(nil) }
  @objc private func openSettings() { settingsWindow.show() }
  @objc private func openPanel() { panelWindow.show() }

  func menuWillOpen(_ menu: NSMenu) {
    refreshPairing()
  }

  private func refreshPairing() {
    let code = PairingReader.read(from: pairingFileURL)
    pairingCode = code
    pairingMenuItem?.title = code.map { "Pairing code: \($0)" } ?? "Pairing code: (unavailable)"
    copyPairingItem?.isEnabled = (code != nil)
  }

  @objc private func copyPairingCode() {
    guard let code = pairingCode else { return }
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(code, forType: .string)
  }
}
