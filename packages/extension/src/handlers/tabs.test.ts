import { describe, expect, it } from "vitest";
import { createAgentTabs } from "../tabs/agentTabs";
import { fakeTabs } from "../tabs/testTabs";
import { fakeCdp } from "../cdp/testCdp";

import { tabClose, tabList, tabOpen, tabSwitch } from "./tabs";

describe("tabOpen", () => {
  /** A session must be bound (via taskStart) before the agent can open tabs. */
  function boundAgent() {
    const agent = createAgentTabs();
    agent.bindSession(1);
    return agent;
  }

  it("creates a tab, takes ownership, makes it current, returns its descriptor", async () => {
    const tabs = fakeTabs();
    const agent = boundAgent();
    const result = await tabOpen(tabs, agent, fakeCdp(), { url: "https://example.com" });
    expect(result).toMatchObject({ url: "https://example.com", isActive: true });
    const id = Number((result as { id: string }).id);
    expect(agent.isOwned(id)).toBe(true);
    expect(agent.current()).toBe(id);
  });

  it("opens a blank drivable tab first, then navigates via CDP (debugger attaches before the load)", async () => {
    const tabs = fakeTabs();
    const cdp = fakeCdp();
    const agent = boundAgent();
    await tabOpen(tabs, agent, cdp, { url: "https://example.com" });
    // the tab was created blank (drivable), not via chrome.tabs.create(url)
    const created = [...tabs.store.values()].find((t) => t.id !== 1);
    expect(created?.url).toBe("about:blank");
    // navigation went through CDP after ownership/attach, so subscriptions replay first
    expect(cdp.calls.find((c) => c.method === "Page.navigate")?.params).toEqual({
      url: "https://example.com",
    });
  });

  it("opens a blank tab when no url is given (no navigation)", async () => {
    const tabs = fakeTabs();
    const cdp = fakeCdp();
    await tabOpen(tabs, boundAgent(), cdp, {});
    expect(tabs.store.size).toBe(1);
    expect(cdp.calls.find((c) => c.method === "Page.navigate")).toBeUndefined();
  });

  it("refuses a non-http(s) url without creating a tab (same gate as navigate)", async () => {
    const tabs = fakeTabs();
    await expect(tabOpen(tabs, boundAgent(), fakeCdp(), { url: "file:///etc/passwd" })).rejects.toThrow(
      /http/,
    );
    expect(tabs.store.size).toBe(0);
  });

  it("refuses to open a tab when no session is bound (fail closed, like the CDP path)", async () => {
    const tabs = fakeTabs();
    const agent = createAgentTabs(); // never bound
    await expect(tabOpen(tabs, agent, fakeCdp(), { url: "https://example.com" })).rejects.toThrow(
      /no tab bound/i,
    );
    expect(tabs.store.size).toBe(0);
  });
});

describe("tabSwitch", () => {
  it("switches among owned tabs and marks the target active", async () => {
    const tabs = fakeTabs([
      { id: 1, url: "a", title: "A", active: false },
      { id: 2, url: "b", title: "B", active: true },
    ]);
    const agent = createAgentTabs();
    agent.bindSession(1);
    agent.add(2);
    const result = await tabSwitch(tabs, agent, { id: "1" });
    expect(result).toMatchObject({ id: "1", isActive: true });
    expect(agent.current()).toBe(1);
  });

  it("refuses to switch to a tab the agent does not own", async () => {
    const tabs = fakeTabs([{ id: 7, url: "x", title: "X", active: true }]);
    const agent = createAgentTabs();
    agent.bindSession(1);
    await expect(tabSwitch(tabs, agent, { id: "7" })).rejects.toThrow(/not.*agent/i);
    expect(agent.current()).toBe(1);
  });

  it("leaves current unchanged when activation fails (owned tab went stale)", async () => {
    const tabs = fakeTabs([{ id: 1, url: "a", title: "A", active: true }]);
    const agent = createAgentTabs();
    agent.bindSession(1);
    agent.add(2); // owned but missing from the store → activate(2) rejects
    agent.setCurrent(1); // currently on tab 1
    await expect(tabSwitch(tabs, agent, { id: "2" })).rejects.toThrow();
    expect(agent.current()).toBe(1); // not moved onto the dead tab
  });
});

describe("tabClose", () => {
  it("closes an owned tab and drops ownership", async () => {
    const tabs = fakeTabs([
      { id: 1, url: "a", title: "A", active: true },
      { id: 2, url: "b", title: "B", active: false },
    ]);
    const agent = createAgentTabs();
    agent.bindSession(1);
    agent.add(2);
    const result = await tabClose(tabs, agent, { id: "2" });
    expect(result).toEqual({ closed: true });
    expect(tabs.removed).toEqual([2]);
    expect(agent.isOwned(2)).toBe(false);
  });

  it("refuses to close a tab the agent does not own (no closing the user's tabs)", async () => {
    const tabs = fakeTabs([{ id: 9, url: "bank", title: "Bank", active: true }]);
    const agent = createAgentTabs();
    agent.bindSession(1);
    await expect(tabClose(tabs, agent, { id: "9" })).rejects.toThrow(/not.*agent/i);
    expect(tabs.removed).toEqual([]);
  });
});

describe("tabList", () => {
  it("lists only agent-owned tabs and flags the current one", async () => {
    const tabs = fakeTabs([
      { id: 1, url: "a", title: "A", active: false },
      { id: 2, url: "b", title: "B", active: false },
      { id: 9, url: "bank", title: "Bank", active: true }, // user's tab, NOT owned
    ]);
    const agent = createAgentTabs();
    agent.bindSession(1);
    agent.add(2);
    agent.setCurrent(1);
    const result = (await tabList(tabs, agent, {})) as Array<{ id: string; isActive: boolean }>;
    expect(result.map((t) => t.id).sort()).toEqual(["1", "2"]);
    expect(result.find((t) => t.id === "9")).toBeUndefined(); // bank tab invisible
    expect(result.find((t) => t.id === "1")?.isActive).toBe(true);
    expect(result.find((t) => t.id === "2")?.isActive).toBe(false);
  });

  it("skips an owned tab that can no longer be fetched (closed mid-call)", async () => {
    const tabs = fakeTabs([{ id: 1, url: "a", title: "A", active: true }]);
    const agent = createAgentTabs();
    agent.bindSession(1);
    agent.add(2); // owned but not in the store → get(2) rejects
    const result = (await tabList(tabs, agent, {})) as Array<{ id: string }>;
    expect(result.map((t) => t.id)).toEqual(["1"]); // 2 skipped, no overall failure
  });
});
