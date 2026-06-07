import { ConversationController } from "./conversation";
import { ConversationSession } from "./conversationSession";
import { WsServer } from "./wsServer";
import type { Spawner } from "./jsonLineProcess";

export interface ConversationServerOptions {
  /** Expected per-session token the panel/client must present first. */
  token: string;
  /** Spawns Pi for each conversation (injected — testable without a real `pi`). */
  spawn: Spawner;
  /** Persist a user-confirmed save proposal (skill→domainSkills, action→actionsStore).
   *  Threaded into each conversation's {@link ConversationController}. */
  saveProposal?: (proposal: unknown) => Promise<void>;
  /** The current saved-actions list, threaded into each conversation. */
  listActions?: () => import("./beatMapper").SavedActionView[];
  /** Port to bind; 0 (default) picks an ephemeral port. */
  port?: number;
  /** Loopback host. Defaults to 127.0.0.1 — local-only. */
  host?: string;
  /** Exact Origin values allowed (see WsServer); defaults to blocking web origins. */
  allowedOrigins?: string[];
  /** Close a connection that doesn't authenticate within this many ms. */
  authTimeoutMs?: number;
  /** Called with each connection's session once it's wired up (at connect). */
  onSession?: (session: ConversationSession) => void;
  /** Called when a session completes the token handshake (after `onSession`). */
  onAuthenticated?: (session: ConversationSession) => void;
  /** Called when a session closes. */
  onClose?: (session: ConversationSession) => void;
}

/**
 * Loopback WebSocket server for panel/client conversations. Wraps each
 * connection in a {@link ConversationSession} whose driver is a fresh
 * {@link ConversationController} (so Pi spawns only once a client authenticates
 * and starts a task). The bridge analogue is {@link import("./bridgeServer")};
 * both delegate accept/lifecycle/origin handling to {@link WsServer}.
 */
export class ConversationServer {
  private readonly server: WsServer;

  constructor(opts: ConversationServerOptions) {
    this.server = new WsServer({
      port: opts.port,
      host: opts.host,
      allowedOrigins: opts.allowedOrigins,
      onConnection: (connection) => {
        const session = new ConversationSession({
          token: opts.token,
          connection,
          authTimeoutMs: opts.authTimeoutMs,
          createDriver: (onBeat) =>
            new ConversationController({ spawn: opts.spawn, onBeat, saveProposal: opts.saveProposal, listActions: opts.listActions }),
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
