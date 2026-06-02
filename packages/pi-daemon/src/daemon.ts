import { BridgeServer } from "./bridgeServer";
import { ConversationServer } from "./conversationServer";
import { HttpServer } from "./httpServer";
import type { Spawner } from "./jsonLineProcess";
import type { SettingsStore } from "./settings";

export interface DaemonOptions {
  /** Per-session token every client (extension, panel, shell) must present. */
  token: string;
  /** Settings source of truth (provider/model config); backs the HTTP endpoint. */
  settings: SettingsStore;
  /** Spawns Pi for each conversation (injected — testable without a real `pi`). */
  spawn: Spawner;
  /** Loopback host for all three servers. Defaults to 127.0.0.1. */
  host?: string;
  /** Exact Origin values allowed across all servers (see {@link import("./origin")}). */
  allowedOrigins?: string[];
  /** Close an unauthenticated WS connection after this many ms. */
  authTimeoutMs?: number;
  /** Max HTTP body size. */
  maxBodyBytes?: number;
  /** Fixed ports; any omitted one binds an ephemeral port. */
  ports?: { bridge?: number; conversation?: number; http?: number };
}

export interface DaemonPorts {
  bridge: number;
  conversation: number;
  http: number;
}

export interface RunningDaemon {
  readonly ports: DaemonPorts;
  /** Stop all servers. */
  close(): Promise<void>;
}

/**
 * Compose the daemon's three loopback servers — the browser {@link BridgeServer},
 * the panel {@link ConversationServer}, and the {@link HttpServer} control plane —
 * sharing one token and Origin policy. Resolves once all are listening, with the
 * bound ports and a `close()` that stops them. If any fails to bind, the ones
 * that started are torn down and the error is rethrown.
 *
 * The caller owns the pieces below this seam: the {@link SettingsStore} (which
 * materializes Pi's config) and the `spawn` of the real `pi` binary.
 */
export async function createDaemon(opts: DaemonOptions): Promise<RunningDaemon> {
  const { token, host, allowedOrigins, authTimeoutMs } = opts;
  const bridge = new BridgeServer({ token, host, allowedOrigins, authTimeoutMs, port: opts.ports?.bridge });
  const conversation = new ConversationServer({
    token,
    spawn: opts.spawn,
    host,
    allowedOrigins,
    authTimeoutMs,
    port: opts.ports?.conversation,
  });
  const http = new HttpServer({
    token,
    settings: opts.settings,
    host,
    allowedOrigins,
    maxBodyBytes: opts.maxBodyBytes,
    port: opts.ports?.http,
  });
  const servers = [bridge, conversation, http];
  const closeAll = (): Promise<void> => Promise.all(servers.map((s) => s.close())).then(() => undefined);

  // allSettled (not Promise.all) so every server has finished starting before we
  // decide — otherwise closing on an early rejection could miss a server still
  // mid-bind and leak it.
  const results = await Promise.allSettled([bridge.listen(), conversation.listen(), http.listen()]);
  const failure = results.find((r) => r.status === "rejected");
  if (failure) {
    await closeAll();
    throw (failure as PromiseRejectedResult).reason;
  }
  const port = (i: number): number => (results[i] as PromiseFulfilledResult<number>).value;

  return {
    ports: { bridge: port(0), conversation: port(1), http: port(2) },
    close: closeAll,
  };
}
