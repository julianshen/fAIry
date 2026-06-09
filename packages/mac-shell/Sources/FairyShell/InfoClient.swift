import Foundation

/// Fetches the daemon's `GET /info` (bearer-authenticated) to discover the
/// ephemeral conversation/bridge WS ports. Mirrors `SettingsClient`: token read
/// via `TokenReader`, transport injected; reuses `SettingsError`.
public struct InfoClient: Sendable {
  private let infoURL: URL
  private let tokenURL: URL
  private let transport: HTTPTransport

  public init(baseURL: URL, tokenURL: URL, transport: HTTPTransport) {
    self.infoURL = baseURL.appendingPathComponent("info")
    self.tokenURL = tokenURL
    self.transport = transport
  }

  public func fetch() async -> Result<DaemonInfo, SettingsError> {
    guard let token = TokenReader.read(from: tokenURL) else { return .failure(.unreachable) }
    guard let (status, body) = await transport.get(infoURL, bearer: token) else { return .failure(.unreachable) }
    switch status {
    case 200:
      guard let info = try? JSONDecoder().decode(DaemonInfo.self, from: body) else { return .failure(.decode) }
      return .success(info)
    case 401: return .failure(.unauthorized)
    default: return .failure(.server(status: status))
    }
  }
}
