import { defaultSocketFactory, type ClientSocket, type SocketFactory } from "./socket";

export type { ClientSocket };

export interface ConversationClientOptions {
  /** `ws://127.0.0.1:<conversationPort>` (from discovery). */
  url: string;
  /** Per-session token presented in the first frame. */
  token: string;
  /** Called for each panel beat streamed by the daemon. Opaque here (the panel applies it). */
  onBeat: (beat: unknown) => void;
  /** Injected for tests; defaults to a real `WebSocket` adapter. */
  socketFactory?: SocketFactory;
  onClose?: () => void;
}

export interface ConversationClient {
  /** Begin a task (queued until the socket is open + authenticated). */
  start(task: string): void;
  /** Stop the in-flight turn. */
  stop(): void;
  /** Close the connection. */
  close(): void;
}

/**
 * Connect the side panel to the daemon's conversation WS: on open it sends the
 * `{ type: "auth", token }` handshake first, then streams `{ type: "beat", beat }`
 * frames to `onBeat` and sends `start`/`stop` commands. Sends issued before the
 * socket opens are queued and flushed (after auth) once it does.
 */
export function connectConversation(opts: ConversationClientOptions): ConversationClient {
  const socket = (opts.socketFactory ?? defaultSocketFactory)(opts.url);
  let open = false;
  let closed = false;
  const queue: string[] = [];

  const send = (value: unknown): void => {
    if (closed) return; // never send/queue on a closed connection
    const frame = JSON.stringify(value);
    if (open) socket.send(frame);
    else queue.push(frame);
  };

  socket.onOpen(() => {
    open = true;
    // Auth is fire-and-forget (no `auth_ok` wait — the daemon closes on bad auth);
    // it must be the first frame, before any queued start/stop.
    socket.send(JSON.stringify({ type: "auth", token: opts.token }));
    for (const frame of queue) socket.send(frame);
    queue.length = 0;
  });

  socket.onMessage((data) => {
    if (closed) return;
    let msg: unknown;
    try {
      msg = JSON.parse(data);
    } catch {
      return; // ignore malformed frames
    }
    if (typeof msg === "object" && msg !== null && (msg as { type?: unknown }).type === "beat") {
      opts.onBeat((msg as { beat: unknown }).beat);
    }
  });

  socket.onClose(() => {
    closed = true;
    open = false;
    opts.onClose?.();
  });

  return {
    start: (task) => send({ type: "start", task }),
    stop: () => send({ type: "stop" }),
    close: () => socket.close(),
  };
}
