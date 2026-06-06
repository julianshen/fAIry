import type { CdpClient } from "../../cdp/cdpClient";
import type { AgentPolicyResult } from "./policyTypes";
import { resolvePolicy } from "./resolvePolicy";

/**
 * Fetch + classify the active page's /agent.json (advisory). Delegates to the
 * shared resolver; takes no parameters (`args` is ignored).
 */
export async function getAgentPolicy(
  cdp: CdpClient,
  _args: Record<string, unknown>,
): Promise<AgentPolicyResult> {
  return resolvePolicy(cdp);
}
