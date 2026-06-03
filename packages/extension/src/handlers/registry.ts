import type { CdpClient } from "../cdp/cdpClient";
import type { ToolHandler } from "../toolExecutor";
import { getTitle, getUrl, navigate } from "./navigation";
import { click, scroll, type } from "./input";
import { evaluate } from "./evaluate";
import { screenshot, screenshotMarked } from "./capture";
import { axtree, describeAt, getDom } from "./inspect";
import { dismissOverlays, waitFor } from "./page";

/**
 * Build the browser-tool dispatch table: each entry's key is the wire tool name
 * the daemon relays (the `bridge("...")` argument in the Pi `-e` script), bound
 * to a handler that runs CDP commands through `cdp`. Pass the result to
 * {@link import("../toolExecutor").createToolExecutor}.
 *
 * This is the single place the extension's wire names live; `registry.test.ts`
 * pins the set so a typo is a failing test, not a silent runtime no-op. The
 * names are produced on the daemon side by the Pi `-e` script's `bridge("...")`
 * calls — deduping the two across the process boundary awaits a shared protocol
 * module (the `-e` script can't import daemon/extension code, so it's deferred).
 */
export function createBrowserHandlers(cdp: CdpClient): Record<string, ToolHandler> {
  const bind =
    (fn: (cdp: CdpClient, args: Record<string, unknown>) => Promise<unknown>): ToolHandler =>
    (args) =>
      fn(cdp, args);
  return {
    navigate: bind(navigate),
    getUrl: bind(getUrl),
    getTitle: bind(getTitle),
    click: bind(click),
    type: bind(type),
    scroll: bind(scroll),
    evaluate: bind(evaluate),
    screenshot: bind(screenshot),
    screenshotMarked: bind(screenshotMarked),
    getDom: bind(getDom),
    axtree: bind(axtree),
    describeAt: bind(describeAt),
    dismissOverlays: bind(dismissOverlays),
    waitFor: bind(waitFor),
  };
}
