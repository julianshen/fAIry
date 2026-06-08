import Foundation

/// Reads the daemon's single-use pairing code from `pairing.json`. Pure (the URL
/// is injected) so it's unit-tested; the menu + clipboard wiring is glue.
public enum PairingReader {
  /// The current pairing code (`{ "code": String }`), or nil if the file is
  /// missing/unreadable/malformed or the code is empty.
  public static func read(from url: URL) -> String? {
    guard let data = try? Data(contentsOf: url) else { return nil }
    struct PairingFile: Decodable { let code: String }
    let code = (try? JSONDecoder().decode(PairingFile.self, from: data))?.code
    return (code?.isEmpty == false) ? code : nil
  }
}
