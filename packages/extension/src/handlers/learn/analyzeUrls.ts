import type { UrlAnalysis } from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function segPattern(seg: string): string {
  if (/^\d+$/.test(seg)) return ":id";
  if (UUID_RE.test(seg)) return ":uuid";
  return seg;
}

function safeUrl(href: string, base?: URL): URL | undefined {
  try {
    // Accept absolute URLs unconditionally; for relative hrefs accept path-like
    // values (/about, users/9, ../x) but reject obvious non-URLs — a bare phrase
    // like "not a url" would otherwise be "resolved" into an escaped path.
    if (base && !href.includes("://")) {
      if (href.trim() === "" || /\s/.test(href)) return undefined;
    }
    return base ? new URL(href, base) : new URL(href);
  } catch {
    return undefined;
  }
}

/**
 * Group the page's links by path pattern (numeric → `:id`, uuid → `:uuid`),
 * counted and sorted desc, plus the current URL's query-param names. Pure.
 */
export function analyzeUrls(hrefs: string[], currentUrl: string): UrlAnalysis {
  const base = safeUrl(currentUrl);
  const counts = new Map<string, number>();
  for (const href of hrefs) {
    const u = safeUrl(href, base);
    // Only same-origin links count as this site's navigation — otherwise an
    // external link sharing a path (e.g. other.com/about) pollutes the patterns.
    if (!u || (base && u.origin !== base.origin)) continue;
    const pattern = u.pathname.split("/").map(segPattern).join("/");
    counts.set(pattern, (counts.get(pattern) ?? 0) + 1);
  }
  const patterns = [...counts.entries()]
    .map(([pattern, count]) => ({ pattern, count }))
    .sort((a, b) => b.count - a.count);
  const queryParams = base ? [...new Set(base.searchParams.keys())] : [];
  return { patterns, queryParams };
}
