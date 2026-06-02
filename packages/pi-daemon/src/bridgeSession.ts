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
  private readonly correlator: RequestCorrelator;

  constructor(private readonly opts: BridgeSessionOptions) {
    this.correlator = new RequestCorrelator({
      send: (req) => opts.connection.send(JSON.stringify(req)),
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    });
    opts.connection.onMessage((data) => this.onMessage(data));
    opts.connection.onClose(() => this.onClose());
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
        this.opts.connection.send(JSON.stringify({ type: "auth_ok" }));
        this.opts.onAuthenticated?.();
      } else {
        this.opts.connection.close();
      }
      return;
    }

    this.correlator.resolve(msg as ToolResponse);
  }

  private onClose(): void {
    this.correlator.rejectAll("bridge connection closed");
    this.opts.onClose?.();
  }
}
