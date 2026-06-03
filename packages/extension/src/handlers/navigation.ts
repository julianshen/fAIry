import type { CdpClient } from "../cdp/cdpClient";
import { evaluateExpression } from "./evaluate";
import { requireString } from "./args";

/**
 * Navigate the active tab to a URL. Only `http(s)` is allowed: a tool-supplied
 * `javascript:` / `data:` / `file:` / `chrome:` URL could run script, read local
 * files, or reach privileged pages, so anything else (or an unparseable URL) is
 * refused before it reaches `Page.navigate`.
 */
export async function navigate(
  cdp: CdpClient,
  args: Record<string, unknown>,
): Promise<{ ok: true }> {
  const url = requireString(args, "url");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`navigate: only http(s) URLs are allowed (could not parse: ${url})`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`navigate: only http(s) URLs are allowed, refused ${parsed.protocol}`);
  }
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
