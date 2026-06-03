import type { CdpClient } from "../cdp/cdpClient";
import { requireString } from "./args";

interface RuntimeEvaluateResult {
  exceptionDetails?: { text: string; exception?: { description?: string } };
  result?: { value?: unknown; unserializableValue?: string };
}

/**
 * With `returnByValue`, CDP can't JSON-encode some primitives (`NaN`,
 * `Infinity`, `-0`, bigint), so it sends them as a string in
 * `unserializableValue` with `value` absent. Surface that string verbatim: the
 * tool reply is itself JSON-encoded over the bridge, where reconstructed raw
 * primitives would be lost (`NaN`→`null`, `-0`→`0`) or throw (bigint). The
 * string is the only representation that reaches Pi intact.
 */
function decodeRemote(result: { value?: unknown; unserializableValue?: string }): unknown {
  return result.value !== undefined ? result.value : result.unserializableValue;
}

/**
 * Run `expression` in the page's main world and return its value. Shared
 * low-level primitive: `getUrl`, `waitFor`, `dismissOverlays`, etc. all build
 * on it. `returnByValue` brings complex results back as JSON; `awaitPromise`
 * resolves a returned promise first. Throws on a page-side exception.
 */
export async function evaluateExpression(cdp: CdpClient, expression: string): Promise<unknown> {
  const res = (await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })) as RuntimeEvaluateResult;
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text);
  }
  return res.result ? decodeRemote(res.result) : undefined;
}

/**
 * The `evaluate` tool: like {@link evaluateExpression} but reports a page
 * exception as `{ok:false, error}` rather than rejecting, so the agent can
 * decide whether to retry or surface it (mirrors the POC's contract).
 */
export async function evaluate(
  cdp: CdpClient,
  args: Record<string, unknown>,
): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  const expression = requireString(args, "expression");
  try {
    return { ok: true, value: await evaluateExpression(cdp, expression) };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
