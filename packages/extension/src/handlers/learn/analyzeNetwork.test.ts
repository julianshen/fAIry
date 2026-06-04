import { describe, expect, it } from "vitest";
import type { BufferedEvent } from "../../cdp/eventBuffer";
import { analyzeNetwork } from "./analyzeNetwork";

function req(url: string, method: string, postData?: string): BufferedEvent {
  return { at: 1, method: "Network.requestWillBeSent", params: { request: { url, method, postData } } };
}

describe("analyzeNetwork", () => {
  it("extracts method+path from requestWillBeSent and dedups", () => {
    const r = analyzeNetwork([req("https://x.com/api/users?p=1", "GET"), req("https://x.com/api/users?p=2", "GET")]);
    expect(r.endpoints).toEqual([{ method: "GET", path: "/api/users" }]);
  });

  it("ignores responseReceived and non-http requests", () => {
    const r = analyzeNetwork([
      { at: 1, method: "Network.responseReceived", params: { response: { url: "https://x.com/a" } } },
      req("data:text/html,hi", "GET"),
    ]);
    expect(r.endpoints).toEqual([]);
  });

  it("flags graphql (by path or body) and auth endpoints", () => {
    const r = analyzeNetwork([
      req("https://x.com/graphql", "POST"),
      req("https://x.com/q", "POST", '{"query":"{ me }"}'),
      req("https://x.com/auth/login", "POST"),
    ]);
    expect(r.endpoints).toContainEqual({ method: "POST", path: "/graphql", graphql: true });
    expect(r.endpoints).toContainEqual({ method: "POST", path: "/q", graphql: true });
    expect(r.endpoints).toContainEqual({ method: "POST", path: "/auth/login", auth: true });
  });

  it("returns no endpoints for an empty stream", () => {
    expect(analyzeNetwork([]).endpoints).toEqual([]);
  });
});
