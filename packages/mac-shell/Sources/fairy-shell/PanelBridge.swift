import WebKit

/// Forwards panel command messages from the WebView's JS (`window.webkit
/// .messageHandlers.fairy.postMessage(...)`) to a handler the window controller
/// owns. Registered before the page loads so the handler exists when the panel posts.
@MainActor
final class PanelBridge: NSObject, WKScriptMessageHandler {
  private let onCommand: ([String: Any]) -> Void
  init(onCommand: @escaping ([String: Any]) -> Void) { self.onCommand = onCommand }

  func userContentController(_ controller: WKUserContentController,
                             didReceive message: WKScriptMessage) {
    if let body = message.body as? [String: Any] { onCommand(body) }
  }
}
