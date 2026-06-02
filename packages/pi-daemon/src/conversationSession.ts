import type { BridgeConnection } from "./bridgeSession";
import type { PanelBeat } from "./beatMapper";

/** What the session needs from a conversation controller (satisfied by `ConversationController`). */
export interface ConversationDriver {
  start(task: string): void;
  stop(): void;
  dispose(): void;
}

export interface ConversationSessionOptions {
  /** Expected per-session token; the client must present it first. */
  token: string;
  connection: BridgeConnection;
  /** Builds the driver once authenticated, wiring its beats to `onBeat`. */
  createDriver: (onBeat: (beat: PanelBeat) => void) => ConversationDriver;
  /** Close the connection if it doesn't authenticate within this many ms. */
  authTimeoutMs?: number;
  onClose?: () => void;
}

/**
 * One authenticated panel/client connection. The client's first message must be
 * `{ type: "auth", token }`; after that it sends commands
 * (`{ type: "start", task }` / `{ type: "stop" }`) and receives panel beats
 * (`{ type: "beat", beat }`). Drives a {@link ConversationDriver}, created on
 * auth so Pi only spawns once a client connects. On disconnect, the driver is
 * disposed.
 *
 * (Shares the token handshake shape with `BridgeSession`; a shared
 * authenticated-session helper is a candidate refactor.)
 */
export class ConversationSession {
  private authed = false;
  private driver: ConversationDriver | undefined;
  private authTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly opts: ConversationSessionOptions) {
    opts.connection.onMessage((data) => this.onMessage(data));
    opts.connection.onClose(() => this.onClose());
    if (opts.authTimeoutMs && opts.authTimeoutMs > 0) {
      this.authTimer = setTimeout(() => {
        if (!this.authed) opts.connection.close();
      }, opts.authTimeoutMs);
    }
  }

  get isAuthenticated(): boolean {
    return this.authed;
  }

  private onMessage(data: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(data);
    } catch {
      if (!this.authed) this.opts.connection.close();
      return;
    }

    if (!this.authed) {
      const m = msg as { type?: string; token?: string };
      if (m?.type === "auth" && m.token === this.opts.token) {
        this.authed = true;
        clearTimeout(this.authTimer);
        this.driver = this.opts.createDriver((beat) => this.sendBeat(beat));
        this.opts.connection.send(JSON.stringify({ type: "auth_ok" }));
      } else {
        this.opts.connection.close();
      }
      return;
    }

    if (typeof msg !== "object" || msg === null) return;
    const cmd = msg as { type?: string; task?: unknown };
    if (cmd.type === "start" && typeof cmd.task === "string") {
      this.driver?.start(cmd.task);
    } else if (cmd.type === "stop") {
      this.driver?.stop();
    }
    // Unknown commands are ignored.
  }

  private sendBeat(beat: PanelBeat): void {
    this.opts.connection.send(JSON.stringify({ type: "beat", beat }));
  }

  private onClose(): void {
    clearTimeout(this.authTimer);
    this.authed = false;
    this.driver?.dispose();
    this.opts.onClose?.();
  }
}
