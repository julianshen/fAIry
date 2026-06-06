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
 * Relay `navigate`, then enrich the result (best-effort, additive) with the
 * requested host's `domainSkillsAvailable` (daemon-local) and `agentPolicy`
 * (relayed getAgentPolicy, cached per origin for the session). A failed navigate
 * propagates; each enrichment field is independent and omitted on failure;
 * getAgentPolicy failures are not cached. The daemon stays policy-agnostic
 * (agentPolicy is opaque — only its `.origin` is read, to gate/key it).
 *
 * navigate resolves before the new document commits, so getAgentPolicy may read
 * the *previous* (or a cross-origin redirect) document. Two guards keep that from
 * misleading the caller: the policy is cached under the origin it actually reports
 * (never poisoning the requested origin), and it is surfaced only when that origin
 * matches the requested one — a mismatch is dropped for this navigate and
 * self-heals on the next. domainSkillsAvailable is keyed by the requested host
 * (where the agent asked to go), independent of the policy read.
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
      // Key by the origin the policy reports (the document actually read), not the
      // requested origin: a stale/pre-commit read then caches under the old origin
      // (harmless) instead of poisoning the requested one.
      deps.cache.set(readOrigin(agentPolicy) ?? origin, agentPolicy);
    } catch {
      agentPolicy = undefined; // best-effort / transient — don't cache, retry next time
    }
  }
  // Surface the policy only when it belongs to the requested origin; a mismatch
  // (stale read or cross-origin redirect) is dropped rather than misreported.
  const matchedPolicy = agentPolicy !== undefined && readOrigin(agentPolicy) === origin ? agentPolicy : undefined;

  const host = hostOf(origin);
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
    ...(matchedPolicy !== undefined ? { agentPolicy: matchedPolicy } : {}),
  };
}
