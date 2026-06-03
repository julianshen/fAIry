import { AuthenticatedSession, type BridgeConnection } from "./authenticatedSession";
import type { PanelBeat } from "./beatMapper";

/** What the session needs from a conversation controller (satisfied by `ConversationController`). */
export interface ConversationDriver {
  start(task: string): void;
  stop(): void;
  compact(customInstructions?: string): void;
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
 * One authenticated panel/client connection. After the token handshake (see
 * {@link AuthenticatedSession}), the client sends commands
 * (`{ type: "start", task }` / `{ type: "stop" }`) and receives panel beats
 * (`{ type: "beat", beat }`). Drives a {@link ConversationDriver}, created on
 * auth so Pi only spawns once a client connects; on disconnect it's disposed.
 */
export class ConversationSession extends AuthenticatedSession {
  private driver: ConversationDriver | undefined;

  constructor(private readonly opts: ConversationSessionOptions) {
    super({
      token: opts.token,
      connection: opts.connection,
      authTimeoutMs: opts.authTimeoutMs,
      onClose: opts.onClose,
    });
  }

  protected onAuthenticated(): void {
    // May throw (Pi spawn failure); the base then closes without authenticating.
    this.driver = this.opts.createDriver((beat) => this.sendBeat(beat));
  }

  protected onAuthedMessage(msg: unknown): void {
    if (typeof msg !== "object" || msg === null) return;
    const cmd = msg as { type?: string; task?: unknown };
    if (cmd.type === "start" && typeof cmd.task === "string") {
      this.driver?.start(cmd.task);
    } else if (cmd.type === "stop") {
      this.driver?.stop();
    }
    // Unknown commands are ignored.
  }

  /** Compact this conversation's history — invoked by the daemon's tool-router
   *  when the active conversation's Pi calls `browser_compact`. No-op if the
   *  driver isn't up yet (pre-auth) or already disposed. */
  compact(customInstructions?: string): void {
    this.driver?.compact(customInstructions);
  }

  protected onDisposed(): void {
    this.driver?.dispose();
    this.driver = undefined;
  }

  private sendBeat(beat: PanelBeat): void {
    // The driver emits beats asynchronously; drop any that arrive after close.
    if (!this.isAuthenticated) return;
    this.send({ type: "beat", beat });
  }
}
