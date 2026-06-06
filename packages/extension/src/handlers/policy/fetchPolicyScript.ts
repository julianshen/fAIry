/**
 * Page-side fetch of the origin's /agent.json, run via Runtime.evaluate
 * (returnByValue + awaitPromise). Same-origin, so no extra host permission; uses
 * the page session (harmless for a public policy file, and the mechanism
 * invokeStructuredAction will reuse with cookies). Returns a PolicyFetch shape;
 * a network/throw error becomes { status: 0, body: null }.
 *
 * - Builds the URL from `location.origin` (NOT a bare `/agent.json`) so a page's
 *   cross-origin `<base href>` can't redirect the fetch to another origin's policy.
 * - Rejects a cross-origin *redirect* too: if the final response URL (`r.url`) left
 *   the page origin, drop it (we'd otherwise read another site's policy and still
 *   report `location.origin`).
 * - Bails to `body: null` when Content-Length exceeds the cap, so a misconfigured
 *   huge response isn't read into the page + shipped over the CDP bridge (the
 *   parser's MAX_BODY_BYTES is the backstop for chunked/absent Content-Length).
 */
export const FETCH_POLICY_JS = `(async () => {
  try {
    const r = await fetch(location.origin + '/agent.json', { headers: { Accept: 'application/agent-policy+json, application/json' } });
    if (!r.ok) return { origin: location.origin, status: r.status, body: null };
    if (new URL(r.url).origin !== location.origin) return { origin: location.origin, status: r.status, body: null };
    if (Number(r.headers.get('content-length') || 0) > 1000000) return { origin: location.origin, status: r.status, body: null };
    return { origin: location.origin, status: r.status, body: await r.text() };
  } catch {
    return { origin: location.origin, status: 0, body: null };
  }
})()`;
