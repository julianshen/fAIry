import type { CdpClient } from "../../cdp/cdpClient";
import { optionalObject, requireString } from "../args";
import { evaluateExpression } from "../evaluate";
import { buildActionRequest } from "./buildActionRequest";
import type { ActionRequest, AgentPolicyResult, InvokeResult } from "./policyTypes";

/** The page-policy resolver, injected so the orchestrator's two evaluates stay testable. */
export type ResolvePolicy = (cdp: CdpClient) => Promise<AgentPolicyResult>;

/** Build the page-side fetch IIFE for a request (values injected JSON-safe; same-origin + cookies). */
export function buildFetchExpression(req: ActionRequest): string {
  const init: string[] = [`method: ${JSON.stringify(req.method)}`, `credentials: 'include'`];
  if (req.body !== undefined) {
    init.push(`headers: { 'Content-Type': 'application/json' }`);
    init.push(`body: ${JSON.stringify(JSON.stringify(req.body))}`);
  }
  return `(async () => {
  try {
    const r = await fetch(location.origin + ${JSON.stringify(req.path)}, { ${init.join(", ")} });
    const text = await r.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    return { status: r.status, ok: r.ok, body };
  } catch (e) {
    const body = String(e);
    return { status: 0, ok: false, body };
  }
})()`;
}

/** Normalize the (page-supplied) evaluate result into an InvokeResult. */
function coerceInvokeResult(v: unknown): InvokeResult {
  if (typeof v === "object" && v !== null) {
    const o = v as Record<string, unknown>;
    return {
      status: typeof o.status === "number" ? o.status : 0,
      ok: o.ok === true,
      body: "body" in o ? o.body : null,
    };
  }
  return { status: 0, ok: false, body: null };
}

/**
 * Invoke a site-declared structured action by name via the page session. Resolves
 * the page policy, finds the action, builds + validates the request, and evaluates
 * a same-origin fetch (credentials included). The HTTP outcome (incl. 4xx/5xx) is
 * returned; only "can't invoke" conditions (no actions / unknown name / bad args)
 * throw.
 */
export async function invokeStructuredAction(
  cdp: CdpClient,
  resolve: ResolvePolicy,
  args: Record<string, unknown>,
): Promise<InvokeResult> {
  const actionName = requireString(args, "actionName");
  const callArgs = optionalObject(args, "args", {});

  const result = await resolve(cdp);
  const actions = result.policy?.actions;
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new Error("invokeStructuredAction: this page has no declared agent actions");
  }
  const action = actions.find((a) => a.name === actionName);
  if (!action) {
    throw new Error(`invokeStructuredAction: action "${actionName}" is not declared in this page's policy`);
  }

  const req = buildActionRequest(action, callArgs);
  const raw = await evaluateExpression(cdp, buildFetchExpression(req));
  return coerceInvokeResult(raw);
}
