import Foundation

/// Why a settings load/save could not complete.
public enum SettingsError: Error, Equatable, Sendable {
  case unreachable          // no token, or a transport-level connection error
  case unauthorized         // 401 — token mismatch
  case server(status: Int)  // any other non-200
  case decode               // 200 but the body wasn't the expected JSON
}

/// Loads/saves the daemon's settings over the bearer-authenticated control plane.
/// Pure logic — the token path + transport are injected (mirrors `StatusClient`).
public struct SettingsClient: Sendable {
  private let settingsURL: URL
  private let tokenURL: URL
  private let transport: HTTPTransport

  public init(baseURL: URL, tokenURL: URL, transport: HTTPTransport) {
    self.settingsURL = baseURL.appendingPathComponent("settings")
    self.tokenURL = tokenURL
    self.transport = transport
  }

  /// `GET /settings` → the redacted config.
  public func load() async -> Result<RedactedConfig, SettingsError> {
    guard let token = TokenReader.read(from: tokenURL) else { return .failure(.unreachable) }
    guard let (status, body) = await transport.get(settingsURL, bearer: token) else { return .failure(.unreachable) }
    return decode(status: status, body: body)
  }

  /// `PUT /settings` with the payload → the re-redacted config.
  public func save(_ payload: PiConfigPayload) async -> Result<RedactedConfig, SettingsError> {
    guard let token = TokenReader.read(from: tokenURL) else { return .failure(.unreachable) }
    guard let data = try? JSONEncoder().encode(payload) else { return .failure(.decode) }
    guard let (status, body) = await transport.put(settingsURL, bearer: token, body: data) else { return .failure(.unreachable) }
    return decode(status: status, body: body)
  }

  private func decode(status: Int, body: Data) -> Result<RedactedConfig, SettingsError> {
    switch status {
    case 200:
      guard let cfg = try? JSONDecoder().decode(RedactedConfig.self, from: body) else { return .failure(.decode) }
      return .success(cfg)
    case 401: return .failure(.unauthorized)
    default: return .failure(.server(status: status))
    }
  }
}
