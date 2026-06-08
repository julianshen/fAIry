import Foundation

/// Minimal GET seam so StatusClient is testable without real networking.
/// Returns (HTTP status, body) or nil on a connection-level error.
public protocol HTTPTransport: Sendable {
  func get(_ url: URL, bearer: String) async -> (status: Int, body: Data)?
}
