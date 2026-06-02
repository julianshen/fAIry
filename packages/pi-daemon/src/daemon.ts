import { BridgeServer } from "./bridgeServer";
import type { BridgeSession } from "./bridgeSession";
import { ConversationServer } from "./conversationServer";
import { HttpServer } from "./httpServer";
import type { ChildLike } from "./jsonLineProcess";
import type { PairingStore } from "./pairing";
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
  /** Enables `POST /pair` so the extension can redeem a code for the token. */
  pairing?: PairingStore;
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

  // The active Chrome session Pi's tool calls relay to (v1 = one browser, newest
  // authenticated wins). Promote only on successful auth — `onSession` fires at
  // connect, before the token is proven, so a stray/unauthenticated socket must
  // not displace a working browser — and clear on close so a disconnected browser
  // reports "no browser connected".
  let chrome: BridgeSession | undefined;
  const bridge = new BridgeServer({
    token,
    host,
    allowedOrigins,
    authTimeoutMs,
    port: opts.ports?.bridge,
    onAuthenticated: (session) => (chrome = session),
    onClose: (session) => {
      if (chrome === session) chrome = undefined;
    },
  });

  const piBridge = new PiBridgeServer({
    token,
    host,
    authTimeoutMs,
    port: opts.ports?.piBridge,
    requestTool: (tool, args) =>
      chrome ? chrome.requestTool(tool, args) : Promise.reject(new Error("no browser connected")),
  });

  // The WS ports are known only once those servers are listening (below); the
  // spawn closure and the /info provider run later (a panel connects / a paired
  // client asks), so they read these vars after they're resolved.
  let bridgePort = 0;
  let piBridgePort = 0;
  let conversationPort = 0;
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
    pairing: opts.pairing,
    // Lets a paired client discover the ephemeral WS ports it must connect to.
    info: () => ({ bridgePort, conversationPort }),
    port: opts.ports?.http,
  });

  const servers = [bridge, piBridge, conversation, http];
  const closeAll = (): Promise<void> => Promise.all(servers.map((s) => s.close())).then(() => undefined);

  // Start the given servers concurrently; if any fails to bind, tear the rest
  // down (so a half-started set can't leak) and rethrow the bind error.
  const settle = async (starts: Array<Promise<number>>): Promise<PromiseSettledResult<number>[]> => {
    const results = await Promise.allSettled(starts);
    const failure = results.find((r) => r.status === "rejected");
    if (failure) {
      /* v8 ignore next */
      await closeAll().catch(() => {});
      throw (failure as PromiseRejectedResult).reason;
    }
    return results;
  };
  const val = (rs: PromiseSettledResult<number>[], i: number): number =>
    (rs[i] as PromiseFulfilledResult<number>).value;

  // Bring up the WS servers first; their ports feed /info and the Pi spawner.
  const ws = await settle([bridge.listen(), piBridge.listen(), conversation.listen()]);
  bridgePort = val(ws, 0);
  piBridgePort = val(ws, 1);
  conversationPort = val(ws, 2);

  // Only now start the HTTP anchor — so a client reaching its fixed port can
  // never see /info report unresolved (0) WS ports.
  const httpPort = val(await settle([http.listen()]), 0);

  return {
    ports: { bridge: bridgePort, piBridge: piBridgePort, conversation: conversationPort, http: httpPort },
    close: closeAll,
  };
}
