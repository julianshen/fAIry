import Foundation
import FairyShell

/// Real conversation WebSocket via `URLSessionWebSocketTask`. Sends no `Origin`
/// header, so the daemon's `isAllowedOrigin` accepts it (a WebView's `"null"`
/// origin would be rejected). `resume()` queues sends until the socket connects,
/// so we treat resume as "open" and fire the handshake immediately; a receive
/// failure (e.g. daemon down / closed) surfaces as `onClose`.
final class URLSessionConversationSocket: ConversationSocket {
  private let url: URL
  private var task: URLSessionWebSocketTask?
  private var openHandler: (() -> Void)?
  private var textHandler: ((String) -> Void)?
  private var closeHandler: (() -> Void)?
  private var didClose = false

  init(url: URL) { self.url = url }

  func onOpen(_ handler: @escaping () -> Void) { openHandler = handler }
  func onText(_ handler: @escaping (String) -> Void) { textHandler = handler }
  func onClose(_ handler: @escaping () -> Void) { closeHandler = handler }

  func connect() {
    task?.cancel(with: .goingAway, reason: nil)  // tear down any prior task (e.g. a retry)
    didClose = false                              // let this connection's close fire again
    let t = URLSession.shared.webSocketTask(with: url)
    task = t
    t.resume()
    openHandler?()       // sends queue until the socket actually connects
    receive(on: t)
  }

  private func receive(on task: URLSessionWebSocketTask) {
    task.receive { [weak self] result in
      // The receive callback fires on a background queue. Hop to main so all access
      // to task/didClose/handlers stays serialized with connect/send/close (which the
      // UI calls on main) — no data race — and so downstream WebView calls run on main.
      DispatchQueue.main.async {
        // Ignore completions from a superseded/cancelled task (a retry replaced it),
        // so a stale callback can't close the new connection.
        guard let self, task === self.task else { return }
        switch result {
        case .success(let message):
          if case .string(let text) = message { self.textHandler?(text) }
          self.receive(on: task)
        case .failure:
          self.fireClose()
        }
      }
    }
  }

  func send(_ text: String) { task?.send(.string(text)) { _ in } }

  func close() {
    task?.cancel(with: .goingAway, reason: nil)
    task = nil
    fireClose()
  }

  private func fireClose() {
    if didClose { return }
    didClose = true
    closeHandler?()
  }
}
