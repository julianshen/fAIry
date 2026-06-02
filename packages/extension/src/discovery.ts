/** What the extension needs to talk to the daemon, obtained by pairing. */
export interface DaemonConnection {
  /** Per-session token for the WS handshakes + HTTP bearer auth. */
  token: string;
  /** Loopback port of the browser-bridge WS (the tool executor side). */
  bridgePort: number;
  /** Loopback port of the conversation WS (the panel feed). */
  conversationPort: number;
}

export interface DiscoverOptions {
  /** The daemon's fixed HTTP base, e.g. `http://127.0.0.1:51789`. */
  httpBase: string;
  /** The pairing code the user copied from the shell. */
  code: string;
  /** Injected for tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

/**
 * Bootstrap a {@link DaemonConnection}: redeem the pairing code at `POST /pair`
 * for the session token, then read the (ephemeral) WS ports from the
 * authenticated `GET /info`. The HTTP base is the daemon's one fixed anchor; the
 * WS ports are discovered because they're ephemeral.
 */
export async function discover(opts: DiscoverOptions): Promise<DaemonConnection> {
  const doFetch = opts.fetch ?? fetch;

  const pairRes = await doFetch(`${opts.httpBase}/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: opts.code }),
  });
  if (!pairRes.ok) {
    throw new Error(`pairing failed (${pairRes.status}) — the code may be wrong or expired`);
  }
  const { token } = (await pairRes.json()) as { token: string };

  const infoRes = await doFetch(`${opts.httpBase}/info`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!infoRes.ok) {
    throw new Error(`info request failed (${infoRes.status})`);
  }
  const { bridgePort, conversationPort } = (await infoRes.json()) as {
    bridgePort: number;
    conversationPort: number;
  };

  return { token, bridgePort, conversationPort };
}
