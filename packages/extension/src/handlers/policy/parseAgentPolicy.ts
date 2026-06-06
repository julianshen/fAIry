import type { AgentPolicy, AgentPolicyResult, PolicyFetch } from "./policyTypes";

/** Max body size (bytes) — guard against excessively large policy files. */
const MAX_BODY_BYTES = 1_000_000;

/**
 * Classify a PolicyFetch into an AgentPolicyResult.
 * - level 0: fetch failed (status 0 or 400+, body missing, oversized, invalid JSON, or missing/non-1.x version)
 * - level 1: valid v1 policy with no structured actions and no governance fields
 * - level 2: valid v1 policy with at least one structured action
 * - level 3: valid v1 policy with governance fields (prohibited / consent); max-wins over level 2
 */
export function parseAgentPolicy(fetch: PolicyFetch): AgentPolicyResult {
  const { origin, status, body } = fetch;

  if (status === 0 || status >= 400 || body === null) {
    return { level: 0, origin };
  }

  if (body.length > MAX_BODY_BYTES) {
    return { level: 0, origin };
  }

  let policy: AgentPolicy;
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { level: 0, origin };
    }
    policy = parsed as AgentPolicy;
  } catch {
    return { level: 0, origin };
  }

  // Version must be a string starting with "1."
  if (typeof policy.version !== "string" || !policy.version.startsWith("1.")) {
    return { level: 0, origin };
  }

  const safeOrigin = origin ?? "";

  const hasGovernance =
    (Array.isArray(policy.prohibited) && policy.prohibited.length > 0) ||
    (typeof policy.consent === "object" && policy.consent !== null);

  if (hasGovernance) {
    return { level: 3, origin: safeOrigin, policy };
  }

  const hasActions = Array.isArray(policy.actions) && policy.actions.length > 0;
  if (hasActions) {
    return { level: 2, origin: safeOrigin, policy };
  }

  return { level: 1, origin: safeOrigin, policy };
}
