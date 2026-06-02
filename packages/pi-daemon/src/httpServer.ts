import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { isLoopbackHost } from "./loopback";
import { isAllowedOrigin } from "./origin";
import type { PairingStore } from "./pairing";
import { timingSafeStrEqual } from "./secureCompare";
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
   * {@link isAllowedOrigin}). Allowed origins also receive CORS headers + an
   * `OPTIONS` preflight answer, so a browser (the extension) can call the
   * endpoints — `/pair` cross-origin to bootstrap, and the rest once it has the
   * token. The native shell sends no Origin and needs no CORS.
   */
  allowedOrigins?: string[];
  /** Maximum accepted body size in bytes (default 1 MiB). */
  maxBodyBytes?: number;
  /**
   * Enables the unauthenticated `POST /pair` endpoint: the extension redeems a
   * pairing code for the session token. Omit to disable pairing (`/pair` → 404).
   */
  pairing?: PairingStore;
  /**
   * Enables the authenticated `GET /info` endpoint, returning connection details
   * (e.g. the bridge/conversation WS ports) so a paired client can discover the
   * ephemeral WS servers. Omit to disable (`/info` → 404). Called per request, so
   * it can read values resolved after construction.
   */
  info?: () => unknown;
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
    const origin = req.headers.origin;
    if (!isAllowedOrigin(origin, this.opts.allowedOrigins)) {
      return send(res, 403, { error: "forbidden_origin" });
    }
    // CORS for allowed browser origins (the extension calls these cross-origin).
    if (origin) setCorsHeaders(res, origin);

    // Node always sets url/method on a server request; the defaults are type
    // guards for the optional `IncomingMessage` fields, not reachable states.
    /* v8 ignore next 2 */
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    const method = req.method ?? "GET";

    // Answer the CORS preflight before any auth.
    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    // `/pair` is the one unauthenticated route — the pairing code is the credential.
    if (path === "/pair") {
      if (method !== "POST") return send(res, 405, { error: "method_not_allowed" });
      return this.pair(req, res);
    }

    const auth = req.headers.authorization;
    if (typeof auth !== "string" || !timingSafeStrEqual(auth, `Bearer ${this.opts.token}`)) {
      return send(res, 401, { error: "unauthorized" });
    }
    if (path === "/status") {
      if (method !== "GET") return send(res, 405, { error: "method_not_allowed" });
      return send(res, 200, { status: "ok" });
    }
    if (path === "/info") {
      if (!this.opts.info) return send(res, 404, { error: "not_found" });
      if (method !== "GET") return send(res, 405, { error: "method_not_allowed" });
      return send(res, 200, this.opts.info());
    }
    if (path === "/settings") {
      if (method === "GET") return send(res, 200, redactConfig(this.opts.settings.get()));
      if (method === "PUT") return this.putSettings(req, res);
      return send(res, 405, { error: "method_not_allowed" });
    }
    return send(res, 404, { error: "not_found" });
  }

  /** Redeem a pairing code for the session token (unauthenticated; the code authenticates). */
  private pair(req: IncomingMessage, res: ServerResponse): void {
    const pairing = this.opts.pairing;
    if (!pairing) return send(res, 404, { error: "not_found" }); // pairing disabled
    readBody(req, this.opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES)
      .then((raw) => {
        if (raw === null) return send(res, 413, { error: "payload_too_large" });
        const code = parseCode(raw);
        if (code === null) return send(res, 400, { error: "invalid_code" });
        const token = pairing.redeem(code);
        if (token === null) return send(res, 401, { error: "invalid_or_expired_code" });
        send(res, 200, { token });
      })
      /* v8 ignore next */
      .catch(() => send(res, 400, { error: "invalid_body" }));
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

/** Allow the (already origin-checked) browser origin to call these endpoints. */
function setCorsHeaders(res: ServerResponse, origin: string): void {
  res.setHeader("access-control-allow-origin", origin);
  res.setHeader("access-control-allow-methods", "GET, PUT, POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
}

/** Parse a request body as a JSON object, or null if it isn't valid JSON / not an object. */
function parseJsonObject(raw: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  // typeof [] === "object" too; exclude arrays so only key-value bodies pass.
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

/** Extract a string `code` from a `/pair` body, or null if malformed. */
function parseCode(raw: string): string | null {
  const code = parseJsonObject(raw)?.code;
  return typeof code === "string" ? code : null;
}

/** Parse a request body into a PiConfig, or null if it isn't a valid one. */
function parseConfig(raw: string): PiConfig | null {
  const obj = parseJsonObject(raw);
  return obj && isPiConfig(obj) ? obj : null;
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
