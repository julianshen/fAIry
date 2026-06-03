import { defaultSocketFactory, type SocketFactory } from "./socket";

/** Runs a browser tool call and resolves with its result (or rejects on failure). */
export type ToolExecute = (tool: string, args: Record<string, unknown>) => Promise<unknown>;

export interface BridgeClientOptions {
  /** `ws://127.0.0.1:<bridgePort>` (from discovery). */
  url: string;
  /** Per-session token presented in the first frame. */
  token: string;
  /** Executes each requested tool (e.g. via `chrome.debugger`). */
  execute: ToolExecute;
  /** Injected for tests; defaults to a real `WebSocket` adapter. */
  socketFactory?: SocketFactory;
  onClose?: () => void;
}

export interface BridgeClient {
  /** Close the connection. */
  close(): void;
}

/**
 * The executor side of the browser bridge: the daemon (relaying Pi's tool calls)
 * sends `{ id, tool, args }`; this connects the bridge WS, authenticates, runs
 * each request via `execute`, and replies `{ id, ok, result }` /
 * `{ id, ok: false, error }`. The inverse of the daemon's
 * {@link import("@fairy/pi-daemon")} `PiBridgeSession`/`BridgeSession` pair.
 */
export function connectBridge(opts: BridgeClientOptions): BridgeClient {
  const socket = (opts.socketFactory ?? defaultSocketFactory)(opts.url);
  let closed = false;

  const reply = (response: { id: string; ok: boolean; result?: unknown; error?: string }): void => {
    if (closed) return;
    let frame: string;
    try {
      frame = JSON.stringify(response);
    } catch {
      // A tool result with a circular structure / BigInt isn't serializable —
      // reply with an error (the id is a plain string) so the call doesn't hang.
      frame = JSON.stringify({ id: response.id, ok: false, error: "tool result was not serializable" });
    }
    socket.send(frame);
  };

  // Auth is fire-and-forget: the daemon closes the socket on a bad/missing
  // token, so there's no `auth_ok` to wait for.
  socket.onOpen(() => socket.send(JSON.stringify({ type: "auth", token: opts.token })));

  socket.onMessage((data) => {
    if (closed) return;
    let msg: unknown;
    try {
      msg = JSON.parse(data);
    } catch {
      return; // ignore malformed frames
    }
    if (typeof msg !== "object" || msg === null) return;
    const req = msg as { id?: unknown; tool?: unknown; args?: unknown };
    if (typeof req.id !== "string" || typeof req.tool !== "string") return;
    const id = req.id;
    const tool = req.tool;
    const args =
      typeof req.args === "object" && req.args !== null && !Array.isArray(req.args)
        ? (req.args as Record<string, unknown>)
        : {};
    // Promise.resolve().then so a *synchronous* throw from execute becomes a
    // rejected reply rather than an uncaught exception (parity with the daemon).
    Promise.resolve()
      .then(() => opts.execute(tool, args))
      .then(
        (result) => reply({ id, ok: true, result }),
        (err) => reply({ id, ok: false, error: err instanceof Error ? err.message : String(err) }),
      );
  });

  socket.onClose(() => {
    closed = true;
    opts.onClose?.();
  });

  return {
    close: () => {
      // Set the flag synchronously so a tool execution that resolves between now
      // and the async `close` event doesn't reply on a closing socket.
      closed = true;
      socket.close();
    },
  };
}
