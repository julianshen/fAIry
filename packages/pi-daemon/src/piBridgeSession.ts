import { AuthenticatedSession, type BridgeConnection } from "./authenticatedSession";

/** Relays an authenticated tool call to the executor (the Chrome bridge). */
export type ToolRelay = (tool: string, args: Record<string, unknown>) => Promise<unknown>;

export interface PiBridgeSessionOptions {
  /** Expected per-session token; the Pi extension presents it as its first line. */
  token: string;
  connection: BridgeConnection;
  /** Relay a tool call to the executor; its result/error is returned to Pi. */
  requestTool: ToolRelay;
  /** Close the connection if it doesn't authenticate within this many ms. */
  authTimeoutMs?: number;
  onClose?: () => void;
}

/**
 * One authenticated connection from Pi's `browser` extension. After the token
 * handshake (see {@link AuthenticatedSession}), Pi sends `{ id, tool, args }`
 * frames; each is relayed to the executor via `requestTool` and answered with a
 * matching `{ id, ok, result }` / `{ id, ok: false, error }`. This is the
 * inverse of {@link import("./bridgeSession").BridgeSession}: there the daemon
 * *issues* tool calls to the Chrome extension; here Pi issues them and the
 * daemon relays to that same Chrome bridge.
 */
export class PiBridgeSession extends AuthenticatedSession {
  constructor(private readonly opts: PiBridgeSessionOptions) {
    super({
      token: opts.token,
      connection: opts.connection,
      authTimeoutMs: opts.authTimeoutMs,
      onClose: opts.onClose,
    });
  }

  protected onAuthenticated(): void {}

  protected onAuthedMessage(msg: unknown): void {
    if (typeof msg !== "object" || msg === null) return;
    const call = msg as { id?: unknown; tool?: unknown; args?: unknown };
    if (typeof call.id !== "string" || typeof call.tool !== "string") return;
    const id = call.id;
    const tool = call.tool;
    const args =
      typeof call.args === "object" && call.args !== null && !Array.isArray(call.args)
        ? (call.args as Record<string, unknown>)
        : {};
    // Promise.resolve().then so a *synchronous* throw from requestTool becomes a
    // rejected reply rather than an uncaught exception that crashes the daemon.
    Promise.resolve()
      .then(() => this.opts.requestTool(tool, args))
      .then(
        (result) => this.reply({ id, ok: true, result }),
        (err) => this.reply({ id, ok: false, error: err instanceof Error ? err.message : String(err) }),
      );
  }

  protected onDisposed(): void {}

  /** Send a response, unless the connection closed while the relay was in flight. */
  private reply(response: { id: string; ok: boolean; result?: unknown; error?: string }): void {
    if (this.isAuthenticated) this.send(response);
  }
}
