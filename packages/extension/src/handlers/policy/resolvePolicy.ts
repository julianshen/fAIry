import type { CdpClient } from "../../cdp/cdpClient";
import { evaluateExpression } from "../evaluate";
import { FETCH_POLICY_JS } from "./fetchPolicyScript";
import { parseAgentPolicy } from "./parseAgentPolicy";
import type { AgentPolicyResult, PolicyFetch } from "./policyTypes";

/** Normalize the (page-supplied, untrusted) evaluate result into a PolicyFetch. */
function coerceFetch(v: unknown): PolicyFetch {
  if (typeof v === "object" && v !== null) {
    const o = v as Record<string, unknown>;
    return {
      origin: typeof o.origin === "string" ? o.origin : null,
      status: typeof o.status === "number" ? o.status : 0,
      body: typeof o.body === "string" ? o.body : null,
    };
  }
  return { origin: null, status: 0, body: null };
}

/**
 * Resolve + classify the active page's /agent.json (advisory): run a same-origin
 * fetch in the page via evaluate, then classify with parseAgentPolicy. Shared by
 * getAgentPolicy and invokeStructuredAction.
 */
export async function resolvePolicy(cdp: CdpClient): Promise<AgentPolicyResult> {
  const fetched = coerceFetch(await evaluateExpression(cdp, FETCH_POLICY_JS));
  // status 0 = the page fetch never got an HTTP response (network error, timeout/
  // abort, CORS) — a transport failure, not a "no policy" answer. Throw so callers
  // can tell it apart from a real 404 (which classifies as level 0): navigate
  // enrichment caches level-0 results, and caching a transient failure as "no
  // policy" would stick for the whole session.
  if (fetched.status === 0) throw new Error("agent policy fetch failed");
  return parseAgentPolicy(fetched);
}
