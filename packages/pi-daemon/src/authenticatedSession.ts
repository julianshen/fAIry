/**
 * Minimal duplex connection a session needs — structurally satisfied by a `ws`
 * socket (or a Bun.serve WebSocket) via a thin adapter, so session logic is
 * testable without a real socket.
 */
export interface BridgeConnection {
  send(data: string): void;
  onMessage(handler: (data: string) => void): void;
  onClose(handler: () => void): void;
  close(): void;
}

export interface AuthenticatedSessionOptions {
  /** Expected per-session token; the client must present it as its first message. */
  token: string;
  connection: BridgeConnection;
  /** Close the connection if it doesn't authenticate within this many ms. */
  authTimeoutMs?: number;
  onClose?: () => void;
}

/**
 * Base for a token-authenticated connection. The client's first message must be
 * `{ type: "auth", token }`; on a match the session is authenticated and acked
 * with `{ type: "auth_ok" }`, otherwise (wrong/malformed/non-auth first frame,
 * or an auth-timeout) the connection is closed. Subclasses supply what happens
 * on auth, per post-auth message, and on teardown — the security-sensitive
 * handshake lives here once.
 */
export abstract class AuthenticatedSession {
  private authed = false;
  private closed = false;
  private authTimer: ReturnType<typeof setTimeout> | undefined;
  protected readonly connection: BridgeConnection;
  private readonly token: string;
  private readonly onCloseCb: (() => void) | undefined;

  constructor(opts: AuthenticatedSessionOptions) {
    this.connection = opts.connection;
    this.token = opts.token;
    this.onCloseCb = opts.onClose;
    opts.connection.onMessage((data) => this.onMessage(data));
    opts.connection.onClose(() => this.handleClose());
    if (opts.authTimeoutMs && opts.authTimeoutMs > 0) {
      this.authTimer = setTimeout(() => {
        if (!this.authed) opts.connection.close();
      }, opts.authTimeoutMs);
    }
  }

  get isAuthenticated(): boolean {
    return this.authed;
  }

  /** Serialize and send a value over the connection. */
  protected send(value: unknown): void {
    this.connection.send(JSON.stringify(value));
  }

  /** Runs once on successful auth, before `auth_ok` is sent. May throw to
   *  reject the connection (e.g. a resource it needs fails to start). */
  protected abstract onAuthenticated(): void;
  /** Handle a parsed post-auth message (subclass validates its own shape). */
  protected abstract onAuthedMessage(msg: unknown): void;
  /** Tear down resources on disconnect. */
  protected abstract onDisposed(): void;

  private onMessage(data: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(data);
    } catch {
      // A malformed handshake is fatal; after auth, just drop the bad frame.
      if (!this.authed) this.connection.close();
      return;
    }

    if (!this.authed) {
      const m = msg as { type?: string; token?: string };
      if (m?.type === "auth" && m.token === this.token) {
        clearTimeout(this.authTimer);
        try {
          this.onAuthenticated();
          this.authed = true;
          this.send({ type: "auth_ok" });
        } catch {
          this.connection.close();
        }
      } else {
        this.connection.close();
      }
      return;
    }

    this.onAuthedMessage(msg);
  }

  private handleClose(): void {
    if (this.closed) return; // run teardown exactly once
    this.closed = true;
    clearTimeout(this.authTimer);
    this.authed = false;
    this.onDisposed();
    this.onCloseCb?.();
  }
}
