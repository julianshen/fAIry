/**
 * The `chrome.tabs` seam used by the tab handlers. Kept as an interface so the
 * handlers (and the ownership gating in {@link import("./agentTabs").AgentTabs})
 * are unit-tested with an in-memory fake; the real `chrome.tabs` adapter is glue.
 */
export interface Tab {
  id: number;
  url: string;
  title: string;
  active: boolean;
}

export interface TabsApi {
  create(url?: string): Promise<Tab>;
  get(id: number): Promise<Tab>;
  activate(id: number): Promise<Tab>;
  remove(id: number): Promise<void>;
  /** The focused tab's id (for binding a task to the tab the user started on), or null. */
  queryActive(): Promise<number | null>;
}
