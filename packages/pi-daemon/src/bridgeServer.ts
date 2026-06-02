import { BridgeSession } from "./bridgeSession";
import { WsServer } from "./wsServer";

export interface BridgeServerOptions {
  /** Expected per-session token the extension must present (see BridgeSession). */
  token: string;
  /** Port to bind; 0 (default) picks an ephemeral port. */
  port?: number;
  /** Loopback host. Defaults to 127.0.0.1 — the bridge is local-only. */
  host?: string;
  /** Exact Origin values allowed (see WsServer); defaults to blocking web origins. */
  allowedOrigins?: string[];
  /** Called with each connection's session once it's wired up. */
  onSession?: (session: BridgeSession) => void;
  /** Called when a session completes the token handshake (after `onSession`). */
  onAuthenticated?: (session: BridgeSession) => void;
  /** Called when a session's connection closes. */
  onClose?: (session: BridgeSession) => void;
  /** Per-tool-call timeout (forwarded to each session). */
  timeoutMs?: number;
  /** Close a connection that doesn't authenticate within this many ms. */
  authTimeoutMs?: number;
}

/**
 * Loopback WebSocket server for the browser bridge. Wraps each connection in a
 * {@link BridgeSession} and hands the daemon the session via `onSession`. The
 * accept/lifecycle/origin handling is delegated to {@link WsServer}.
 */
export class BridgeServer {
  private readonly server: WsServer;

  constructor(opts: BridgeServerOptions) {
    this.server = new WsServer({
      port: opts.port,
      host: opts.host,
      allowedOrigins: opts.allowedOrigins,
      onConnection: (connection) => {
        const session: BridgeSession = new BridgeSession({
          token: opts.token,
          connection,
          timeoutMs: opts.timeoutMs,
          authTimeoutMs: opts.authTimeoutMs,
          onAuthenticated: () => opts.onAuthenticated?.(session),
          onClose: () => opts.onClose?.(session),
        });
        opts.onSession?.(session);
      },
    });
  }

  /** Start listening; resolves with the bound port. */
  listen(): Promise<number> {
    return this.server.listen();
  }

  /** Stop accepting connections and close existing ones. */
  close(): Promise<void> {
    return this.server.close();
  }
}
