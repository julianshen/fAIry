import { BridgeServer } from "./bridgeServer";
import type { BridgeSession } from "./bridgeSession";
import { ConversationServer } from "./conversationServer";
import { HttpServer } from "./httpServer";
import type { ChildLike } from "./jsonLineProcess";
import { PiBridgeServer } from "./piBridgeServer";
import type { SettingsStore } from "./settings";

/** Loopback bridge the daemon hands Pi's `browser` extension (via env on spawn). */
export interface PiBridgeInfo {
  port: number;
  token: string;
}

export interface DaemonOptions {
  /** Per-session token every client (extension, panel, shell, Pi) must present. */
  token: string;
  /** Settings source of truth (provider/model config); backs the HTTP endpoint. */
  settings: SettingsStore;
  /** Spawn Pi for a conversation, given the loopback bridge it should connect back on. */
  spawnPi: (bridge: PiBridgeInfo) => ChildLike;
  /** Loopback host for all servers. Defaults to 127.0.0.1. */
  host?: string;
  /** Exact Origin values allowed for the WS servers (see {@link import("./origin")}). */
  allowedOrigins?: string[];
  /** Close an unauthenticated connection after this many ms. */
  authTimeoutMs?: number;
  /** Max HTTP body size. */
  maxBodyBytes?: number;
  /** Fixed ports; any omitted one binds an ephemeral port. */
  ports?: { bridge?: number; piBridge?: number; conversation?: number; http?: number };
}

export interface DaemonPorts {
  bridge: number;
  piBridge: number;
  conversation: number;
  http: number;
}

export interface RunningDaemon {
  readonly ports: DaemonPorts;
  /** Stop all servers. */
  close(): Promise<void>;
}

/**
 * Compose the daemon's loopback servers, sharing one token and Origin policy:
 *
 * - {@link BridgeServer} — the Chrome extension (the browser-tool *executor*);
 * - {@link PiBridgeServer} — Pi's `browser` extension (the *requester*), whose
 *   tool calls are relayed to the active Chrome session — closing the loop
 *   between a conversation's Pi and the browser;
 * - {@link ConversationServer} — the panel, spawning Pi pointed back at the
 *   piBridge;
 * - {@link HttpServer} — the settings/status control plane.
 *
 * Resolves once all are listening, with the bound ports and a `close()`. If any
 * fails to bind, the ones that started are torn down and the error is rethrown.
 * The caller owns the seam below: the {@link SettingsStore} and the real `pi`
 * spawn (`spawnPi`).
 */
export async function createDaemon(opts: DaemonOptions): Promise<RunningDaemon> {
  const { token, host, allowedOrigins, authTimeoutMs } = opts;

  // Track the latest authenticated Chrome session so Pi's tool calls can be
  // relayed to it. A closed session's requestTool rejects on its own, so a stale
  // reference is harmless; the newest connection wins (v1 = one browser).
  let chrome: BridgeSession | undefined;
  const bridge = new BridgeServer({
    token,
    host,
    allowedOrigins,
    authTimeoutMs,
    port: opts.ports?.bridge,
    onSession: (session) => (chrome = session),
  });

  const piBridge = new PiBridgeServer({
    token,
    host,
    authTimeoutMs,
    port: opts.ports?.piBridge,
    requestTool: (tool, args) =>
      chrome ? chrome.requestTool(tool, args) : Promise.reject(new Error("no browser connected")),
  });

  // Pi is spawned pointed back at the piBridge. Its port is known only once
  // piBridge is listening (below); spawn runs later (when a panel connects), so
  // the closure reads the resolved value.
  let piBridgePort = 0;
  const conversation = new ConversationServer({
    token,
    host,
    allowedOrigins,
    authTimeoutMs,
    port: opts.ports?.conversation,
    spawn: () => opts.spawnPi({ port: piBridgePort, token }),
  });

  const http = new HttpServer({
    token,
    settings: opts.settings,
    host,
    allowedOrigins,
    maxBodyBytes: opts.maxBodyBytes,
    port: opts.ports?.http,
  });

  const servers = [bridge, piBridge, conversation, http];
  const closeAll = (): Promise<void> => Promise.all(servers.map((s) => s.close())).then(() => undefined);

  const results = await Promise.allSettled([
    bridge.listen(),
    piBridge.listen(),
    conversation.listen(),
    http.listen(),
  ]);
  const failure = results.find((r) => r.status === "rejected");
  if (failure) {
    // Swallow any teardown error so it can't shadow the actual bind failure.
    /* v8 ignore next */
    await closeAll().catch(() => {});
    throw (failure as PromiseRejectedResult).reason;
  }
  const port = (i: number): number => (results[i] as PromiseFulfilledResult<number>).value;
  piBridgePort = port(1); // resolve the spawn closure's port before any conversation

  return {
    ports: { bridge: port(0), piBridge: port(1), conversation: port(2), http: port(3) },
    close: closeAll,
  };
}
