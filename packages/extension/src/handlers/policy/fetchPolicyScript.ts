/**
 * Page-side fetch of the origin's /agent.json, run via Runtime.evaluate
 * (returnByValue + awaitPromise). Same-origin, so no extra host permission; uses
 * the page session (harmless for a public policy file, and the mechanism
 * invokeStructuredAction will reuse with cookies). Returns a PolicyFetch shape;
 * a network/throw error becomes { status: 0, body: null }.
 */
export const FETCH_POLICY_JS = `(async () => {
  try {
    const r = await fetch('/agent.json', { headers: { Accept: 'application/agent-policy+json, application/json' } });
    return { origin: location.origin, status: r.status, body: r.ok ? await r.text() : null };
  } catch {
    return { origin: location.origin, status: 0, body: null };
  }
})()`;
