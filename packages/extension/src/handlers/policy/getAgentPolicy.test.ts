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

  it("returns level 0 when the page fetch failed (status 0)", async () => {
    const res = await getAgentPolicy(cdpReturning(policyFetch(null, 0)), {});
    expect(res).toEqual({ level: 0, origin: "https://shop.example" });
  });

  it("returns level 0 when the evaluate result is malformed (no value)", async () => {
    const res = await getAgentPolicy(fakeCdp({ "Runtime.evaluate": {} }), {});
    expect(res).toEqual({ level: 0, origin: null });
  });

  it("propagates an unbound-tab error", async () => {
    const cdp: CdpClient = { send: () => Promise.reject(new Error(NO_TAB_BOUND)) };
    await expect(getAgentPolicy(cdp, {})).rejects.toThrow(NO_TAB_BOUND);
  });
});
