/**
 * The navigation scheme allowlist — one place, enforced on every path that can
 * point a tab at a URL (`navigate`, `tabOpen`, raw `cdp` `Page.navigate`). Only
 * `http(s)` is permitted: a tool-supplied `javascript:`/`data:`/`file:`/
 * `chrome:` URL could run script, read local files, or reach privileged pages.
 */
export function assertHttpUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`only http(s) URLs are allowed (could not parse: ${url})`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`only http(s) URLs are allowed, refused ${parsed.protocol}`);
  }
}
