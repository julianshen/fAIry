import type { Tab, TabsApi } from "./tabsApi";

/**
 * The real {@link TabsApi}, backed by `chrome.tabs`. Glue — needs a live browser,
 * so it's coverage-excluded; the handlers + ownership gating are unit-tested
 * against an in-memory fake.
 */
export function createChromeTabsApi(): TabsApi {
  const toTab = (t: chrome.tabs.Tab): Tab => ({
    id: t.id ?? -1,
    url: t.url ?? "",
    title: t.title ?? "",
    active: t.active ?? false,
  });
  return {
    async create(url) {
      return toTab(await chrome.tabs.create(url ? { url } : {}));
    },
    async get(id) {
      return toTab(await chrome.tabs.get(id));
    },
    async activate(id) {
      const updated = await chrome.tabs.update(id, { active: true });
      return toTab(updated ?? (await chrome.tabs.get(id)));
    },
    async remove(id) {
      await chrome.tabs.remove(id);
    },
    async queryActive() {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      return typeof tab?.id === "number" ? tab.id : null;
    },
  };
}
