import type { CdpClient } from "../../cdp/cdpClient";
import type { BufferedEvent, CdpEventBuffer } from "../../cdp/eventBuffer";
import { optionalNumber, optionalString } from "../args";
import { cdpCollect, cdpSubscribe, cdpUnsubscribe } from "../cdp";
import { evaluateExpression } from "../evaluate";
import { analyzeNetwork } from "./analyzeNetwork";
import { analyzeUrls } from "./analyzeUrls";
import { classify } from "./classify";
import { COLLECTOR_JS } from "./collectorScript";
import type { Collected, LearnResult, NetworkEndpoint } from "./types";

/** Injected so tests don't wait on the real clock. */
export type Sleep = (ms: number) => Promise<void>;

const DEFAULT_OBSERVE_MS = 2000;
const MAX_OBSERVE_MS = 10000;

function isCollected(v: unknown): v is Collected {
  return typeof v === "object" && v !== null && Array.isArray((v as Collected).interactive);
}

/** Observe network for `observeMs`; returns endpoints, or undefined if it can't subscribe. */
/** The one CDP event analyzeNetwork reads; scoping to it keeps a scan from
 *  disturbing other subscriptions in the worker-wide event buffer. */
const NETWORK_METHOD = "Network.requestWillBeSent";

async function observeNetwork(
  cdp: CdpClient,
  events: CdpEventBuffer,
  sleep: Sleep,
  observeMs: number,
): Promise<{ endpoints: NetworkEndpoint[] } | undefined> {
  // If the agent is already capturing this method, a scan must not drain its
  // buffer — collecting would consume requests the caller plans to read later.
  // Skip observation in that case rather than steal the events.
  if (events.isSubscribed(NETWORK_METHOD)) return undefined;
  try {
    const sub = await cdpSubscribe(cdp, events, { method: NETWORK_METHOD });
    if (!sub.ok) return undefined;
    await sleep(observeMs);
    const evts = (await cdpCollect(events, { method: NETWORK_METHOD })) as BufferedEvent[];
    return analyzeNetwork(evts);
  } finally {
    // We created this subscription (it didn't pre-exist), so release only it.
    await cdpUnsubscribe(events, { method: NETWORK_METHOD });
  }
}

/**
 * Scan the current page: run the page-side collector, optionally observe network
 * (active mode), and synthesize a LearnResult via the pure analyzers/classifier.
 */
export async function learnPageActions(
  cdp: CdpClient,
  events: CdpEventBuffer,
  sleep: Sleep,
  args: Record<string, unknown>,
): Promise<LearnResult> {
  const mode = optionalString(args, "mode", "passive");
  const observeMs = Math.min(optionalNumber(args, "observeMs", DEFAULT_OBSERVE_MS), MAX_OBSERVE_MS);

  const collected = await evaluateExpression(cdp, COLLECTOR_JS);
  if (!isCollected(collected)) throw new Error("learnPageActions: page collection failed");

  const network = mode === "active" ? await observeNetwork(cdp, events, sleep, observeMs) : undefined;
  const urlAnalysis = analyzeUrls(collected.hrefs, collected.url);
  const classification = classify(collected, urlAnalysis, network);

  return {
    origin: collected.origin,
    url: collected.url,
    perception: {
      elementsByRole: collected.elementsByRole,
      interactive: collected.interactive,
      searchInputs: collected.searchInputs,
      forms: collected.forms,
      nav: collected.nav,
    },
    urlAnalysis,
    declaredActions: collected.declaredActions,
    ...(network ? { network } : {}),
    classification,
  };
}
