import { connectConversation } from "./conversationClient";
import { FakeSocket } from "./testSocket";

function setup() {
  const socket = new FakeSocket();
  const beats: unknown[] = [];
  const client = connectConversation({
    url: "ws://127.0.0.1:6002",
    token: "TOK",
    onBeat: (b) => beats.push(b),
    socketFactory: () => socket,
  });
  return { socket, beats, client };
}

describe("connectConversation", () => {
  it("authenticates with the token as the first frame on open", () => {
    const { socket } = setup();
    socket.fireOpen();
    expect(socket.parsed()[0]).toEqual({ type: "auth", token: "TOK" });
  });

  it("forwards { type: 'beat', beat } frames to onBeat (and ignores others)", () => {
    const { socket, beats } = setup();
    socket.fireOpen();
    socket.fireMessage({ type: "auth_ok" }); // ignored
    socket.fireMessage({ type: "beat", beat: { kind: "say", agent: "sage", text: "hi" } });
    socket.fireRaw("{bad json"); // ignored, no throw
    socket.fireMessage({ type: "beat", beat: { kind: "status", run: "done" } });
    expect(beats).toEqual([
      { kind: "say", agent: "sage", text: "hi" },
      { kind: "status", run: "done" },
    ]);
  });

  it("sends start/stop commands, queuing any issued before the socket opens", () => {
    const { socket, client } = setup();
    client.start("book a flight"); // before open → queued
    expect(socket.sent).toEqual([]); // nothing sent yet
    socket.fireOpen();
    // auth first, then the queued start
    expect(socket.parsed()).toEqual([
      { type: "auth", token: "TOK" },
      { type: "start", task: "book a flight" },
    ]);
    client.stop(); // after open → sent directly
    expect(socket.parsed().at(-1)).toEqual({ type: "stop" });
  });

  it("invokes onClose and stops forwarding beats after close", () => {
    const socket = new FakeSocket();
    let closed = false;
    const beats: unknown[] = [];
    connectConversation({
      url: "ws://x",
      token: "T",
      onBeat: (b) => beats.push(b),
      onClose: () => (closed = true),
      socketFactory: () => socket,
    });
    socket.fireOpen();
    socket.fireClose();
    expect(closed).toBe(true);
    socket.fireMessage({ type: "beat", beat: { kind: "say", agent: "sage", text: "late" } });
    expect(beats).toEqual([]); // dropped after close
  });

  it("drops start/stop issued after the socket closed (no send on a dead socket)", () => {
    const { socket, client } = setup();
    socket.fireOpen();
    const before = socket.sent.length;
    socket.fireClose();
    client.start("late");
    client.stop();
    expect(socket.sent.length).toBe(before); // nothing sent after close
  });

  it("close() closes the socket", () => {
    const { socket, client } = setup();
    client.close();
    expect(socket.closed).toBe(true);
  });

  it("drops start/stop after close() is called, before the close event arrives", () => {
    const { socket, client } = setup();
    socket.fireOpen();
    const before = socket.sent.length;
    client.close(); // sets closed synchronously
    client.start("late");
    client.stop();
    expect(socket.sent.length).toBe(before); // nothing sent after close()
  });

  it("defaults to a real WebSocket adapter when no factory is injected", () => {
    const created: string[] = [];
    class FakeWS {
      constructor(url: string) {
        created.push(url);
      }
      addEventListener(): void {}
      send(): void {}
      close(): void {}
    }
    vi.stubGlobal("WebSocket", FakeWS);
    try {
      const client = connectConversation({ url: "ws://127.0.0.1:6002", token: "T", onBeat: () => {} });
      expect(created).toEqual(["ws://127.0.0.1:6002"]);
      client.close(); // exercises the adapter's close()
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
