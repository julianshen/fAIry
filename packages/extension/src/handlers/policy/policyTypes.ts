/** A structured action the site exposes to agents. */
export interface PolicyAction {
  name: string;
  endpoint: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

/** The parsed shape of a site's /agent.json. */
export interface AgentPolicy {
  version: string;
  site?: string;
  prohibited?: unknown[];
  requires_human?: string[];
  consent?: Record<string, unknown>;
  actions?: PolicyAction[];
}

/** The raw fetch result returned by the page-side script. */
export interface PolicyFetch {
  origin: string | null;
  status: number;
  body: string | null;
}

/**
 * Classification result returned to the agent.
 *
 * - level 0: no policy (fetch failed or no /agent.json)
 * - level 1: policy present, no structured actions, no governance fields
 * - level 2: policy present with at least one structured action
 * - level 3: policy present with governance fields (prohibited / consent)
 */
export type AgentPolicyResult =
  | { level: 0; origin: string | null; policy?: never }
  | { level: 1; origin: string; policy: AgentPolicy }
  | { level: 2; origin: string; policy: AgentPolicy }
  | { level: 3; origin: string; policy: AgentPolicy };
