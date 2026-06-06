/** Shapes for the Agent Policy (/agent.json) resolver — see the design doc. */

/** A site-declared structured action (level >= 2). */
export interface AgentAction {
  name: string;
  endpoint: string; // "METHOD /path/:id"
  args_schema?: Record<string, unknown>;
  auth?: string; // "none" | "cookie" | ...
  rate_limit?: string; // "N/s" | "N/m" | "N/h"
  idempotent?: boolean;
}

/** The /agent.json document (Agent Policy v1). Typed for what we read; extra keys pass through. */
export interface AgentPolicy {
  version: string; // "1.x"
  site: string;
  summary?: string;
  capabilities?: Record<string, unknown>;
  objectives?: unknown[];
  actions?: AgentAction[];
  requires_human?: unknown[];
  prohibited?: unknown[];
  consent?: Record<string, unknown>;
  safety?: Record<string, unknown>;
  audit?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Raw result of the page-side fetch of /agent.json. */
export interface PolicyFetch {
  origin: string | null;
  status: number; // HTTP status, or 0 on a network/throw error
  body: string | null; // response text when ok, else null
}

/** What getAgentPolicy returns to the agent. */
export interface AgentPolicyResult {
  level: 0 | 1 | 2 | 3;
  origin: string | null;
  policy?: AgentPolicy;
}

/** A validated, ready-to-issue request derived from an AgentAction + args. */
export interface ActionRequest {
  method: string; // GET | POST | PUT | PATCH | DELETE | HEAD
  path: string; // origin-relative, with :params substituted (e.g. "/api/orders/42")
  body?: Record<string, unknown>; // JSON body for write methods; absent for GET/HEAD
}

/** What the page-side fetch returns / invokeStructuredAction returns to the agent. */
export interface InvokeResult {
  status: number; // HTTP status, or 0 on a network/throw error
  ok: boolean; // response.ok (false on 4xx/5xx and on network error)
  body: unknown; // parsed JSON, or raw text, or an error string
}
