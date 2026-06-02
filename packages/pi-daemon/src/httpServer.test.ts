import { HttpServer } from "./httpServer";
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

  async function start(opts: { allowedOrigins?: string[] } = {}) {
    store = fakeStore({
      providers: [{ id: "anthropic", apiKey: "sk-ant-secret" }],
      defaultModel: "claude-opus-4-8",
    });
    server = new HttpServer({ token: TOKEN, settings: store, allowedOrigins: opts.allowedOrigins });
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

  it("close() is a no-op when the server was never started", async () => {
    server = new HttpServer({ token: TOKEN, settings: fakeStore({ providers: [] }) });
    await expect(server.close()).resolves.toBeUndefined();
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
});
