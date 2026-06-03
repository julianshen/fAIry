import type { Tab, TabsApi } from "./tabsApi";

/** A {@link TabsApi} backed by an in-memory map, with introspection for tests. */
export interface RecordingTabsApi extends TabsApi {
  readonly store: Map<number, Tab>;
  readonly removed: number[];
}

/**
 * Shared handler-test double for the `chrome.tabs` seam (the `testCdp.ts`
 * pattern). Seeds an in-memory store, mints ids for `create`, and records
 * removals; `queryActive` returns null unless overridden by seeding.
 */
export function fakeTabs(initial: Tab[] = []): RecordingTabsApi {
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
      return t ? Promise.resolve(t) : Promise.reject(new Error(`no tab ${id}`));
    },
    activate(id) {
      const t = store.get(id);
      return t ? Promise.resolve({ ...t, active: true }) : Promise.reject(new Error(`no tab ${id}`));
    },
    remove(id) {
      store.delete(id);
      removed.push(id);
      return Promise.resolve();
    },
    queryActive: () => Promise.resolve(null),
  };
}
