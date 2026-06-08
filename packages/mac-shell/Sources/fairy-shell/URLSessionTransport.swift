import Foundation
import FairyShell

/// Real loopback HTTP GET via URLSession. nil on a connection error.
struct URLSessionTransport: HTTPTransport {
  func get(_ url: URL, bearer: String) async -> (status: Int, body: Data)? {
    var req = URLRequest(url: url)
    req.httpMethod = "GET"
    req.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
    req.timeoutInterval = 2
    guard let (data, resp) = try? await URLSession.shared.data(for: req),
          let http = resp as? HTTPURLResponse else { return nil }
    return (http.statusCode, data)
  }
}
