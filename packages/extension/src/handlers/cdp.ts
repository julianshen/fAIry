import type { CdpClient } from "../cdp/cdpClient";
import type { CdpEventBuffer } from "../cdp/eventBuffer";
import { optionalNumber, optionalObject, optionalString, requireString } from "./args";

// CDP isn't tab-scoped once attached: Target.* (attach to / create other
// targets) and Browser.* (browser-level control) would let raw passthrough
// escape the agent-tab binding and drive the user's other tabs. Refuse them so
// every path — high-level tools and passthrough alike — stays bound to the tab.
const BLOCKED_CDP_PREFIXES = ["Target.", "Browser."];

function assertBoundMethod(method: string): void {
  if (BLOCKED_CDP_PREFIXES.some((p) => method.startsWith(p))) {
    throw new Error(`cdp: ${method} is not allowed (it can escape the agent-tab binding)`);
  }
}

/**
 * Raw CDP passthrough — the power-user escape hatch when the high-level tools
 * don't fit. Forwards `method` + `params` verbatim and returns the response,
 * except target/browser-level methods that would break the tab binding.
 */
export async function cdpPassthrough(cdp: CdpClient, args: Record<string, unknown>): Promise<unknown> {
  const method = requireString(args, "method");
  assertBoundMethod(method);
  return cdp.send(method, optionalObject(args, "params", {}));
}

/**
 * Subscribe to a CDP event method; auto-enable its domain so the agent doesn't
 * have to think about `Network.enable` etc. Events then accumulate (fed in by
 * the debugger glue) until `cdpCollect`.
 */
export async function cdpSubscribe(
  cdp: CdpClient,
  events: CdpEventBuffer,
  args: Record<string, unknown>,
): Promise<{ ok: boolean }> {
  const method = requireString(args, "method");
  assertBoundMethod(method); // no subscribing to Target.*/Browser.* either
  const { ok, domain } = events.subscribe(method);
  if (!ok || !domain) return { ok: false };
  try {
    await cdp.send(`${domain}.enable`, {});
  } catch (err) {
    // A domain with no `.enable` command is benign (events still flow). But a
    // real failure — no tab bound, attach rejected — means nothing will arrive,
    // so don't claim success: roll the subscription back and report it.
    if (!/not found|wasn't found|doesn't exist/i.test((err as Error)?.message ?? "")) {
      events.unsubscribe(method);
      return { ok: false };
    }
  }
  return { ok: true };
}

/** Drain buffered events for a method (or all), up to `max`. */
export function cdpCollect(
  events: CdpEventBuffer,
  args: Record<string, unknown>,
): Promise<unknown> {
  return Promise.resolve(events.collect(optionalString(args, "method"), optionalNumber(args, "max")));
}

/** Stop receiving a specific event method, or all methods if none is given. */
export function cdpUnsubscribe(
  events: CdpEventBuffer,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; cleared: number }> {
  return Promise.resolve(events.unsubscribe(optionalString(args, "method")));
}
