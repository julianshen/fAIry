import Foundation

/// The daemon's connection info from `GET /info`: the ephemeral WS ports.
public struct DaemonInfo: Decodable, Equatable, Sendable {
  public let bridgePort: Int
  public let conversationPort: Int
  public init(bridgePort: Int, conversationPort: Int) {
    self.bridgePort = bridgePort; self.conversationPort = conversationPort
  }

  private enum CodingKeys: String, CodingKey { case bridgePort, conversationPort }

  /// Reject out-of-range ports at the decode boundary, so a half-started or
  /// malformed daemon payload fails fast (→ `.decode`, then the Retry overlay)
  /// instead of leaking an invalid port into a `ws://127.0.0.1:0` connect.
  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    let bridge = try c.decode(Int.self, forKey: .bridgePort)
    let conversation = try c.decode(Int.self, forKey: .conversationPort)
    guard (1...65_535).contains(bridge), (1...65_535).contains(conversation) else {
      throw DecodingError.dataCorrupted(.init(
        codingPath: c.codingPath, debugDescription: "ports must be in 1...65535"))
    }
    self.bridgePort = bridge
    self.conversationPort = conversation
  }
}
