import Foundation

/// Reads the daemon's single-use pairing code from `pairing.json`. Pure (the URL
/// is injected) so it's unit-tested; the menu + clipboard wiring is glue.
public enum PairingReader {
  /// The current pairing code (`{ "code": String }`), or nil if the file is
  /// missing/unreadable/malformed, the code is empty, or it contains control
  /// characters / line breaks (which could corrupt or spoof the menu display).
  public static func read(from url: URL) -> String? {
    guard let data = try? Data(contentsOf: url) else { return nil }
    struct PairingFile: Decodable { let code: String }
    guard let code = (try? JSONDecoder().decode(PairingFile.self, from: data))?.code,
          !code.isEmpty else { return nil }
    let forbidden = CharacterSet.controlCharacters.union(.newlines)
    return code.rangeOfCharacter(from: forbidden) == nil ? code : nil
  }
}
