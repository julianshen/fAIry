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
 * Fetch + classify the active page's /agent.json (advisory). Runs a same-origin
 * fetch in the page via evaluate, then classifies with parseAgentPolicy. Takes no
 * parameters (`args` is ignored).
 */
export async function getAgentPolicy(
  cdp: CdpClient,
  _args: Record<string, unknown>,
): Promise<AgentPolicyResult> {
  const fetched = await evaluateExpression(cdp, FETCH_POLICY_JS);
  return parseAgentPolicy(coerceFetch(fetched));
}
