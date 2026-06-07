/**
 * Thrown (and recognized) when an agent action runs with no bound session — the
 * fail-closed signal. A shared constant so the few sites that produce/detect it
 * agree on stable wording rather than coupling to Chrome's varying error text.
 */
export const NO_TAB_BOUND = "no tab bound to the agent (start a task first)";

/**
 * The agent-tab binding — the heart of the cross-tab security model.
 *
 * The agent may only drive tabs it *owns*: the tab a task was bound to, plus any
 * it opened itself. The CDP adapter attaches to `current()` (never to whatever
 * tab the user happens to be focused on), and `tabSwitch`/`tabClose`/`tabList`
 * are gated on ownership — so a user switching to their bank tab mid-task can't
 * hand the agent control of it.
 *
 * Pure (numbers in, numbers out, no `chrome.*`) so the invariant is unit-tested.
 */
export interface AgentTabs {
  /** Bind a fresh task: this tab becomes the sole owned tab and the current one. */
  bindSession(tabId: number): void;
  /** Own a tab the agent just opened, and make it current. */
  add(tabId: number): void;
  isOwned(tabId: number): boolean;
  /** The tab CDP commands target, or null if nothing is bound yet. */
  current(): number | null;
  /** Switch the current tab — only among owned tabs; throws otherwise. */
  setCurrent(tabId: number): void;
  /** Drop a tab; if it was current, fall back to another owned tab (or null). Returns whether it was owned. */
  remove(tabId: number): boolean;
  /** All owned tab ids. */
  ids(): number[];
  /** Drop all ownership (unbound run): nothing is owned and `current()` is null. */
  clear(): void;
}

export function createAgentTabs(): AgentTabs {
  let owned = new Set<number>();
  let current: number | null = null;

  return {
    bindSession(tabId) {
      owned = new Set([tabId]);
      current = tabId;
    },
    add(tabId) {
      owned.add(tabId);
      current = tabId;
    },
    isOwned(tabId) {
      return owned.has(tabId);
    },
    current() {
      return current;
    },
    setCurrent(tabId) {
      if (!owned.has(tabId)) throw new Error(`tab ${tabId} is not agent-controlled`);
      current = tabId;
    },
    remove(tabId) {
      const had = owned.delete(tabId);
      if (current === tabId) current = owned.values().next().value ?? null;
      return had;
    },
    ids() {
      return [...owned];
    },
    clear() {
      owned = new Set();
      current = null;
    },
  };
}
