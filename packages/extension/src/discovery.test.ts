import { discover } from "./discovery";

const HTTP = "http://127.0.0.1:51789";

/** A fetch stub that maps "METHOD path" → a Response (or throws if unmapped). */
function fakeFetch(routes: Record<string, () => Response>): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const key = `${init?.method ?? "GET"} ${new URL(url).pathname}`;
    const route = routes[key];
    if (!route) throw new Error(`unexpected request: ${key}`);
    return Promise.resolve(route());
  }) as typeof fetch;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("discover", () => {
  it("redeems the code for a token, then fetches the WS ports", async () => {
    const conn = await discover({
      httpBase: HTTP,
      code: "PAIR-CODE",
      fetch: fakeFetch({
        "POST /pair": () => json({ token: "tok-123" }),
        "GET /info": () => json({ bridgePort: 6001, conversationPort: 6002 }),
      }),
    });
    expect(conn).toEqual({ token: "tok-123", bridgePort: 6001, conversationPort: 6002 });
  });

  it("sends the code in the /pair body and the token as a bearer to /info", async () => {
    const calls: Array<{ key: string; init?: RequestInit }> = [];
    const recording: typeof fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const key = `${init?.method ?? "GET"} ${url.pathname}`;
      calls.push({ key, init });
      return Promise.resolve(
        key === "POST /pair" ? json({ token: "T" }) : json({ bridgePort: 1, conversationPort: 2 }),
      );
    }) as typeof fetch;

    await discover({ httpBase: HTTP, code: "CODE", fetch: recording });

    const pair = calls.find((c) => c.key === "POST /pair");
    expect(JSON.parse(pair?.init?.body as string)).toEqual({ code: "CODE" });
    const info = calls.find((c) => c.key === "GET /info");
    expect((info?.init?.headers as Record<string, string>).authorization).toBe("Bearer T");
  });

  it("throws when the pairing code is rejected", async () => {
    await expect(
      discover({
        httpBase: HTTP,
        code: "bad",
        fetch: fakeFetch({ "POST /pair": () => json({ error: "invalid_or_expired_code" }, 401) }),
      }),
    ).rejects.toThrow(/pair/i);
  });

  it("defaults to the global fetch when none is injected", async () => {
    const stub = fakeFetch({
      "POST /pair": () => json({ token: "T" }),
      "GET /info": () => json({ bridgePort: 9, conversationPort: 10 }),
    });
    vi.stubGlobal("fetch", stub);
    try {
      const conn = await discover({ httpBase: HTTP, code: "CODE" });
      expect(conn).toEqual({ token: "T", bridgePort: 9, conversationPort: 10 });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("throws when /info fails", async () => {
    await expect(
      discover({
        httpBase: HTTP,
        code: "CODE",
        fetch: fakeFetch({
          "POST /pair": () => json({ token: "T" }),
          "GET /info": () => json({ error: "nope" }, 500),
        }),
      }),
    ).rejects.toThrow(/info/i);
  });
});
