import XCTest
@testable import FairyShell

/// A synchronous fake WS: records sent frames and lets the test drive open/text/close.
final class FakeConversationSocket: ConversationSocket {
  private var openH: (() -> Void)?
  private var textH: ((String) -> Void)?
  private var closeH: (() -> Void)?
  private(set) var sent: [String] = []
  private(set) var connected = false
  private(set) var closeCount = 0
  func onOpen(_ h: @escaping () -> Void) { openH = h }
  func onText(_ h: @escaping (String) -> Void) { textH = h }
  func onClose(_ h: @escaping () -> Void) { closeH = h }
  func connect() { connected = true }
  func send(_ text: String) { sent.append(text) }
  func close() { closeCount += 1 }
  func simulateOpen() { openH?() }
  func simulateText(_ t: String) { textH?(t) }
  func simulateClose() { closeH?() }
}

/// Parse a sent frame into a dictionary (key order is not guaranteed in JSON output).
private func parse(_ frame: String) -> [String: Any] {
  (try? JSONSerialization.jsonObject(with: Data(frame.utf8))) as? [String: Any] ?? [:]
}

final class ConversationClientTests: XCTestCase {
  private func make(_ socket: FakeConversationSocket, onBeat: @escaping (String) -> Void = { _ in })
    -> ConversationClient {
    ConversationClient(socket: socket, token: "tok", onBeat: onBeat)
  }

  func testAuthFrameSentFirstOnOpen() {
    let s = FakeConversationSocket(); let c = make(s); c.connect()
    XCTAssertTrue(s.connected)
    s.simulateOpen()
    XCTAssertEqual(parse(s.sent[0])["type"] as? String, "auth")
    XCTAssertEqual(parse(s.sent[0])["token"] as? String, "tok")
  }

  func testCommandsBeforeOpenAreQueuedThenFlushedAfterAuth() {
    let s = FakeConversationSocket(); let c = make(s); c.connect()
    c.start("hello")            // queued (not open yet)
    XCTAssertTrue(s.sent.isEmpty)
    s.simulateOpen()
    XCTAssertEqual(s.sent.count, 2)                       // auth, then start
    XCTAssertEqual(parse(s.sent[0])["type"] as? String, "auth")
    XCTAssertEqual(parse(s.sent[1])["type"] as? String, "start")
    XCTAssertEqual(parse(s.sent[1])["task"] as? String, "hello")
  }

  func testBeatFrameDeliversRawBeatJSON() {
    var beats: [String] = []
    let s = FakeConversationSocket(); let c = make(s) { beats.append($0) }; c.connect(); s.simulateOpen()
    s.simulateText(#"{"type":"beat","beat":{"kind":"say","text":"hi"}}"#)
    XCTAssertEqual(beats.count, 1)
    XCTAssertEqual(parse(beats[0])["kind"] as? String, "say")
  }

  func testNonBeatAndMalformedFramesIgnored() {
    var beats: [String] = []
    let s = FakeConversationSocket(); let c = make(s) { beats.append($0) }; c.connect(); s.simulateOpen()
    s.simulateText(#"{"type":"other"}"#)
    s.simulateText("not json")
    XCTAssertTrue(beats.isEmpty)
  }

  func testStopFrame() {
    let s = FakeConversationSocket(); let c = make(s); c.connect(); s.simulateOpen()
    c.stop()
    XCTAssertEqual(parse(s.sent.last!)["type"] as? String, "stop")
  }

  func testResolveProposalFrame() {
    let s = FakeConversationSocket(); let c = make(s); c.connect(); s.simulateOpen()
    c.resolveProposal(#"{"kind":"skill","name":"x"}"#)
    let f = parse(s.sent.last!)
    XCTAssertEqual(f["type"] as? String, "resolveProposal")
    XCTAssertEqual(f["accept"] as? Bool, true)
    XCTAssertEqual((f["proposal"] as? [String: Any])?["kind"] as? String, "skill")
  }

  func testCloseStopsSendsAndClosesSocket() {
    let s = FakeConversationSocket(); let c = make(s); c.connect(); s.simulateOpen()
    let before = s.sent.count
    c.close()
    c.start("ignored")
    XCTAssertEqual(s.sent.count, before)   // nothing sent after close
    XCTAssertEqual(s.closeCount, 1)
  }

  func testCloseBeforeOpenSuppressesAuthAndQueuedSends() {
    let s = FakeConversationSocket(); let c = make(s); c.connect()
    c.start("queued")   // queued before the socket opened
    c.close()           // closed before open
    s.simulateOpen()    // a late open callback must NOT send auth or flush the queue
    XCTAssertTrue(s.sent.isEmpty)
  }
}
