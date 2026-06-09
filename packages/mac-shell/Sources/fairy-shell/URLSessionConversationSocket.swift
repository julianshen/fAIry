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
    let t = URLSession.shared.webSocketTask(with: url)
    task = t
    t.resume()
    openHandler?()       // sends queue until the socket actually connects
    receive()
  }

  private func receive() {
    task?.receive { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(let message):
        if case .string(let text) = message { self.textHandler?(text) }
        self.receive()
      case .failure:
        self.fireClose()
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
