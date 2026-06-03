import type { CdpClient } from "../cdp/cdpClient";
import type { CdpEventBuffer } from "../cdp/eventBuffer";
import { optionalNumber, optionalObject, optionalString, requireString } from "./args";
import { assertHttpUrl } from "./urlPolicy";
import { NO_TAB_BOUND } from "../tabs/agentTabs";

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
  const params = optionalObject(args, "params", {});
  // Raw Page.navigate must honor the same scheme gate as the navigate tool, or
  // it's a file:/data:/javascript: bypass.
  if (method === "Page.navigate" && typeof params.url === "string") assertHttpUrl(params.url);
  return cdp.send(method, params);
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
    // The one failure we can detect reliably is our own "no tab bound" signal —
    // there's no session, so capture truly can't work: roll back and report it.
    // Everything else is either benign (the domain has no `.enable`) or a rare
    // transient; we don't couple to Chrome's version-varying error wording.
    if ((err as Error)?.message?.includes(NO_TAB_BOUND)) {
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
