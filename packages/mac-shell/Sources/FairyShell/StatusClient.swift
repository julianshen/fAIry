import Foundation

/// Abstraction the controller polls.
public protocol StatusProbing: Sendable {
  func probe() async -> DaemonHealth
}

/// Probes the daemon's bearer-authenticated `GET /status`, reading the shell
/// token from `token.json`. Pure logic — transport + token path injected.
public struct StatusClient: StatusProbing {
  private let statusURL: URL
  private let tokenURL: URL
  private let transport: HTTPTransport

  public init(baseURL: URL, tokenURL: URL, transport: HTTPTransport) {
    self.statusURL = baseURL.appendingPathComponent("status")
    self.tokenURL = tokenURL
    self.transport = transport
  }

  public func probe() async -> DaemonHealth {
    guard let token = readToken() else { return .unreachable }
    guard let (status, _) = await transport.get(statusURL, bearer: token) else { return .unreachable }
    switch status {
    case 200: return .healthy
    case 401: return .unauthorized
    default: return .unreachable
    }
  }

  private func readToken() -> String? { TokenReader.read(from: tokenURL) }
}
