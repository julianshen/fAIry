import Foundation

/// Injectable WebSocket seam so `ConversationClient`'s protocol logic is unit-tested
/// without real networking. Handlers are registered before `connect()`.
public protocol ConversationSocket: AnyObject {
  func onOpen(_ handler: @escaping () -> Void)
  func onText(_ handler: @escaping (String) -> Void)
  func onClose(_ handler: @escaping () -> Void)
  func connect()
  func send(_ text: String)
  func close()
}
