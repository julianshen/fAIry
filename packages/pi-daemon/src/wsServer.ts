import type { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";
import type { BridgeConnection } from "./authenticatedSession";

export interface WsServerOptions {
  /** Port to bind; 0 (default) picks an ephemeral port. */
  port?: number;
  /** Loopback host. Defaults to 127.0.0.1 — local-only. */
  host?: string;
  /**
   * Exact `Origin` values allowed (e.g. `chrome-extension://<id>`). When set,
   * only these connect. When omitted, web (`http(s)://`) origins are rejected —
   * the browser-page / DNS-rebinding vector, since WebSocket isn't subject to
   * CORS — and extension/native clients are allowed.
   */
  allowedOrigins?: string[];
  /** Called with each accepted, origin-checked connection. */
  onConnection: (connection: BridgeConnection) => void;
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
 * A loopback WebSocket server: accepts connections, applies the Origin guard,
 * and hands each adapted {@link BridgeConnection} to `onConnection`. The caller
 * decides what session to wrap it in — so the bridge and the conversation
 * endpoint share one accept/lifecycle implementation.
 */
export class WsServer {
  private wss: WebSocketServer | undefined;

  constructor(private readonly opts: WsServerOptions) {}

  private allowOrigin(origin: string | undefined): boolean {
    const allowed = this.opts.allowedOrigins;
    if (allowed) return origin !== undefined && allowed.includes(origin);
    return !(origin && /^https?:\/\//i.test(origin));
  }

  /** Start listening; resolves with the bound port. */
  listen(): Promise<number> {
    if (this.wss) return Promise.reject(new Error("WsServer is already listening"));
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({
        host: this.opts.host ?? "127.0.0.1",
        port: this.opts.port ?? 0,
        verifyClient: (info: { origin: string }) => this.allowOrigin(info.origin),
      });
      wss.on("connection", (socket) => this.opts.onConnection(adapt(socket)));
      wss.on("error", (err) => {
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
