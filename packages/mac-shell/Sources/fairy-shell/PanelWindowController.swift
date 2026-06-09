import AppKit
import WebKit
import FairyShell

/// Owns the conversation panel window: a WKWebView hosting the bundled agent-panel,
/// connected to the daemon's conversation WS via ConversationClient. Beats are pushed
/// into JS via evaluateJavaScript; panel commands arrive via PanelBridge.
@MainActor
final class PanelWindowController: NSObject, WKNavigationDelegate {
  private var window: NSWindow?
  private var webView: WKWebView?
  private var overlay: NSView?
  private var client: ConversationClient?

  private let baseURL: URL
  private let tokenURL: URL
  init(baseURL: URL, tokenURL: URL) { self.baseURL = baseURL; self.tokenURL = tokenURL }

  func show() {
    if let w = window { w.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true); return }

    let config = WKWebViewConfiguration()
    let bridge = PanelBridge(onCommand: { [weak self] in self?.handleCommand($0) })
    config.userContentController.add(bridge, name: "fairy")

    let frame = NSRect(x: 0, y: 0, width: 420, height: 640)
    let wv = WKWebView(frame: frame, configuration: config)
    wv.navigationDelegate = self
    webView = wv

    let w = NSWindow(contentRect: frame, styleMask: [.titled, .closable, .resizable],
                     backing: .buffered, defer: false)
    w.title = "Fairy"
    w.contentView = wv
    w.isReleasedWhenClosed = false
    w.center()
    window = w
    w.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)

    showOverlay("Connecting…", retry: false)
    if let indexURL = Bundle.module.url(forResource: "index", withExtension: "html", subdirectory: "panel") {
      wv.loadFileURL(indexURL, allowingReadAccessTo: indexURL.deletingLastPathComponent())
    }
  }

  // Connect once the page has loaded, so window.__fairyBridge.onBeat is registered
  // before any beat arrives.
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    Task { await connect() }
  }

  private func connect() async {
    client?.close()   // tear down any prior connection (e.g. a retry) before reconnecting
    client = nil
    let info = await InfoClient(baseURL: baseURL, tokenURL: tokenURL, transport: URLSessionTransport()).fetch()
    guard case .success(let daemonInfo) = info,
          let token = TokenReader.read(from: tokenURL),
          let wsURL = URL(string: "ws://127.0.0.1:\(daemonInfo.conversationPort)") else {
      showOverlay("Couldn't reach the daemon — is it running?", retry: true)
      return
    }
    let c = ConversationClient(
      socket: URLSessionConversationSocket(url: wsURL),
      token: token,
      onBeat: { [weak self] json in self?.deliverBeat(json) },
      onClose: { [weak self] in self?.handleDisconnect() }
    )
    client = c
    c.connect()
    hideOverlay()
  }

  // The conversation socket dropped unsolicited (daemon restart / network loss) —
  // surface the Retry overlay so the panel isn't silently dead.
  private nonisolated func handleDisconnect() {
    DispatchQueue.main.async { [weak self] in
      self?.showOverlay("Connection lost — the daemon may have restarted.", retry: true)
    }
  }

  private func handleCommand(_ body: [String: Any]) {
    switch body["type"] as? String {
    case "start": if let task = body["task"] as? String { client?.start(task) }
    case "stop": client?.stop()
    case "resolveProposal":
      // isValidJSONObject first: data(withJSONObject:) raises an Obj-C exception
      // (uncatchable by try?) on a top-level fragment / non-JSON value.
      if let proposal = body["proposal"],
         JSONSerialization.isValidJSONObject(proposal),
         let data = try? JSONSerialization.data(withJSONObject: proposal),
         let json = String(data: data, encoding: .utf8) { client?.resolveProposal(json) }
    default: break
    }
  }

  private nonisolated func deliverBeat(_ beatJSON: String) {
    // onBeat may fire off-main depending on the socket; force the WebKit call onto
    // the main thread (evaluateJavaScript must run there). beatJSON is well-formed
    // JSON (a valid JS object literal) — embed directly.
    DispatchQueue.main.async { [weak self] in
      self?.webView?.evaluateJavaScript("window.__fairyBridge && window.__fairyBridge.onBeat(\(beatJSON))")
    }
  }

  // MARK: - Connection overlay (native, over the WebView)

  private func showOverlay(_ text: String, retry: Bool) {
    guard let content = window?.contentView else { return }
    overlay?.removeFromSuperview()
    let box = NSView(frame: content.bounds)
    box.autoresizingMask = [.width, .height]
    box.wantsLayer = true
    box.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor

    let label = NSTextField(labelWithString: text)
    label.alignment = .center
    label.frame = NSRect(x: 20, y: content.bounds.midY, width: content.bounds.width - 40, height: 24)
    label.autoresizingMask = [.width, .minYMargin, .maxYMargin]
    box.addSubview(label)

    if retry {
      let button = NSButton(title: "Retry", target: self, action: #selector(retryTapped))
      button.frame = NSRect(x: content.bounds.midX - 40, y: content.bounds.midY - 40, width: 80, height: 28)
      button.autoresizingMask = [.minXMargin, .maxXMargin, .minYMargin, .maxYMargin]
      box.addSubview(button)
    }
    content.addSubview(box, positioned: .above, relativeTo: webView)
    overlay = box
  }

  private func hideOverlay() {
    overlay?.removeFromSuperview()
    overlay = nil
  }

  @objc private func retryTapped() {
    hideOverlay()
    showOverlay("Connecting…", retry: false)
    Task { await connect() }
  }
}
