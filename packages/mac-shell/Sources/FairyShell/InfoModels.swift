import Foundation

/// The daemon's connection info from `GET /info`: the ephemeral WS ports.
public struct DaemonInfo: Decodable, Equatable, Sendable {
  public let bridgePort: Int
  public let conversationPort: Int
  public init(bridgePort: Int, conversationPort: Int) {
    self.bridgePort = bridgePort; self.conversationPort = conversationPort
  }
}
