import { RequestCorrelator, type ToolResponse } from "./bridge";
import { AuthenticatedSession, type BridgeConnection } from "./authenticatedSession";

// Re-export so existing importers (bridgeServer, tests) keep resolving it here.
export type { BridgeConnection };

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
 * One authenticated bridge connection to the Chrome extension. After the token
 * handshake (see {@link AuthenticatedSession}), the daemon issues tool calls via
 * `requestTool` and the extension's `ToolResponse`s are correlated back; on
 * disconnect, in-flight calls reject.
 */
export class BridgeSession extends AuthenticatedSession {
  private readonly correlator: RequestCorrelator;

  constructor(private readonly opts: BridgeSessionOptions) {
    super({
      token: opts.token,
      connection: opts.connection,
      ...(opts.authTimeoutMs !== undefined ? { authTimeoutMs: opts.authTimeoutMs } : {}),
      ...(opts.onClose !== undefined ? { onClose: opts.onClose } : {}),
    });
    this.correlator = new RequestCorrelator({
      send: (req) => this.send(req),
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    });
  }

  /** Issue a browser tool call over the bridge. Rejects until authenticated. */
  requestTool(tool: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.isAuthenticated) return Promise.reject(new Error("bridge not authenticated"));
    return this.correlator.request(tool, args);
  }

  protected onAuthenticated(): void {
    this.opts.onAuthenticated?.();
  }

  protected onAuthedMessage(msg: unknown): void {
    // A valid-JSON but non-object frame (null, a number, an array) would crash
    // the correlator reading `.id`; drop anything that isn't a response object.
    if (typeof msg !== "object" || msg === null || !("id" in msg)) return;
    this.correlator.resolve(msg as ToolResponse);
  }

  protected onDisposed(): void {
    this.correlator.rejectAll("bridge connection closed");
  }
}
