import { describe, expect, it } from "vitest";
import { parseAgentPolicy } from "./parseAgentPolicy";
import type { PolicyFetch } from "./policyTypes";

const ORIGIN = "https://shop.example";
function fetched(body: string | null, status = 200): PolicyFetch {
  return { origin: ORIGIN, status, body };
}
const json = (o: unknown): string => JSON.stringify(o);

describe("parseAgentPolicy", () => {
  it("returns level 0 on a network failure (status 0)", () => {
    expect(parseAgentPolicy({ origin: ORIGIN, status: 0, body: null })).toEqual({ level: 0, origin: ORIGIN });
  });

  it("returns level 0 on a non-200 (e.g. 404), keeping the origin", () => {
    expect(parseAgentPolicy(fetched(null, 404))).toEqual({ level: 0, origin: ORIGIN });
  });

  it("returns level 0 on an invalid-JSON body", () => {
    expect(parseAgentPolicy(fetched("not json{"))).toEqual({ level: 0, origin: ORIGIN });
  });

  it("returns level 0 when the JSON is not an object", () => {
    expect(parseAgentPolicy(fetched("42")).level).toBe(0);
    expect(parseAgentPolicy(fetched("[]")).level).toBe(0);
  });

  it("returns level 0 when version is missing or not 1.x", () => {
    expect(parseAgentPolicy(fetched(json({ site: "s" }))).level).toBe(0);
    expect(parseAgentPolicy(fetched(json({ version: "2.0", site: "s" }))).level).toBe(0);
  });

  it("returns level 0 for an oversized body", () => {
    const huge = json({ version: "1.0", site: "s", pad: "x".repeat(1_000_001) });
    expect(parseAgentPolicy(fetched(huge)).level).toBe(0);
  });

  it("classifies a basic valid v1 policy as level 1 and returns it", () => {
    const r = parseAgentPolicy(fetched(json({ version: "1.0", site: "shop" })));
    expect(r.level).toBe(1);
    expect(r.origin).toBe(ORIGIN);
    expect(r.policy).toMatchObject({ version: "1.0", site: "shop" });
  });

  it("classifies a policy with declared actions as level 2", () => {
    const r = parseAgentPolicy(
      fetched(json({ version: "1.2", site: "shop", actions: [{ name: "checkout", endpoint: "POST /checkout" }] })),
    );
    expect(r.level).toBe(2);
  });

  it("classifies a policy with governance fields as level 3", () => {
    const r = parseAgentPolicy(fetched(json({ version: "1.0", site: "shop", prohibited: [{ trigger: "scrape" }] })));
    expect(r.level).toBe(3);
  });

  it("treats governance without actions as level 3 (max-wins)", () => {
    const r = parseAgentPolicy(fetched(json({ version: "1.0", site: "shop", consent: { checkout: "always_human" } })));
    expect(r.level).toBe(3);
  });

  it("ignores an empty actions array (stays level 1)", () => {
    const r = parseAgentPolicy(fetched(json({ version: "1.0", site: "shop", actions: [] })));
    expect(r.level).toBe(1);
  });
});
