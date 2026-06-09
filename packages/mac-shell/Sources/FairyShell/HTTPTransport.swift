import Foundation

/// Minimal GET/PUT seam so the clients are testable without real networking.
/// Returns (HTTP status, body) or nil on a connection-level error.
public protocol HTTPTransport: Sendable {
  func get(_ url: URL, bearer: String) async -> (status: Int, body: Data)?
  func put(_ url: URL, bearer: String, body: Data) async -> (status: Int, body: Data)?
}
