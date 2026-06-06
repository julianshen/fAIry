import type { ActionRequest, AgentAction } from "./policyTypes";

const ENDPOINT_RE = /^(GET|POST|PUT|PATCH|DELETE|HEAD)\s+(\/\S*)$/i;
const PARAM_RE = /:([A-Za-z_][A-Za-z0-9_]*)/g;

/**
 * Turn a declared AgentAction + call args into a validated, origin-relative
 * request. Pure; throws a clear Error on any invalid input (malformed endpoint,
 * missing required args, unmet path param, unsupported auth).
 */
export function buildActionRequest(action: AgentAction, args: Record<string, unknown>): ActionRequest {
  // `action` comes from an untrusted /agent.json — validate defensively.
  if (typeof action.endpoint !== "string") {
    throw new Error(`invokeStructuredAction: malformed endpoint "${String(action.endpoint)}"`);
  }
  const m = ENDPOINT_RE.exec(action.endpoint);
  if (!m) throw new Error(`invokeStructuredAction: malformed endpoint "${action.endpoint}"`);
  const method = m[1]!.toUpperCase();
  const rawPath = m[2]!;

  // null is treated like absent (default auth); only an unknown non-null value is rejected.
  if (action.auth != null && action.auth !== "none" && action.auth !== "cookie") {
    throw new Error(`invokeStructuredAction: auth "${action.auth}" not supported in v1`);
  }

  // Only a plain object counts as a schema; a malformed args_schema (array/primitive) is ignored.
  if (typeof action.args_schema === "object" && action.args_schema !== null && !Array.isArray(action.args_schema)) {
    const missing = Object.keys(action.args_schema).filter((k) => !(k in args));
    if (missing.length > 0) {
      throw new Error(`invokeStructuredAction: missing required args: ${missing.join(", ")}`);
    }
  }

  const pathParams = new Set<string>();
  const path = rawPath.replace(PARAM_RE, (_full, name: string) => {
    // A present-but-null/undefined value would interpolate "null"/"undefined" — treat as missing.
    if (args[name] == null) throw new Error(`invokeStructuredAction: missing path param "${name}"`);
    pathParams.add(name);
    return encodeURIComponent(String(args[name]));
  });

  if (method === "GET" || method === "HEAD") return { method, path };
  // Path-interpolated args are consumed by the URL — don't duplicate them in the body.
  const body = Object.fromEntries(Object.entries(args).filter(([k]) => !pathParams.has(k)));
  return { method, path, body };
}
