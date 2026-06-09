import Foundation

/// Drives a daemon conversation over an injected `ConversationSocket`: sends the
/// `{type:auth,token}` handshake first on open, flushes any queued commands, decodes
/// inbound `{type:"beat",beat}` frames to `onBeat` (the beat passed through as raw
/// JSON for the WebView), and encodes `start`/`stop`/`resolveProposal` commands
/// (queued until open). Mirrors the extension's `connectConversation` semantics.
public final class ConversationClient {
  private let socket: ConversationSocket
  private let token: String
  private let onBeat: (String) -> Void
  private var open = false
  private var closed = false
  private var queue: [String] = []

  public init(socket: ConversationSocket, token: String, onBeat: @escaping (String) -> Void) {
    self.socket = socket
    self.token = token
    self.onBeat = onBeat
    socket.onOpen { [weak self] in self?.handleOpen() }
    socket.onText { [weak self] in self?.handleText($0) }
    socket.onClose { [weak self] in self?.handleClose() }
  }

  /// Open the socket (the handshake is sent automatically once it opens).
  public func connect() { socket.connect() }

  public func start(_ task: String) { send(["type": "start", "task": task]) }
  public func stop() { send(["type": "stop"]) }

  /// Resolve a save proposal. `proposalJSON` is the opaque proposal object as JSON
  /// (the panel produced it); it's embedded verbatim into the frame.
  public func resolveProposal(_ proposalJSON: String) {
    guard let data = proposalJSON.data(using: .utf8),
          let proposal = try? JSONSerialization.jsonObject(with: data) else { return }
    send(["type": "resolveProposal", "proposal": proposal, "accept": true])
  }

  public func close() {
    closed = true
    open = false
    queue.removeAll()       // drop anything queued before open so a late open can't flush it
    socket.close()
  }

  // MARK: - Socket callbacks

  private func handleOpen() {
    guard !closed else { return }  // closed before the socket opened — send nothing
    open = true
    socket.send(encode(["type": "auth", "token": token]))  // auth must be the first frame
    for frame in queue { socket.send(frame) }
    queue.removeAll()
  }

  private func handleText(_ text: String) {
    guard !closed,
          let obj = (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any],
          (obj["type"] as? String) == "beat",
          let beat = obj["beat"],
          let beatData = try? JSONSerialization.data(withJSONObject: beat),
          let beatJSON = String(data: beatData, encoding: .utf8) else { return }
    onBeat(beatJSON)
  }

  private func handleClose() {
    open = false
    closed = true
  }

  // MARK: - Outbound

  private func send(_ value: [String: Any]) {
    if closed { return }
    let frame = encode(value)
    if open { socket.send(frame) } else { queue.append(frame) }
  }

  private func encode(_ value: [String: Any]) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: value),
          let s = String(data: data, encoding: .utf8) else { return "{}" }
    return s
  }
}
