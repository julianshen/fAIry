import type { CdpClient } from "../cdp/cdpClient";
import type { CdpEventBuffer } from "../cdp/eventBuffer";
import type { AgentTabs } from "../tabs/agentTabs";
import type { TabsApi } from "../tabs/tabsApi";
import type { ToolHandler } from "../toolExecutor";
import { getTitle, getUrl, navigate } from "./navigation";
import { click, scroll, type } from "./input";
import { evaluate } from "./evaluate";
import { screenshot, screenshotMarked } from "./capture";
import { axtree, describeAt, getDom } from "./inspect";
import { dismissOverlays, waitFor } from "./page";
import { tabClose, tabList, tabOpen, tabSwitch } from "./tabs";
import { cdpCollect, cdpPassthrough, cdpSubscribe, cdpUnsubscribe } from "./cdp";

/** Everything the browser handlers need: the CDP seam, the chrome.tabs seam, the
 *  agent-tab binding, and the CDP event buffer. */
export interface BrowserDeps {
  cdp: CdpClient;
  tabs: TabsApi;
  agentTabs: AgentTabs;
  events: CdpEventBuffer;
}

/**
 * Build the browser-tool dispatch table: each entry's key is the wire tool name
 * the daemon relays (the `bridge("...")` argument in the Pi `-e` script), bound
 * to a handler that runs against `deps`. Pass the result to
 * {@link import("../toolExecutor").createToolExecutor}.
 *
 * This is the single place the extension's wire names live; `registry.test.ts`
 * pins the set so a typo is a failing test, not a silent runtime no-op. The
 * names are produced on the daemon side by the Pi `-e` script's `bridge("...")`
 * calls — deduping the two across the process boundary awaits a shared protocol
 * module (the `-e` script can't import daemon/extension code, so it's deferred).
 */
export function createBrowserHandlers(deps: BrowserDeps): Record<string, ToolHandler> {
  const { cdp, tabs, agentTabs, events } = deps;
  const onCdp =
    (fn: (cdp: CdpClient, args: Record<string, unknown>) => Promise<unknown>): ToolHandler =>
    (args) =>
      fn(cdp, args);
  return {
    // Groups 1-2 — CDP nav/interaction + observation.
    navigate: onCdp(navigate),
    getUrl: onCdp(getUrl),
    getTitle: onCdp(getTitle),
    click: onCdp(click),
    type: onCdp(type),
    scroll: onCdp(scroll),
    evaluate: onCdp(evaluate),
    screenshot: onCdp(screenshot),
    screenshotMarked: onCdp(screenshotMarked),
    getDom: onCdp(getDom),
    axtree: onCdp(axtree),
    describeAt: onCdp(describeAt),
    dismissOverlays: onCdp(dismissOverlays),
    waitFor: onCdp(waitFor),
    // Group 3 — tabs (ownership-gated via agentTabs).
    tabOpen: (args) => tabOpen(tabs, agentTabs, args),
    tabSwitch: (args) => tabSwitch(tabs, agentTabs, args),
    tabClose: (args) => tabClose(tabs, agentTabs, args),
    tabList: (args) => tabList(tabs, agentTabs, args),
    // Group 4 — raw CDP passthrough + event buffer.
    cdp: (args) => cdpPassthrough(cdp, args),
    cdpSubscribe: (args) => cdpSubscribe(cdp, events, args),
    cdpCollect: (args) => cdpCollect(events, args),
    cdpUnsubscribe: (args) => cdpUnsubscribe(events, args),
  };
}
