import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { isLoopbackHost } from "./loopback";
import { isAllowedOrigin } from "./origin";
import { isPiConfig, mergeProviderKeys, redactConfig, type SettingsStore } from "./settings";
import type { PiConfig } from "./piConfig";

/** Default maximum `PUT` body size — the settings payload is tiny. */
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

export interface HttpServerOptions {
  /** Expected bearer token; clients send `Authorization: Bearer <token>`. */
  token: string;
  /** Source of truth for provider/model config (injected, kept pure/testable). */
  settings: SettingsStore;
  /** Port to bind; 0 (default) picks an ephemeral port. */
  port?: number;
  /** Loopback host. Defaults to 127.0.0.1 — local-only. */
  host?: string;
  /**
   * Exact `Origin` values allowed; defaults to blocking web origins (see
   * {@link isAllowedOrigin}). Note: this gates the Origin only — it does not
   * emit CORS headers or answer `OPTIONS` preflights, so a browser can't yet
   * call these endpoints. The intended consumer is the native shell (no CORS);
   * browser access waits on the pairing endpoint, which will add CORS.
   */
  allowedOrigins?: string[];
  /** Maximum accepted `PUT` body size in bytes (default 1 MiB). */
  maxBodyBytes?: number;
}

/**
 * Loopback HTTP server for the daemon's control plane: `GET /status` (health),
 * `GET /settings` (the redacted provider/model config), and `PUT /settings`
 * (replace it). Every request passes the same Origin guard as the WS servers
 * and must carry the per-session bearer token.
 */
export class HttpServer {
  private server: Server | undefined;
  private starting = false;

  constructor(private readonly opts: HttpServerOptions) {}

  /** Start listening; resolves with the bound port. */
  listen(): Promise<number> {
    if (this.server || this.starting) return Promise.reject(new Error("HttpServer is already listening"));
    const host = this.opts.host ?? "127.0.0.1";
    if (!isLoopbackHost(host)) {
      return Promise.reject(new Error(`HttpServer host must be loopback, got "${host}"`));
    }
    this.starting = true;
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => this.handle(req, res));
      const onStartupError = (err: Error) => {
        this.starting = false;
        server.close();
        reject(err);
      };
      server.on("error", onStartupError);
      server.listen(this.opts.port ?? 0, host, () => {
        // Swap the startup handler for a runtime no-op so a later error can't
        // reject an already-resolved promise.
        server.off("error", onStartupError);
        /* v8 ignore next */
        server.on("error", () => {});
        this.server = server;
        this.starting = false;
        resolve((server.address() as AddressInfo).port);
      });
    });
  }

  /** Stop accepting requests and close the server. */
  close(): Promise<void> {
    const server = this.server;
    if (!server) return Promise.resolve();
    this.server = undefined;
    return new Promise((resolve) => server.close(() => resolve()));
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    if (!isAllowedOrigin(req.headers.origin, this.opts.allowedOrigins)) {
      return send(res, 403, { error: "forbidden_origin" });
    }
    if (req.headers.authorization !== `Bearer ${this.opts.token}`) {
      return send(res, 401, { error: "unauthorized" });
    }

    // Node always sets url/method on a server request; the defaults are type
    // guards for the optional `IncomingMessage` fields, not reachable states.
    /* v8 ignore next 2 */
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    const method = req.method ?? "GET";

    if (path === "/status") {
      if (method !== "GET") return send(res, 405, { error: "method_not_allowed" });
      return send(res, 200, { status: "ok" });
    }
    if (path === "/settings") {
      if (method === "GET") return send(res, 200, redactConfig(this.opts.settings.get()));
      if (method === "PUT") return this.putSettings(req, res);
      return send(res, 405, { error: "method_not_allowed" });
    }
    return send(res, 404, { error: "not_found" });
  }

  private putSettings(req: IncomingMessage, res: ServerResponse): void {
    readBody(req, this.opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES)
      .then((raw) => {
        if (raw === null) return send(res, 413, { error: "payload_too_large" });
        const config = parseConfig(raw);
        if (!config) return send(res, 400, { error: "invalid_config" });
        // Persistence/redaction errors are server-side — keep them out of the
        // body-parse catch below, which would mislabel them as a 400.
        try {
          const store = this.opts.settings;
          store.save(mergeProviderKeys(store.get(), config));
          send(res, 200, redactConfig(store.get()));
        } catch {
          send(res, 500, { error: "internal_error" });
        }
      })
      /* v8 ignore next */
      .catch(() => send(res, 400, { error: "invalid_body" }));
  }
}

/** Parse a request body into a PiConfig, or null if it isn't a valid one. */
function parseConfig(raw: string): PiConfig | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isPiConfig(parsed) ? parsed : null;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/**
 * Read the request body as a UTF-8 string, or `null` if it exceeds `limit`.
 * Chunks are collected as Buffers and decoded once at the end — decoding each
 * chunk would corrupt a multi-byte character split across a chunk boundary —
 * and the `data` listener is detached at the limit so a large upload can't keep
 * growing the buffer.
 */
function readBody(req: IncomingMessage, limit: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytesRead = 0;
    const onData = (chunk: Buffer) => {
      bytesRead += chunk.length;
      if (bytesRead > limit) {
        req.off("data", onData);
        resolve(null);
        return;
      }
      chunks.push(chunk);
    };
    req.on("data", onData);
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    /* v8 ignore next */
    req.on("error", reject);
  });
}
