import { describe, expect, it } from "vitest";
import { fakeCdp } from "../../cdp/testCdp";
import { NO_TAB_BOUND } from "../../tabs/agentTabs";
import type { CdpClient } from "../../cdp/cdpClient";
import { getAgentPolicy } from "./getAgentPolicy";
import type { PolicyFetch } from "./policyTypes";

function cdpReturning(value: unknown) {
  return fakeCdp({ "Runtime.evaluate": { result: { value } } });
}
const policyFetch = (body: string | null, status = 200): PolicyFetch => ({
  origin: "https://shop.example",
  status,
  body,
});

describe("getAgentPolicy", () => {
  it("fetches, parses, and classifies the policy (level 2 with actions)", async () => {
    const body = JSON.stringify({ version: "1.0", site: "shop", actions: [{ name: "x", endpoint: "GET /x" }] });
    const res = await getAgentPolicy(cdpReturning(policyFetch(body)), {});
    expect(res.level).toBe(2);
    expect(res.origin).toBe("https://shop.example");
    expect(res.policy?.site).toBe("shop");
  });

  it("throws when the page fetch never got a response (status 0 — network/timeout)", async () => {
    // A transport failure is distinct from a real 404 (which classifies as level 0),
    // so callers — e.g. navigate enrichment's cache — don't store it as "no policy".
    await expect(getAgentPolicy(cdpReturning(policyFetch(null, 0)), {})).rejects.toThrow(/policy fetch failed/i);
  });

  it("classifies a real HTTP response with no usable policy as level 0 (e.g. 404)", async () => {
    const res = await getAgentPolicy(cdpReturning(policyFetch(null, 404)), {});
    expect(res).toEqual({ level: 0, origin: "https://shop.example" });
  });

  it("throws when the evaluate result is malformed (no value → status 0)", async () => {
    await expect(getAgentPolicy(fakeCdp({ "Runtime.evaluate": {} }), {})).rejects.toThrow(/policy fetch failed/i);
  });

  it("propagates an unbound-tab error", async () => {
    const cdp: CdpClient = { send: () => Promise.reject(new Error(NO_TAB_BOUND)) };
    await expect(getAgentPolicy(cdp, {})).rejects.toThrow(NO_TAB_BOUND);
  });
});
