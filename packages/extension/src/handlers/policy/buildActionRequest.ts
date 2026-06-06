import type { ActionRequest, AgentAction } from "./policyTypes";

const ENDPOINT_RE = /^(GET|POST|PUT|PATCH|DELETE|HEAD)\s+(\/\S*)$/i;
const PARAM_RE = /:([A-Za-z_][A-Za-z0-9_]*)/g;

/**
 * Turn a declared AgentAction + call args into a validated, origin-relative
 * request. Pure; throws a clear Error on any invalid input (malformed endpoint,
 * missing required args, unmet path param, unsupported auth).
 */
export function buildActionRequest(action: AgentAction, args: Record<string, unknown>): ActionRequest {
  const m = ENDPOINT_RE.exec(action.endpoint);
  if (!m) throw new Error(`invokeStructuredAction: malformed endpoint "${action.endpoint}"`);
  const method = m[1]!.toUpperCase();
  const rawPath = m[2]!;

  if (action.auth !== undefined && action.auth !== "none" && action.auth !== "cookie") {
    throw new Error(`invokeStructuredAction: auth "${action.auth}" not supported in v1`);
  }

  if (action.args_schema) {
    const missing = Object.keys(action.args_schema).filter((k) => !(k in args));
    if (missing.length > 0) {
      throw new Error(`invokeStructuredAction: missing required args: ${missing.join(", ")}`);
    }
  }

  const pathParams = new Set<string>();
  const path = rawPath.replace(PARAM_RE, (_full, name: string) => {
    if (!(name in args)) throw new Error(`invokeStructuredAction: missing path param "${name}"`);
    pathParams.add(name);
    return encodeURIComponent(String(args[name]));
  });

  if (method === "GET" || method === "HEAD") return { method, path };
  // Path-interpolated args are consumed by the URL — don't duplicate them in the body.
  const body = Object.fromEntries(Object.entries(args).filter(([k]) => !pathParams.has(k)));
  return { method, path, body };
}
