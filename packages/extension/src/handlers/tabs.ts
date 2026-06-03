import type { AgentTabs } from "../tabs/agentTabs";
import type { Tab, TabsApi } from "../tabs/tabsApi";
import { requireString } from "./args";

interface TabDescriptor {
  id: string;
  url: string;
  title: string;
  isActive: boolean;
}

/** Wire descriptor for a tab: string id, and `isActive` = "is the agent's current tab". */
function describe(tab: Tab, agentTabs: AgentTabs): TabDescriptor {
  return { id: String(tab.id), url: tab.url, title: tab.title, isActive: tab.id === agentTabs.current() };
}

/** Parse the wire `id` (a string) into a chrome tab id. */
function tabId(args: Record<string, unknown>): number {
  const raw = requireString(args, "id");
  const id = Number(raw);
  if (!Number.isInteger(id)) throw new Error(`id must be an integer tab id, got ${raw}`);
  return id;
}

/** Open a new tab, take ownership, make it current. */
export async function tabOpen(
  tabs: TabsApi,
  agentTabs: AgentTabs,
  args: Record<string, unknown>,
): Promise<TabDescriptor> {
  const url = typeof args.url === "string" ? args.url : undefined;
  const tab = await tabs.create(url);
  agentTabs.add(tab.id);
  return describe(tab, agentTabs);
}

/** Switch the agent's current tab — only among owned tabs (setCurrent throws otherwise). */
export async function tabSwitch(
  tabs: TabsApi,
  agentTabs: AgentTabs,
  args: Record<string, unknown>,
): Promise<TabDescriptor> {
  const id = tabId(args);
  agentTabs.setCurrent(id); // refuses a non-owned tab — the cross-tab guard
  const tab = await tabs.activate(id);
  return describe(tab, agentTabs);
}

/** Close an owned tab; refuse to touch the user's own tabs. */
export async function tabClose(
  tabs: TabsApi,
  agentTabs: AgentTabs,
  args: Record<string, unknown>,
): Promise<{ closed: boolean }> {
  const id = tabId(args);
  if (!agentTabs.isOwned(id)) throw new Error(`tab ${id} is not agent-controlled`);
  await tabs.remove(id);
  agentTabs.remove(id);
  return { closed: true };
}

/** List only the agent-owned tabs (the user's other tabs stay invisible). */
export async function tabList(
  tabs: TabsApi,
  agentTabs: AgentTabs,
  _args: Record<string, unknown>,
): Promise<TabDescriptor[]> {
  const owned = await Promise.all(
    agentTabs.ids().map((id) => tabs.get(id).then((tab) => describe(tab, agentTabs))),
  );
  return owned;
}
