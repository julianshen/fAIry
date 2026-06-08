import Foundation

/// Reads the shell's bearer token from `token.json` (`{ "token": String }`).
/// Pure (URL injected) and shared by `StatusClient` + `SettingsClient`.
public enum TokenReader {
  /// The token, or nil if the file is missing/unreadable/malformed or empty.
  public static func read(from url: URL) -> String? {
    guard let data = try? Data(contentsOf: url) else { return nil }
    struct TokenFile: Decodable { let token: String }
    let token = (try? JSONDecoder().decode(TokenFile.self, from: data))?.token
    return (token?.isEmpty == false) ? token : nil
  }
}
