import { HttpServer } from "./httpServer";
import { createPairingStore, type PairingStore } from "./pairing";
import type { SettingsStore } from "./settings";
import type { PiConfig } from "./piConfig";

const TOKEN = "test-token-123";

function fakeStore(initial: PiConfig): SettingsStore & { saved: PiConfig[] } {
  let current = initial;
  const saved: PiConfig[] = [];
  return {
    get: () => current,
    save: (c) => {
      saved.push(c);
      current = c;
    },
    saved,
  };
}

describe("HttpServer", () => {
  let server: HttpServer;
  let store: ReturnType<typeof fakeStore>;
  let base: string;

  async function start(
    opts: { allowedOrigins?: string[]; pairing?: PairingStore; info?: () => unknown } = {},
  ) {
    store = fakeStore({
      providers: [{ id: "anthropic", apiKey: "sk-ant-secret" }],
      defaultModel: "claude-opus-4-8",
    });
    server = new HttpServer({
      token: TOKEN,
      settings: store,
      allowedOrigins: opts.allowedOrigins,
      pairing: opts.pairing,
      info: opts.info,
    });
    const port = await server.listen();
    base = `http://127.0.0.1:${port}`;
  }

  afterEach(async () => {
    await server.close();
  });

  function call(
    method: string,
    path: string,
    opts: { token?: string | null; origin?: string; body?: unknown } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {};
    const token = opts.token === undefined ? TOKEN : opts.token;
    if (token !== null) headers.authorization = `Bearer ${token}`;
    if (opts.origin) headers.origin = opts.origin;
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers["content-type"] = "application/json";
      body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
    }
    return fetch(`${base}${path}`, { method, headers, body });
  }

  it("GET /status returns ok with a valid token", async () => {
    await start();
    const res = await call("GET", "/status");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("GET /settings returns the redacted config, never the api key", async () => {
    await start();
    const res = await call("GET", "/settings");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      providers: [{ id: "anthropic", hasKey: true }],
      defaultModel: "claude-opus-4-8",
    });
    expect(JSON.stringify(body)).not.toContain("sk-ant-secret");
  });

  it("PUT /settings persists the new config and returns its redacted view", async () => {
    await start();
    const next: PiConfig = {
      providers: [{ id: "openai", apiKey: "sk-oai-new" }],
      defaultProvider: "openai",
    };
    const res = await call("PUT", "/settings", { body: next });
    expect(res.status).toBe(200);
    expect(store.saved).toEqual([next]);
    expect(await res.json()).toEqual({
      providers: [{ id: "openai", hasKey: true }],
      defaultProvider: "openai",
    });
  });

  it("PUT /settings rejects a malformed body with 400 and does not save", async () => {
    await start();
    const res = await call("PUT", "/settings", { body: "{not json" });
    expect(res.status).toBe(400);
    expect(store.saved).toEqual([]);
  });

  it("rejects valid JSON that is not a config shape with 400 and does not save", async () => {
    await start();
    const res = await call("PUT", "/settings", { body: "42" });
    expect(res.status).toBe(400);
    expect(store.saved).toEqual([]);
  });

  it("rejects a missing token with 401", async () => {
    await start();
    const res = await call("GET", "/settings", { token: null });
    expect(res.status).toBe(401);
  });

  it("rejects a wrong token with 401", async () => {
    await start();
    const res = await call("GET", "/settings", { token: "nope" });
    expect(res.status).toBe(401);
  });

  it("rejects a disallowed web origin with 403 even with a valid token", async () => {
    await start();
    const res = await call("GET", "/status", { origin: "http://evil.example" });
    expect(res.status).toBe(403);
  });

  it("honors an explicit origin allowlist", async () => {
    await start({ allowedOrigins: ["chrome-extension://real-id"] });
    expect((await call("GET", "/status", { origin: "chrome-extension://real-id" })).status).toBe(200);
    expect((await call("GET", "/status", { origin: "chrome-extension://other" })).status).toBe(403);
  });

  it("returns 404 for an unknown path", async () => {
    await start();
    const res = await call("GET", "/nope");
    expect(res.status).toBe(404);
  });

  it("returns 405 for a known path with the wrong method", async () => {
    await start();
    const res = await call("DELETE", "/settings");
    expect(res.status).toBe(405);
  });

  it("returns 405 for POST /status", async () => {
    await start();
    expect((await call("POST", "/status")).status).toBe(405);
  });

  it("rejects a JSON null body with 400 and does not save", async () => {
    await start();
    const res = await call("PUT", "/settings", { body: "null" });
    expect(res.status).toBe(400);
    expect(store.saved).toEqual([]);
  });

  it("binds an explicitly provided loopback host", async () => {
    store = fakeStore({ providers: [] });
    server = new HttpServer({ token: TOKEN, settings: store, host: "127.0.0.1" });
    const port = await server.listen();
    const res = await fetch(`http://127.0.0.1:${port}/status`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
  });

  it("rejects a JSON object without a providers array with 400", async () => {
    await start();
    const res = await call("PUT", "/settings", { body: { defaultModel: "x" } });
    expect(res.status).toBe(400);
    expect(store.saved).toEqual([]);
  });

  it("rejects a config with a malformed provider with 400 and does not save", async () => {
    await start();
    const res = await call("PUT", "/settings", { body: { providers: [{ id: "x" }] } });
    expect(res.status).toBe(400);
    expect(store.saved).toEqual([]);
  });

  it("rejects a body over the configured size limit with 413 and does not save", async () => {
    store = fakeStore({ providers: [] });
    server = new HttpServer({ token: TOKEN, settings: store, maxBodyBytes: 16 });
    base = `http://127.0.0.1:${await server.listen()}`;
    const res = await call("PUT", "/settings", {
      body: { providers: [{ id: "anthropic", apiKey: "x".repeat(100) }] },
    });
    expect(res.status).toBe(413);
    expect(store.saved).toEqual([]);
  });

  it("close() is a no-op when the server was never started", async () => {
    server = new HttpServer({ token: TOKEN, settings: fakeStore({ providers: [] }) });
    await expect(server.close()).resolves.toBeUndefined();
  });

  it("preserves an existing provider key when the update sends a blank key", async () => {
    await start(); // store seeded with anthropic -> sk-ant-secret
    const res = await call("PUT", "/settings", {
      body: { providers: [{ id: "anthropic", apiKey: "" }], defaultModel: "new-model" },
    });
    expect(res.status).toBe(200);
    expect(store.saved[0]?.providers).toEqual([{ id: "anthropic", apiKey: "sk-ant-secret" }]);
    expect(store.saved[0]?.defaultModel).toBe("new-model");
    expect(await res.json()).toEqual({
      providers: [{ id: "anthropic", hasKey: true }],
      defaultModel: "new-model",
    });
  });

  it("returns 500 (not 400) when the store fails to persist", async () => {
    const throwing: SettingsStore = {
      get: () => ({ providers: [] }),
      save: () => {
        throw new Error("disk full");
      },
    };
    server = new HttpServer({ token: TOKEN, settings: throwing });
    base = `http://127.0.0.1:${await server.listen()}`;
    const res = await call("PUT", "/settings", { body: { providers: [] } });
    expect(res.status).toBe(500);
  });

  it("refuses to bind a non-loopback host", async () => {
    server = new HttpServer({ token: TOKEN, settings: fakeStore({ providers: [] }), host: "0.0.0.0" });
    await expect(server.listen()).rejects.toThrow(/loopback/);
  });

  it("rejects a second listen while already listening", async () => {
    await start();
    await expect(server.listen()).rejects.toThrow(/already listening/);
  });

  it("rejects when the port is already in use", async () => {
    await start();
    const inUse = Number(new URL(base).port);
    const other = new HttpServer({ token: TOKEN, settings: store, port: inUse });
    await expect(other.listen()).rejects.toBeDefined();
  });

  describe("CORS + pairing", () => {
    const EXT = "chrome-extension://abcdefg";

    it("answers an OPTIONS preflight with 204 + CORS headers", async () => {
      await start();
      const res = await call("OPTIONS", "/pair", { token: null, origin: EXT });
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe(EXT);
      expect(res.headers.get("access-control-allow-headers")).toMatch(/authorization/i);
    });

    it("emits CORS headers on a normal response for an allowed browser origin", async () => {
      await start();
      const res = await call("GET", "/status", { origin: EXT });
      expect(res.status).toBe(200);
      expect(res.headers.get("access-control-allow-origin")).toBe(EXT);
    });

    it("does not emit CORS headers when there is no Origin (native shell)", async () => {
      await start();
      const res = await call("GET", "/status");
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    });

    it("POST /pair redeems a valid code for the token — without a bearer token", async () => {
      await start({ pairing: createPairingStore({ token: TOKEN, code: "PAIRCODE" }) });
      const res = await call("POST", "/pair", { token: null, origin: EXT, body: { code: "PAIRCODE" } });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ token: TOKEN });
    });

    it("POST /pair rejects a wrong/expired code with 401", async () => {
      await start({ pairing: createPairingStore({ token: TOKEN, code: "PAIRCODE" }) });
      const res = await call("POST", "/pair", { token: null, body: { code: "wrong" } });
      expect(res.status).toBe(401);
    });

    it("POST /pair rejects a malformed body with 400", async () => {
      await start({ pairing: createPairingStore({ token: TOKEN, code: "PAIRCODE" }) });
      expect((await call("POST", "/pair", { token: null, body: { code: 42 } })).status).toBe(400);
      expect((await call("POST", "/pair", { token: null, body: "{not json" })).status).toBe(400);
      expect((await call("POST", "/pair", { token: null, body: "42" })).status).toBe(400); // non-object JSON
      expect((await call("POST", "/pair", { token: null, body: "[1,2]" })).status).toBe(400); // array, not an object
    });

    it("POST /pair over the body size limit is 413", async () => {
      store = fakeStore({ providers: [] });
      server = new HttpServer({
        token: TOKEN,
        settings: store,
        maxBodyBytes: 8,
        pairing: createPairingStore({ token: TOKEN, code: "PAIRCODE" }),
      });
      base = `http://127.0.0.1:${await server.listen()}`;
      const res = await call("POST", "/pair", { token: null, body: { code: "x".repeat(50) } });
      expect(res.status).toBe(413);
    });

    it("POST /pair is 404 when pairing is not enabled", async () => {
      await start(); // no pairing store
      const res = await call("POST", "/pair", { token: null, body: { code: "x" } });
      expect(res.status).toBe(404);
    });

    it("returns 405 for GET /pair", async () => {
      await start({ pairing: createPairingStore({ token: TOKEN, code: "PAIRCODE" }) });
      expect((await call("GET", "/pair", { token: null })).status).toBe(405);
    });
  });

  describe("GET /info", () => {
    const INFO = { bridgePort: 111, conversationPort: 222 };

    it("returns the injected info to an authenticated client", async () => {
      await start({ info: () => INFO });
      const res = await call("GET", "/info");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(INFO);
    });

    it("requires the bearer token", async () => {
      await start({ info: () => INFO });
      expect((await call("GET", "/info", { token: null })).status).toBe(401);
    });

    it("is 404 when no info provider is configured", async () => {
      await start();
      expect((await call("GET", "/info")).status).toBe(404);
    });

    it("returns 405 for a non-GET method", async () => {
      await start({ info: () => INFO });
      expect((await call("POST", "/info")).status).toBe(405);
    });
  });
});
