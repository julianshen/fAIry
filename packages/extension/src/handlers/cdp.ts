import type { CdpClient } from "../cdp/cdpClient";
import type { CdpEventBuffer } from "../cdp/eventBuffer";
import { optionalNumber, optionalString, requireString } from "./args";

/**
 * Raw CDP passthrough — the power-user escape hatch when the high-level tools
 * don't fit. Forwards `method` + `params` verbatim and returns the response.
 */
export async function cdpPassthrough(cdp: CdpClient, args: Record<string, unknown>): Promise<unknown> {
  const method = requireString(args, "method");
  const params =
    typeof args.params === "object" && args.params !== null && !Array.isArray(args.params)
      ? (args.params as Record<string, unknown>)
      : {};
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
  const { ok, domain } = events.subscribe(method);
  if (!ok || !domain) return { ok: false };
  // Not every domain has `.enable`; a failure there shouldn't undo the subscribe.
  await cdp.send(`${domain}.enable`, {}).catch(() => {});
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
