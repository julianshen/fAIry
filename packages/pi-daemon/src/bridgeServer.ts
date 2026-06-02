import type { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";
import { BridgeSession, type BridgeConnection } from "./bridgeSession";

export interface BridgeServerOptions {
  /** Expected per-session token the extension must present (see BridgeSession). */
  token: string;
  /** Port to bind; 0 (default) picks an ephemeral port. */
  port?: number;
  /** Loopback host. Defaults to 127.0.0.1 — the bridge is local-only. */
  host?: string;
  /**
   * Exact `Origin` values allowed to connect (e.g. `chrome-extension://<id>`).
   * When set, only these are accepted. When omitted, the default rejects web
   * (`http(s)://`) origins — the browser-page / DNS-rebinding vector, since
   * WebSocket isn't subject to CORS — and allows extension/native clients.
   */
  allowedOrigins?: string[];
  /** Called with each connection's session once it's wired up. */
  onSession?: (session: BridgeSession) => void;
  /** Per-tool-call timeout (forwarded to each session). */
  timeoutMs?: number;
  /** Close a connection that doesn't authenticate within this many ms. */
  authTimeoutMs?: number;
}

/** Adapt a `ws` socket to the transport-agnostic BridgeConnection interface. */
function adapt(socket: WebSocket): BridgeConnection {
  return {
    send: (data) => socket.send(data),
    onMessage: (handler) => socket.on("message", (raw: Buffer) => handler(raw.toString())),
    onClose: (handler) => socket.on("close", () => handler()),
    close: () => socket.close(),
  };
}

/**
 * Loopback WebSocket server for the browser bridge. Each connection is wrapped
 * in a {@link BridgeSession} (which enforces the auth handshake and correlates
 * tool calls); `onSession` hands the daemon the session to drive. Thin wiring
 * over `ws` — the testable logic lives in BridgeSession / RequestCorrelator.
 */
export class BridgeServer {
  private wss: WebSocketServer | undefined;

  constructor(private readonly opts: BridgeServerOptions) {}

  /** Whether a connecting client's Origin is permitted (anti-DNS-rebinding). */
  private allowOrigin(origin: string | undefined): boolean {
    const allowed = this.opts.allowedOrigins;
    if (allowed) return origin !== undefined && allowed.includes(origin);
    // Default: block web pages; allow extension/native clients (incl. no Origin).
    return !(origin && /^https?:\/\//i.test(origin));
  }

  /** Start listening; resolves with the bound port. */
  listen(): Promise<number> {
    if (this.wss) return Promise.reject(new Error("BridgeServer is already listening"));
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({
        host: this.opts.host ?? "127.0.0.1",
        port: this.opts.port ?? 0,
        verifyClient: (info: { origin: string }) => this.allowOrigin(info.origin),
      });
      wss.on("connection", (socket) => {
        const session = new BridgeSession({
          token: this.opts.token,
          connection: adapt(socket),
          timeoutMs: this.opts.timeoutMs,
          authTimeoutMs: this.opts.authTimeoutMs,
        });
        this.opts.onSession?.(session);
      });
      wss.on("error", (err) => {
        // Close the half-open server (e.g. EADDRINUSE) so nothing leaks.
        wss.close();
        reject(err);
      });
      wss.on("listening", () => {
        this.wss = wss;
        resolve((wss.address() as AddressInfo).port);
      });
    });
  }

  /** Stop accepting connections and close existing ones. */
  close(): Promise<void> {
    const wss = this.wss;
    if (!wss) return Promise.resolve();
    this.wss = undefined;
    return new Promise((resolve) => {
      for (const client of wss.clients) client.terminate();
      wss.close(() => resolve());
    });
  }
}
