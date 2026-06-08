import Foundation

/// Resolves the daemon's application-data directory, mirroring the daemon's
/// `resolvePaths` precedence so the shell reads the SAME files the daemon wrote
/// (`token.json`, `pairing.json`): an explicit `FAIRY_HOME` wins; otherwise the
/// macOS convention `~/Library/Application Support/<brand>`. macOS-only — the
/// shell is AppKit; the daemon owns the cross-platform (Windows/XDG) cases.
public enum AppPaths {
  /// Brand directory name — capital "AI" matches the daemon's `APP_DIR`.
  static let appDir = "fAIry"

  public static func appData(env: [String: String], home: URL) -> URL {
    if let override = env["FAIRY_HOME"]?.trimmingCharacters(in: .whitespacesAndNewlines),
       !override.isEmpty {
      return URL(fileURLWithPath: override)
    }
    return home
      .appendingPathComponent("Library/Application Support")
      .appendingPathComponent(appDir)
  }
}
