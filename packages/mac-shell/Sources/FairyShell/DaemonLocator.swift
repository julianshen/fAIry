import Foundation

/// Decides how to launch the daemon: the bundled `fairy-daemon` binary (in the
/// .app's `Contents/Resources`) when present — pointed at its bundled assets via
/// env — otherwise the dev `bun run src/main.ts` from the source tree. Pure: the
/// `exists` probe and paths are injected, so it's unit-tested without a real bundle.
public enum DaemonLocator {
  public static func resolve(resourcesURL: URL?, devPackagesDir: URL,
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
          ]
        )
      }
    }
    return DaemonLaunchConfig(
      executable: "bun",
      arguments: ["run", "src/main.ts"],
      workdir: devPackagesDir.appendingPathComponent("pi-daemon")
    )
  }
}
