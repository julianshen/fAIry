import Foundation

/// Decides how to launch the daemon: the bundled `fairy-daemon` binary (in the
/// .app's `Contents/Resources`) when present — pointed at its bundled assets via
/// env — otherwise the dev `bun run src/main.ts` from the source tree. Pure: the
/// `exists` probe and paths are injected, so it's unit-tested without a real bundle.
public enum DaemonLocator {
  public static func resolve(resourcesURL: URL?, devPackagesDir: URL,
                             homeDir: URL, currentPath: String,
                             exists: (URL) -> Bool) -> DaemonLaunchConfig {
    if let resources = resourcesURL {
      let daemon = resources.appendingPathComponent("fairy-daemon")
      if exists(daemon) {
        return DaemonLaunchConfig(
          executable: daemon.path,
          arguments: [],
          workdir: resources,
          environment: [
            "FAIRY_BROWSER_BRIDGE": resources.appendingPathComponent("browser-bridge.ts").path,
            "FAIRY_SKILLS_ROOT": resources.appendingPathComponent("skills").path,
            "FAIRY_PI_BIN": resources.appendingPathComponent("fairy-pi").path,
            "PATH": seededPath(home: homeDir, inherited: currentPath),
          ]
        )
      }
    }
    // Dev: launched from a terminal, so the inherited PATH already finds `pi`/`bun`.
    return DaemonLaunchConfig(
      executable: "bun",
      arguments: ["run", "src/main.ts"],
      workdir: devPackagesDir.appendingPathComponent("pi-daemon")
    )
  }

  /// A GUI-launched `.app` (Finder / Login Item) inherits launchd's minimal PATH
  /// — no Homebrew/npm — but the daemon spawns the external `pi` via PATH. Prepend
  /// the common user-install locations so a normally-installed `pi` is found, then
  /// keep the inherited PATH after them.
  static func seededPath(home: URL, inherited: String) -> String {
    var dirs = [
      "/opt/homebrew/bin",                                   // Apple Silicon Homebrew
      "/usr/local/bin",                                      // Intel Homebrew / common installs
      home.appendingPathComponent(".local/bin").path,        // pip / pipx / user installs
      home.appendingPathComponent(".bun/bin").path,          // bun-installed tools
    ]
    if !inherited.isEmpty { dirs.append(inherited) }
    return dirs.joined(separator: ":")
  }
}
