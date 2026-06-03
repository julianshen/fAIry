import { describe, expect, it } from "vitest";
import { createAgentTabs } from "./agentTabs";

describe("createAgentTabs", () => {
  it("starts with no bound tab", () => {
    const t = createAgentTabs();
    expect(t.current()).toBeNull();
    expect(t.ids()).toEqual([]);
    expect(t.isOwned(1)).toBe(false);
  });

  it("bindSession owns exactly the one tab and makes it current", () => {
    const t = createAgentTabs();
    t.add(5);
    t.add(6); // pretend the agent opened a couple
    t.bindSession(9);
    expect(t.ids()).toEqual([9]); // a new task resets ownership
    expect(t.current()).toBe(9);
    expect(t.isOwned(9)).toBe(true);
    expect(t.isOwned(5)).toBe(false);
  });

  it("add() owns a newly-opened tab and makes it current", () => {
    const t = createAgentTabs();
    t.bindSession(1);
    t.add(2);
    expect(t.current()).toBe(2);
    expect(new Set(t.ids())).toEqual(new Set([1, 2]));
  });

  it("setCurrent switches only among owned tabs", () => {
    const t = createAgentTabs();
    t.bindSession(1);
    t.add(2);
    t.setCurrent(1);
    expect(t.current()).toBe(1);
  });

  it("setCurrent refuses a tab the agent does not own (the cross-tab guard)", () => {
    const t = createAgentTabs();
    t.bindSession(1);
    expect(() => t.setCurrent(99)).toThrow(/99.*not.*agent/i);
    expect(t.current()).toBe(1); // unchanged
  });

  it("remove drops a tab and, if it was current, falls back to another owned tab", () => {
    const t = createAgentTabs();
    t.bindSession(1);
    t.add(2);
    expect(t.remove(2)).toBe(true); // 2 was current
    expect(t.isOwned(2)).toBe(false);
    expect(t.current()).toBe(1); // fell back
  });

  it("remove clears current when the last owned tab goes", () => {
    const t = createAgentTabs();
    t.bindSession(1);
    expect(t.remove(1)).toBe(true);
    expect(t.current()).toBeNull();
    expect(t.ids()).toEqual([]);
  });

  it("remove reports false for a tab it never owned and leaves current intact", () => {
    const t = createAgentTabs();
    t.bindSession(1);
    expect(t.remove(42)).toBe(false);
    expect(t.current()).toBe(1);
  });
});
