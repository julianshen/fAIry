import { enrichNavigate, type Relay } from "./enrichNavigate";
import { createPolicyCache } from "./policyCache";
import { fakeDomainSkills } from "./testFakes";

const POLICY = { level: 2, origin: "https://shop.example", policy: { version: "1.0", site: "shop" } };

/** A relay that records calls and answers per tool. */
function recordingRelay(
  answers: Record<string, (args: Record<string, unknown>) => Promise<unknown>>,
): Relay & { calls: { tool: string; args: Record<string, unknown> }[] } {
  const calls: { tool: string; args: Record<string, unknown> }[] = [];
  const relay = ((tool, args) => {
    calls.push({ tool, args });
    const fn = answers[tool];
    return fn ? fn(args) : Promise.resolve({ ok: true });
  }) as Relay & { calls: typeof calls };
  relay.calls = calls;
  return relay;
}

const okNav = { navigate: () => Promise.resolve({ ok: true }) };

describe("enrichNavigate", () => {
  it("merges domainSkillsAvailable + agentPolicy onto the navigate result", async () => {
    const relay = recordingRelay({ ...okNav, getAgentPolicy: () => Promise.resolve(POLICY) });
    const domainSkills = fakeDomainSkills({ list: () => Promise.resolve(["pricing"]) });
    const res = await enrichNavigate({ url: "https://shop.example/p/1" }, { relay, domainSkills, cache: createPolicyCache() });
    expect(res).toEqual({ ok: true, domainSkillsAvailable: ["pricing"], agentPolicy: POLICY });
  });

  it("uses the landed policy origin for the domain-skills host", async () => {
    const relay = recordingRelay({ ...okNav, getAgentPolicy: () => Promise.resolve(POLICY) });
    let askedHost = "";
    const domainSkills = fakeDomainSkills({ list: (h: string) => { askedHost = h; return Promise.resolve([]); } });
    await enrichNavigate({ url: "https://shop.example/p/1" }, { relay, domainSkills, cache: createPolicyCache() });
    expect(askedHost).toBe("shop.example");
  });

  it("caches the policy per origin: a second same-origin navigate relays getAgentPolicy once", async () => {
    const relay = recordingRelay({ ...okNav, getAgentPolicy: () => Promise.resolve(POLICY) });
    const cache = createPolicyCache();
    const domainSkills = fakeDomainSkills();
    await enrichNavigate({ url: "https://shop.example/a" }, { relay, domainSkills, cache });
    await enrichNavigate({ url: "https://shop.example/b" }, { relay, domainSkills, cache });
    expect(relay.calls.filter((c) => c.tool === "getAgentPolicy")).toHaveLength(1);
  });

  it("re-relays getAgentPolicy for a different origin", async () => {
    const relay = recordingRelay({ ...okNav, getAgentPolicy: () => Promise.resolve(POLICY) });
    const cache = createPolicyCache();
    const domainSkills = fakeDomainSkills();
    await enrichNavigate({ url: "https://a.com/x" }, { relay, domainSkills, cache });
    await enrichNavigate({ url: "https://b.com/x" }, { relay, domainSkills, cache });
    expect(relay.calls.filter((c) => c.tool === "getAgentPolicy")).toHaveLength(2);
  });

  it("passes the hostname without the port to domainSkills.list (URL.hostname, not .host)", async () => {
    const relay = recordingRelay({
      ...okNav,
      getAgentPolicy: () => Promise.resolve({ level: 0, origin: "http://localhost:3000" }),
    });
    let askedHost = "";
    const domainSkills = fakeDomainSkills({
      list: (h: string) => {
        askedHost = h;
        return Promise.resolve([]);
      },
    });
    await enrichNavigate({ url: "http://localhost:3000/app" }, { relay, domainSkills, cache: createPolicyCache() });
    expect(askedHost).toBe("localhost");
  });

  it("falls back to the requested host when the policy origin has no usable http host", async () => {
    const relay = recordingRelay({
      ...okNav,
      getAgentPolicy: () => Promise.resolve({ level: 1, origin: "file:///etc", policy: {} }),
    });
    let askedHost = "";
    const domainSkills = fakeDomainSkills({
      list: (h: string) => {
        askedHost = h;
        return Promise.resolve([]);
      },
    });
    await enrichNavigate({ url: "https://shop.example/a" }, { relay, domainSkills, cache: createPolicyCache() });
    expect(askedHost).toBe("shop.example");
  });

  it("caches under the policy's reported origin, so a stale/redirect read doesn't poison the requested origin", async () => {
    // Policy reports a DIFFERENT origin than requested (a pre-commit/stale read or
    // a cross-origin redirect): the requested origin must not be cached.
    const OTHER = { level: 1, origin: "https://other.example", policy: {} };
    const relay = recordingRelay({ ...okNav, getAgentPolicy: () => Promise.resolve(OTHER) });
    const cache = createPolicyCache();
    const domainSkills = fakeDomainSkills();
    await enrichNavigate({ url: "https://shop.example/a" }, { relay, domainSkills, cache });
    await enrichNavigate({ url: "https://shop.example/b" }, { relay, domainSkills, cache });
    // requested origin never cached → getAgentPolicy re-relayed (no poisoning)
    expect(relay.calls.filter((c) => c.tool === "getAgentPolicy")).toHaveLength(2);
    // but the reported origin WAS cached → navigating to it hits the cache
    await enrichNavigate({ url: "https://other.example/x" }, { relay, domainSkills, cache });
    expect(relay.calls.filter((c) => c.tool === "getAgentPolicy")).toHaveLength(2);
  });

  it("omits agentPolicy (and does not cache) when getAgentPolicy fails", async () => {
    const relay = recordingRelay({ ...okNav, getAgentPolicy: () => Promise.reject(new Error("no tab")) });
    const cache = createPolicyCache();
    const domainSkills = fakeDomainSkills({ list: () => Promise.resolve(["x"]) });
    const res = (await enrichNavigate({ url: "https://shop.example/a" }, { relay, domainSkills, cache })) as Record<string, unknown>;
    expect(res.agentPolicy).toBeUndefined();
    expect(res.domainSkillsAvailable).toEqual(["x"]);
    await enrichNavigate({ url: "https://shop.example/b" }, { relay, domainSkills, cache });
    expect(relay.calls.filter((c) => c.tool === "getAgentPolicy")).toHaveLength(2);
  });

  it("omits domainSkillsAvailable when domainSkills.list fails", async () => {
    const relay = recordingRelay({ ...okNav, getAgentPolicy: () => Promise.resolve(POLICY) });
    const domainSkills = fakeDomainSkills({ list: () => Promise.reject(new Error("io")) });
    const res = (await enrichNavigate({ url: "https://shop.example/a" }, { relay, domainSkills, cache: createPolicyCache() })) as Record<string, unknown>;
    expect(res.domainSkillsAvailable).toBeUndefined();
    expect(res.agentPolicy).toEqual(POLICY);
  });

  it("propagates a failed navigate (no enrichment)", async () => {
    const relay = recordingRelay({ navigate: () => Promise.reject(new Error("nav failed")) });
    await expect(
      enrichNavigate({ url: "https://shop.example/a" }, { relay, domainSkills: fakeDomainSkills(), cache: createPolicyCache() }),
    ).rejects.toThrow(/nav failed/);
    expect(relay.calls.filter((c) => c.tool === "getAgentPolicy")).toHaveLength(0);
  });

  it("returns a non-object navigate result unchanged (no enrichment)", async () => {
    const relay = recordingRelay({ navigate: () => Promise.resolve("ok-string") });
    const res = await enrichNavigate({ url: "https://shop.example/a" }, { relay, domainSkills: fakeDomainSkills(), cache: createPolicyCache() });
    expect(res).toBe("ok-string");
    expect(relay.calls.filter((c) => c.tool === "getAgentPolicy")).toHaveLength(0);
  });

  it("returns the base result unchanged for an unparseable/non-http url", async () => {
    const relay = recordingRelay({ ...okNav, getAgentPolicy: () => Promise.resolve(POLICY) });
    const res = await enrichNavigate({ url: "not a url" }, { relay, domainSkills: fakeDomainSkills(), cache: createPolicyCache() });
    expect(res).toEqual({ ok: true });
    expect(relay.calls.filter((c) => c.tool === "getAgentPolicy")).toHaveLength(0);
  });
});
