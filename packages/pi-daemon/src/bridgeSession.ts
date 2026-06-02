import { RequestCorrelator, type ToolResponse } from "./bridge";

/**
 * Minimal duplex connection the session needs — structurally satisfied by a
 * `ws` socket or a Bun.serve WebSocket via a thin adapter, so the session logic
 * is testable without a real socket.
 */
export interface BridgeConnection {
  send(data: string): void;
  onMessage(handler: (data: string) => void): void;
  onClose(handler: () => void): void;
  close(): void;
}

export interface BridgeSessionOptions {
  /** Expected per-session token; the extension must present it first. */
  token: string;
  connection: BridgeConnection;
  /** Per-tool-call timeout in ms (forwarded to the correlator). */
  timeoutMs?: number;
  /** Close the connection if it doesn't authenticate within this many ms. */
  authTimeoutMs?: number;
  onAuthenticated?: () => void;
  onClose?: () => void;
}

/**
 * One authenticated bridge connection to the Chrome extension. The extension's
 * first message must be `{ type: "auth", token }`; until it validates, no tool
 * traffic is processed and a bad/malformed handshake closes the socket. After
 * auth, the daemon issues tool calls via `requestTool` and the extension's
 * `ToolResponse`s are correlated back. On disconnect, in-flight calls reject.
 */
export class BridgeSession {
  private authed = false;
  private authTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly correlator: RequestCorrelator;

  constructor(private readonly opts: BridgeSessionOptions) {
    this.correlator = new RequestCorrelator({
      send: (req) => opts.connection.send(JSON.stringify(req)),
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    });
    opts.connection.onMessage((data) => this.onMessage(data));
    opts.connection.onClose(() => this.onClose());
    if (opts.authTimeoutMs && opts.authTimeoutMs > 0) {
      this.authTimer = setTimeout(() => {
        if (!this.authed) opts.connection.close();
      }, opts.authTimeoutMs);
    }
  }

  get isAuthenticated(): boolean {
    return this.authed;
  }

  /** Issue a browser tool call over the bridge. Rejects until authenticated. */
  requestTool(tool: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.authed) return Promise.reject(new Error("bridge not authenticated"));
    return this.correlator.request(tool, args);
  }

  private onMessage(data: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(data);
    } catch {
      // A malformed handshake is fatal; after auth, just drop the bad frame.
      if (!this.authed) this.opts.connection.close();
      return;
    }

    if (!this.authed) {
      const m = msg as { type?: string; token?: string };
      if (m?.type === "auth" && m.token === this.opts.token) {
        this.authed = true;
        clearTimeout(this.authTimer);
        this.opts.connection.send(JSON.stringify({ type: "auth_ok" }));
        this.opts.onAuthenticated?.();
      } else {
        this.opts.connection.close();
      }
      return;
    }

    // A valid-JSON but non-object frame (null, a number, an array) would crash
    // the correlator reading `.id`; drop anything that isn't a response object.
    if (typeof msg !== "object" || msg === null || !("id" in msg)) return;
    this.correlator.resolve(msg as ToolResponse);
  }

  private onClose(): void {
    clearTimeout(this.authTimer);
    // Drop auth so a late requestTool rejects instead of sending to a dead socket.
    this.authed = false;
    this.correlator.rejectAll("bridge connection closed");
    this.opts.onClose?.();
  }
}
