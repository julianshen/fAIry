import { describe, expect, it } from "vitest";
import { createAgentTabs } from "../tabs/agentTabs";
import type { Tab, TabsApi } from "../tabs/tabsApi";
import { tabClose, tabList, tabOpen, tabSwitch } from "./tabs";

/** In-memory TabsApi: a map of tabs + a record of calls. */
function fakeTabs(initial: Tab[] = []): TabsApi & { store: Map<number, Tab>; removed: number[] } {
  const store = new Map<number, Tab>(initial.map((t) => [t.id, t]));
  const removed: number[] = [];
  let nextId = 100;
  return {
    store,
    removed,
    create(url) {
      const tab: Tab = { id: nextId++, url: url ?? "about:blank", title: "", active: true };
      store.set(tab.id, tab);
      return Promise.resolve(tab);
    },
    get(id) {
      const t = store.get(id);
      if (!t) return Promise.reject(new Error(`no tab ${id}`));
      return Promise.resolve(t);
    },
    activate(id) {
      const t = store.get(id);
      if (!t) return Promise.reject(new Error(`no tab ${id}`));
      return Promise.resolve({ ...t, active: true });
    },
    remove(id) {
      store.delete(id);
      removed.push(id);
      return Promise.resolve();
    },
    queryActive: () => Promise.resolve(null),
  };
}

describe("tabOpen", () => {
  it("creates a tab, takes ownership, makes it current, returns its descriptor", async () => {
    const tabs = fakeTabs();
    const agent = createAgentTabs();
    const result = await tabOpen(tabs, agent, { url: "https://example.com" });
    expect(result).toMatchObject({ url: "https://example.com", isActive: true });
    const id = Number((result as { id: string }).id);
    expect(agent.isOwned(id)).toBe(true);
    expect(agent.current()).toBe(id);
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
});
