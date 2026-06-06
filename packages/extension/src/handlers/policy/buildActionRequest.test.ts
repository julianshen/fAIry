import { describe, expect, it } from "vitest";
import { buildActionRequest } from "./buildActionRequest";
import type { AgentAction } from "./policyTypes";

const action = (over: Partial<AgentAction>): AgentAction => ({ name: "a", endpoint: "GET /x", ...over });

describe("buildActionRequest", () => {
  it("builds a GET with no body", () => {
    expect(buildActionRequest(action({ endpoint: "GET /api/items" }), {})).toEqual({
      method: "GET",
      path: "/api/items",
    });
  });

  it("builds a write method with the args as the JSON body", () => {
    expect(buildActionRequest(action({ endpoint: "POST /api/orders" }), { qty: 2 })).toEqual({
      method: "POST",
      path: "/api/orders",
      body: { qty: 2 },
    });
  });

  it("excludes path-param keys from the write body (consumed by the path)", () => {
    expect(buildActionRequest(action({ endpoint: "POST /api/orders/:id" }), { id: "42", qty: 2 })).toEqual({
      method: "POST",
      path: "/api/orders/42",
      body: { qty: 2 },
    });
  });

  it("substitutes and URL-encodes path params from args", () => {
    expect(buildActionRequest(action({ endpoint: "GET /api/o/:id" }), { id: "a b" }).path).toBe("/api/o/a%20b");
  });

  it("upper-cases the method", () => {
    expect(buildActionRequest(action({ endpoint: "post /x" }), {}).method).toBe("POST");
  });

  it("throws on a malformed endpoint", () => {
    expect(() => buildActionRequest(action({ endpoint: "nonsense" }), {})).toThrow(/malformed endpoint/);
  });

  it("throws listing missing required args from args_schema", () => {
    expect(() =>
      buildActionRequest(action({ endpoint: "POST /x", args_schema: { email: "string", name: "string" } }), { email: "a@b" }),
    ).toThrow(/missing required args: name/);
  });

  it("throws on a missing path param", () => {
    expect(() => buildActionRequest(action({ endpoint: "GET /o/:id" }), {})).toThrow(/missing path param "id"/);
  });

  it("throws on unsupported auth", () => {
    expect(() => buildActionRequest(action({ endpoint: "GET /x", auth: "bearer" }), {})).toThrow(/not supported in v1/);
  });

  it("allows none/cookie/undefined auth", () => {
    expect(buildActionRequest(action({ endpoint: "GET /x", auth: "cookie" }), {}).method).toBe("GET");
    expect(buildActionRequest(action({ endpoint: "GET /x", auth: "none" }), {}).method).toBe("GET");
  });

  // Untrusted /agent.json hardening: a malformed action mustn't crash or misbehave.
  it("rejects a non-string endpoint", () => {
    expect(() => buildActionRequest(action({ endpoint: 123 as unknown as string }), {})).toThrow(/malformed endpoint/);
  });

  it("treats auth:null like absent (allowed)", () => {
    expect(buildActionRequest(action({ endpoint: "GET /x", auth: null as unknown as string }), {}).method).toBe("GET");
  });

  it("ignores a non-object args_schema instead of erroring", () => {
    expect(
      buildActionRequest(action({ endpoint: "GET /x", args_schema: ["foo"] as unknown as Record<string, unknown> }), {})
        .method,
    ).toBe("GET");
  });

  it("treats a null path-param value as missing", () => {
    expect(() => buildActionRequest(action({ endpoint: "GET /o/:id" }), { id: null })).toThrow(
      /missing path param "id"/,
    );
  });
});
