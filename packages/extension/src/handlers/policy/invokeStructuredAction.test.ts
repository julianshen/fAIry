import { describe, expect, it } from "vitest";
import { fakeCdp } from "../../cdp/testCdp";
import { NO_TAB_BOUND } from "../../tabs/agentTabs";
import type { CdpClient } from "../../cdp/cdpClient";
import { buildFetchExpression, invokeStructuredAction, type ResolvePolicy } from "./invokeStructuredAction";
import type { AgentPolicyResult } from "./policyTypes";

const policyWith = (actions: unknown): AgentPolicyResult =>
  ({ level: 2, origin: "https://shop.example", policy: { version: "1.0", site: "shop", actions } } as AgentPolicyResult);
const resolveTo =
  (result: AgentPolicyResult): ResolvePolicy =>
  () =>
    Promise.resolve(result);
const cdpReturning = (value: unknown) => fakeCdp({ "Runtime.evaluate": { result: { value } } });

describe("buildFetchExpression", () => {
  it("injects method/path/credentials and a JSON body for writes", () => {
    const expr = buildFetchExpression({ method: "POST", path: "/api/orders", body: { qty: 2 } });
    expect(expr).toContain('location.origin + "/api/orders"');
    expect(expr).toContain('"POST"');
    expect(expr).toContain("credentials: 'include'");
    expect(expr).toContain("application/json");
    expect(expr).toContain(JSON.stringify(JSON.stringify({ qty: 2 })));
  });

  it("omits the body for a GET", () => {
    const expr = buildFetchExpression({ method: "GET", path: "/api/items" });
    expect(expr).not.toContain("body:");
  });
});

describe("invokeStructuredAction", () => {
  const actions = [{ name: "checkout", endpoint: "POST /api/checkout" }];

  it("invokes a declared action and returns the response", async () => {
    const res = await invokeStructuredAction(
      cdpReturning({ status: 200, ok: true, body: { orderId: 7 } }),
      resolveTo(policyWith(actions)),
      { actionName: "checkout", args: { qty: 1 } },
    );
    expect(res).toEqual({ status: 200, ok: true, body: { orderId: 7 } });
  });

  it("returns an HTTP error result instead of throwing (403)", async () => {
    const res = await invokeStructuredAction(
      cdpReturning({ status: 403, ok: false, body: "denied" }),
      resolveTo(policyWith(actions)),
      { actionName: "checkout" },
    );
    expect(res).toEqual({ status: 403, ok: false, body: "denied" });
  });

  it("throws when the page has no declared actions", async () => {
    await expect(
      invokeStructuredAction(cdpReturning({}), resolveTo(policyWith([])), { actionName: "checkout" }),
    ).rejects.toThrow(/no declared agent actions/);
  });

  it("throws on a level-0 page with no policy at all", async () => {
    await expect(
      invokeStructuredAction(cdpReturning({}), resolveTo({ level: 0, origin: null }), { actionName: "checkout" }),
    ).rejects.toThrow(/no declared agent actions/);
  });

  it("throws when the named action is not declared", async () => {
    await expect(
      invokeStructuredAction(cdpReturning({}), resolveTo(policyWith(actions)), { actionName: "refund" }),
    ).rejects.toThrow(/"refund" is not declared/);
  });

  it("throws when actionName is missing", async () => {
    await expect(
      invokeStructuredAction(cdpReturning({}), resolveTo(policyWith(actions)), {}),
    ).rejects.toThrow(/actionName/);
  });

  it("normalizes a malformed evaluate result", async () => {
    const res = await invokeStructuredAction(
      fakeCdp({ "Runtime.evaluate": {} }),
      resolveTo(policyWith(actions)),
      { actionName: "checkout" },
    );
    expect(res).toEqual({ status: 0, ok: false, body: null });
  });

  it("propagates an unbound-tab error from the action fetch", async () => {
    const cdp: CdpClient = { send: () => Promise.reject(new Error(NO_TAB_BOUND)) };
    await expect(
      invokeStructuredAction(cdp, resolveTo(policyWith(actions)), { actionName: "checkout" }),
    ).rejects.toThrow(NO_TAB_BOUND);
  });
});
