import type { ActionRecorder } from "./actionRecorder";
import type { ActionsStore } from "./actionsStore";
import { BridgeServer } from "./bridgeServer";
import type { BridgeSession } from "./bridgeSession";
import { ConversationServer } from "./conversationServer";
import type { ConversationSession } from "./conversationSession";
import type { DomainSkills } from "./domainSkills";
import type { HelperRegistry } from "./helperRegistry";
import { HttpServer } from "./httpServer";
import type { ChildLike } from "./jsonLineProcess";
import type { PairingStore } from "./pairing";
import { PiBridgeServer } from "./piBridgeServer";
import { createPolicyCache } from "./policyCache";
import { enrichNavigate } from "./enrichNavigate";
import type { SettingsStore } from "./settings";
import type { SkillsLibrary } from "./skillsLibrary";
import { createToolRouter } from "./toolRouter";

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
  /** Bundled skills library — served by the daemon's tool-router (not the browser). */
  skills: SkillsLibrary;
  /** Persistent JS-helper registry — served by the tool-router (callHelper relays an evaluate). */
  helpers: HelperRegistry;
  /** Per-site notes store — served by the tool-router (all local). */
  domainSkills: DomainSkills;
  /** Saved-actions store — a user-confirmed action proposal is persisted here. */
  actionsStore: ActionsStore;
  /** Records the agent's tool stream into replayable workflows (tool-router served). */
  recorder: ActionRecorder;
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

type CoercedProposal =
  | { kind: "skill"; name: string; content: string; host: string }
  | { kind: "action"; name: string; content: string; attach: "activeTab" | "allTabs" | "none"; host?: string };

/**
 * Validate an (opaque, untrusted-ish) save proposal the panel relayed back after
 * the user confirmed it. Skill proposals must name a host (they file under it);
 * action proposals default `attach` to "none" if absent/unknown.
 */
export function coerceProposal(v: unknown): CoercedProposal {
  if (typeof v !== "object" || v === null) throw new Error("invalid proposal");
  const o = v as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name.trim() : "";
  const content = typeof o.content === "string" ? o.content : "";
  if (name.length === 0) throw new Error("proposal name required");
  if (content.trim().length === 0) throw new Error("proposal content required");
  if (o.kind === "skill") {
    const host = typeof o.host === "string" ? o.host.trim() : "";
    // Validate at the boundary (domainSkills.normalizeHost is the path-safety
    // backstop, but a clear message here beats a leaked "invalid host" from disk).
    if (host.length === 0 || /[\\/\0<>:"|?*]/.test(host) || host === "." || host === "..") {
      throw new Error("a skill proposal needs a valid host");
    }
    return { kind: "skill", name, content, host };
  }
  if (o.kind === "action") {
    const attach = o.attach === "activeTab" || o.attach === "allTabs" || o.attach === "none" ? o.attach : "none";
    return { kind: "action", name, content, attach, host: typeof o.host === "string" ? o.host : undefined };
  }
  throw new Error(`unknown proposal kind: ${String(o.kind)}`);
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

  // The active conversation the tool-router's `compact` targets. Promoted only
  // on successful auth (not at connect — a stray socket must not displace a live
  // conversation) and cleared on close — symmetric with `chrome` above.
  // v1 assumes ONE conversation: a daemon-owned tool call carries no conversation
  // identity, so `compact` (and any future stateful daemon tool) targets the
  // single active one. Multi-conversation needs the piBridge connection
  // correlated to its spawning ConversationSession.
  let activeConversation: ConversationSession | undefined;

  // Relay a tool to the active Chrome executor (or fail if none is connected).
  const relayToBrowser = (tool: string, args: Record<string, unknown>): Promise<unknown> =>
    chrome ? chrome.requestTool(tool, args) : Promise.reject(new Error("no browser connected"));

  // Per-origin Agent Policy cache so navigate-enrichment doesn't re-fetch
  // /agent.json on every same-host navigation (session-lifetime).
  const policyCache = createPolicyCache();

  // The full routing: daemon-owned tools handled locally, everything else relayed
  // to the browser. A hoisted declaration so the router's `dispatch` (workflow
  // replay) and requestTool can both close over it while it forward-references
  // `router` below. It carries NO capture hook, so replaying a workflow's steps
  // doesn't re-record them. Navigate-enrichment is deliberately NOT here: it's a
  // Pi-facing concern applied in `requestTool` below, so workflow replay (which
  // routes through `dispatch`) does a plain navigate, not a wasted policy fetch.
  function route(tool: string, args: Record<string, unknown>): Promise<unknown> {
    return router.owns(tool) ? router.handle(tool, args) : relayToBrowser(tool, args);
  }

  // Daemon-owned tools (helpers/skills/domain-skills/workflows/compact) are
  // handled here, not forwarded to the browser. compact reaches the active
  // conversation's Pi; callHelper resolves the helper source then relays an
  // `evaluate`; workflowRun replays its steps through `dispatch`.
  const router = createToolRouter({
    skills: opts.skills,
    helpers: opts.helpers,
    domainSkills: opts.domainSkills,
    recorder: opts.recorder,
    relay: relayToBrowser,
    dispatch: route,
    compact: (customInstructions) => {
      if (!activeConversation?.compact(customInstructions)) {
        // Undefined (no conversation) or false (not yet authenticated / disposed):
        // surface it as a tool error rather than a false "ok".
        throw new Error("no active conversation to compact");
      }
    },
  });

  const piBridge = new PiBridgeServer({
    token,
    host,
    authTimeoutMs,
    port: opts.ports?.piBridge,
    // Route the call, then (on success) offer browser-effecting tools to the
    // recorder. Daemon-owned tools aren't browser steps and so aren't recorded
    // (keeping compact / saveHelper / workflow* out of workflows) — EXCEPT
    // callHelper, the one daemon tool that runs in the page (it relays an
    // evaluate), so a workflow that uses a saved helper replays it. capture
    // itself drops the browser *reads*. navigate is enriched here (best-effort
    // domain-skills + agent-policy) — a Pi-facing concern, so replay (which uses
    // `dispatch`/`route`, not this seam) does a plain navigate. The captured
    // workflow step is still the bare navigate; the inner getAgentPolicy relay
    // bypasses this seam (via relayToBrowser) and so isn't recorded.
    requestTool: async (tool, args) => {
      const result =
        tool === "navigate"
          ? await enrichNavigate(args, { relay: relayToBrowser, domainSkills: opts.domainSkills, cache: policyCache })
          : await route(tool, args);
      if (!router.owns(tool) || tool === "callHelper") opts.recorder.capture(tool, args);
      return result;
    },
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
    // A user-confirmed save proposal (panel → conversation WS) routes here:
    // skill → domainSkills, action → actionsStore. coerceProposal guards shape.
    saveProposal: async (proposal: unknown) => {
      const p = coerceProposal(proposal);
      if (p.kind === "skill") {
        await opts.domainSkills.save(p.host, p.name, p.content);
      } else {
        opts.actionsStore.save({ name: p.name, content: p.content, attach: p.attach, host: p.host });
      }
    },
    onAuthenticated: (session) => (activeConversation = session),
    onClose: (session) => {
      if (activeConversation === session) activeConversation = undefined;
    },
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
