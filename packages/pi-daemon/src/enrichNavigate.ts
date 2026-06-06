import type { DomainSkills } from "./domainSkills";
import type { PolicyCache } from "./policyCache";

/** Relay a tool to the browser executor (createDaemon's relayToBrowser). */
export type Relay = (tool: string, args: Record<string, unknown>) => Promise<unknown>;

export interface EnrichDeps {
  relay: Relay;
  domainSkills: DomainSkills;
  cache: PolicyCache;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The http(s) origin of a URL string, or null if not a parseable http(s) URL. */
function httpOrigin(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

function hostOf(originOrUrl: string | undefined): string | undefined {
  if (originOrUrl === undefined) return undefined;
  try {
    // `.hostname` (not `.host`) — drop any port. The domain-skills store keys by
    // bare hostname and rejects a host containing ":" (so "localhost:3000" would
    // silently yield no notes); identical to `.host` for default-port hosts.
    return new URL(originOrUrl).hostname;
  } catch {
    return undefined;
  }
}

/** Read `.origin` off an opaque policy result (the daemon doesn't type policies). */
function readOrigin(policy: unknown): string | undefined {
  return isObject(policy) && typeof policy.origin === "string" ? policy.origin : undefined;
}

/**
 * Relay `navigate`, then enrich the result (best-effort, additive) with the landed
 * host's `domainSkillsAvailable` (daemon-local) and `agentPolicy` (relayed
 * getAgentPolicy, cached per origin for the session). A failed navigate propagates;
 * each enrichment field is independent and omitted on failure; getAgentPolicy
 * failures are not cached. The daemon stays policy-agnostic (agentPolicy is opaque).
 */
export async function enrichNavigate(args: Record<string, unknown>, deps: EnrichDeps): Promise<unknown> {
  const base = await deps.relay("navigate", args);
  if (!isObject(base)) return base;
  const origin = httpOrigin(args.url);
  if (origin === null) return base;

  let agentPolicy = deps.cache.get(origin);
  if (agentPolicy === undefined) {
    try {
      agentPolicy = await deps.relay("getAgentPolicy", {});
      // Cache under the origin the policy actually reports (the document we read),
      // NOT the requested origin. navigate resolves before the new document
      // commits, so getAgentPolicy can read the previous (or a redirected)
      // document; keying by the reported origin means a stale read caches under
      // the old origin (harmless) instead of poisoning the requested origin — the
      // requested-origin lookup then self-heals on the next navigate.
      deps.cache.set(readOrigin(agentPolicy) ?? origin, agentPolicy);
    } catch {
      agentPolicy = undefined; // best-effort; don't cache failures
    }
  }

  const host = hostOf(readOrigin(agentPolicy)) ?? hostOf(origin);
  let domainSkillsAvailable: string[] | undefined;
  if (host !== undefined) {
    try {
      domainSkillsAvailable = await deps.domainSkills.list(host);
    } catch {
      domainSkillsAvailable = undefined; // best-effort
    }
  }

  return {
    ...base,
    ...(domainSkillsAvailable !== undefined ? { domainSkillsAvailable } : {}),
    ...(agentPolicy !== undefined ? { agentPolicy } : {}),
  };
}
