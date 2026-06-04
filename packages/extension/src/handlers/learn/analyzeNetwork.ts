import type { BufferedEvent } from "../../cdp/eventBuffer";
import type { NetworkEndpoint } from "./types";

const AUTH_RE = /\/(auth|login|logout|oauth|signin|signup|token)\b/i;

interface RequestParams {
  request?: { url?: string; method?: string; postData?: string };
}

function isGraphql(path: string, postData?: string): boolean {
  if (/graphql/i.test(path)) return true;
  return typeof postData === "string" && /\b(query|mutation)\b/.test(postData);
}

function safeUrl(href: string): URL | undefined {
  try {
    return new URL(href);
  } catch {
    return undefined;
  }
}

/**
 * Reduce a buffered CDP event stream to the distinct API endpoints the page hit.
 * Keys off `Network.requestWillBeSent` (method + path), dedups by `method path`,
 * and flags GraphQL / auth endpoints. Pure.
 */
export function analyzeNetwork(events: BufferedEvent[]): { endpoints: NetworkEndpoint[] } {
  const seen = new Set<string>();
  const endpoints: NetworkEndpoint[] = [];
  for (const ev of events) {
    if (ev.method !== "Network.requestWillBeSent") continue;
    const req = (ev.params as RequestParams | null)?.request;
    if (!req || typeof req.url !== "string" || typeof req.method !== "string") continue;
    const u = safeUrl(req.url);
    if (!u || (u.protocol !== "http:" && u.protocol !== "https:")) continue;
    const key = `${req.method} ${u.pathname}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const endpoint: NetworkEndpoint = { method: req.method, path: u.pathname };
    if (isGraphql(u.pathname, req.postData)) endpoint.graphql = true;
    if (AUTH_RE.test(u.pathname)) endpoint.auth = true;
    endpoints.push(endpoint);
  }
  return { endpoints };
}
