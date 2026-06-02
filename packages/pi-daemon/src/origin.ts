/**
 * Decide whether a connection's `Origin` is allowed. Shared by the WS and HTTP
 * servers, which face the same threat: neither is protected by CORS, so a web
 * page could otherwise reach the loopback daemon (a DNS-rebinding vector).
 *
 * With an explicit `allowed` list (e.g. `chrome-extension://<id>`), only those
 * exact origins connect. Without one, any non-web origin is allowed — including
 * a missing Origin (native/extension clients send none) — while `http(s)://`
 * origins (i.e. browser pages) are rejected.
 */
export function isAllowedOrigin(origin: string | undefined, allowed?: string[]): boolean {
  if (allowed) return origin !== undefined && allowed.includes(origin);
  return !(origin && /^https?:\/\//i.test(origin));
}
