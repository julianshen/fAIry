import type { CdpClient } from "../cdp/cdpClient";
import { evaluateExpression } from "./evaluate";
import { requireString } from "./args";
import { assertHttpUrl } from "./urlPolicy";

/** Navigate the active tab to an http(s) URL (the scheme gate is shared via urlPolicy). */
export async function navigate(
  cdp: CdpClient,
  args: Record<string, unknown>,
): Promise<{ ok: true }> {
  const url = requireString(args, "url");
  assertHttpUrl(url);
  await cdp.send("Page.navigate", { url });
  return { ok: true };
}

/** The active tab's current URL (read from the page, via the CDP seam). */
export async function getUrl(cdp: CdpClient, _args: Record<string, unknown>): Promise<string> {
  return String(await evaluateExpression(cdp, "location.href"));
}

/** The active tab's document title. */
export async function getTitle(cdp: CdpClient, _args: Record<string, unknown>): Promise<string> {
  return String(await evaluateExpression(cdp, "document.title"));
}
