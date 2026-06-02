import { createServer, type Server, type Socket } from "node:net";
import type { AddressInfo } from "node:net";
import type { BridgeConnection } from "./authenticatedSession";
import { isLoopbackHost } from "./loopback";
import { PiBridgeSession, type ToolRelay } from "./piBridgeSession";

export interface PiBridgeServerOptions {
  /** Expected per-session token; the Pi extension presents it as its first line. */
  token: string;
  /** Relay each authenticated tool call to the executor (the Chrome bridge). */
  requestTool: ToolRelay;
  /** Port to bind; 0 (default) picks an ephemeral port. */
  port?: number;
  /** Loopback host. Defaults to 127.0.0.1 — local-only. */
  host?: string;
  /** Close a connection that doesn't authenticate within this many ms. */
  authTimeoutMs?: number;
  /** Called with each connection's session once it's wired up. */
  onSession?: (session: PiBridgeSession) => void;
}

/** Adapt a TCP socket to the line-framed {@link BridgeConnection} the session needs. */
function adapt(socket: Socket): BridgeConnection {
  socket.setEncoding("utf8");
  // A socket 'error' (abrupt disconnect / ECONNRESET) with no listener throws
  // and crashes the daemon — swallow it.
  /* v8 ignore next */
  socket.on("error", () => {});
  return {
    send: (data) => socket.write(data + "\n"),
    onMessage: (handler) => {
      // Frame raw lines and hand them to the session, which owns JSON parsing
      // and the "malformed first frame closes the connection" auth policy — so
      // we deliberately don't parse here (unlike ndjson.LineDecoder).
      let buf = "";
      socket.on("data", (chunk: string) => {
        buf += chunk;
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl).replace(/\r$/, "");
          buf = buf.slice(nl + 1);
          if (line) handler(line);
        }
      });
    },
    onClose: (handler) => socket.on("close", () => handler()),
    close: () => socket.end(),
  };
}

/**
 * Loopback TCP server for Pi's `browser` extension. The extension (running
 * inside the `pi` subprocess) connects with `node:net`, authenticates with the
 * token, and forwards each tool call here; this server wraps the connection in a
 * {@link PiBridgeSession} that relays the call to the Chrome bridge via
 * `requestTool`. TCP (not WS) so the in-Pi extension needs no bundled ws client.
 */
export class PiBridgeServer {
  private server: Server | undefined;
  private starting = false;

  constructor(private readonly opts: PiBridgeServerOptions) {}

  /** Start listening; resolves with the bound port. */
  listen(): Promise<number> {
    if (this.server || this.starting) return Promise.reject(new Error("PiBridgeServer is already listening"));
    const host = this.opts.host ?? "127.0.0.1";
    if (!isLoopbackHost(host)) {
      return Promise.reject(new Error(`PiBridgeServer host must be loopback, got "${host}"`));
    }
    this.starting = true;
    return new Promise((resolve, reject) => {
      const server = createServer((socket) => {
        const session = new PiBridgeSession({
          token: this.opts.token,
          connection: adapt(socket),
          requestTool: this.opts.requestTool,
          authTimeoutMs: this.opts.authTimeoutMs,
        });
        this.opts.onSession?.(session);
      });
      const onStartupError = (err: Error) => {
        this.starting = false;
        server.close();
        reject(err);
      };
      server.on("error", onStartupError);
      server.listen(this.opts.port ?? 0, host, () => {
        server.off("error", onStartupError);
        /* v8 ignore next */
        server.on("error", () => {});
        this.server = server;
        this.starting = false;
        resolve((server.address() as AddressInfo).port);
      });
    });
  }

  /** Stop accepting connections and close the server. */
  close(): Promise<void> {
    const server = this.server;
    if (!server) return Promise.resolve();
    this.server = undefined;
    return new Promise((resolve) => server.close(() => resolve()));
  }
}
