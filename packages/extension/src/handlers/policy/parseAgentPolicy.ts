import type { AgentPolicy, AgentPolicyResult, PolicyFetch } from "./policyTypes";

/** Don't parse a hostile/huge response — treat it as no usable policy. */
const MAX_BODY_BYTES = 1_000_000;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function nonEmptyArray(v: unknown): boolean {
  return Array.isArray(v) && v.length > 0;
}

/**
 * Parse + classify a fetched /agent.json. Pure, never throws: anything that isn't a
 * usable Agent Policy v1 returns level 0 (with whatever origin the fetch reported).
 * Level is max-wins: 1 = valid basic, 2 = non-empty actions, 3 = governance fields.
 */
export function parseAgentPolicy(fetched: PolicyFetch): AgentPolicyResult {
  const { origin } = fetched;
  if (fetched.status !== 200 || fetched.body === null || fetched.body.length > MAX_BODY_BYTES) {
    return { level: 0, origin };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fetched.body);
  } catch {
    return { level: 0, origin };
  }
  if (!isObject(parsed)) return { level: 0, origin };

  const { version, site } = parsed;
  if (typeof version !== "string" || !/^1\./.test(version) || typeof site !== "string") {
    return { level: 0, origin };
  }
  const policy = parsed as AgentPolicy;

  let level: 1 | 2 | 3 = 1;
  if (nonEmptyArray(policy.actions)) level = 2;
  const hasGovernance =
    nonEmptyArray(policy.requires_human) ||
    nonEmptyArray(policy.prohibited) ||
    isObject(policy.consent) ||
    isObject(policy.safety);
  if (hasGovernance) level = 3;

  return { level, origin, policy };
}
