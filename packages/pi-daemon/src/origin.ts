/**
 * Decide whether a connection's `Origin` is allowed. Shared by the WS and HTTP
 * servers, which face the same threat: neither is protected by CORS, so a web
 * page could otherwise reach the loopback daemon (a DNS-rebinding vector).
 *
 * With an explicit `allowed` list (e.g. `chrome-extension://<id>`), only those
 * exact origins connect. Without one, a missing Origin is allowed (native/
 * extension clients send none), while browser origins are rejected: both
 * `http(s)://` pages and the opaque `"null"` origin (file:/sandboxed documents).
 */
export function isAllowedOrigin(origin: string | undefined, allowed?: string[]): boolean {
  if (allowed) return origin !== undefined && allowed.includes(origin);
  if (origin === undefined) return true;
  if (origin === "null") return false;
  return !/^https?:\/\//i.test(origin);
}
