import type { CdpClient } from "./cdpClient";
import type { CdpEventBuffer } from "./eventBuffer";
import { NO_TAB_BOUND, type AgentTabs } from "../tabs/agentTabs";

/**
 * The real {@link CdpClient}, backed by `chrome.debugger`. Glue — it can't run
 * without a live browser, so it's coverage-excluded; all tool logic is tested
 * against a fake CdpClient instead.
 *
 * Security: it attaches to `agentTabs.current()` — the tab the agent is *bound*
 * to — never to whatever tab the user happens to be focused on. That's the
 * cross-tab guard: a user switching to their bank tab mid-task can't hand the
 * agent control of it. `chrome.debugger.sendCommand` is the exact analogue of
 * the POC's `webContents.debugger.sendCommand`.
 */
export function createDebuggerCdpClient(agentTabs: AgentTabs, events: CdpEventBuffer): CdpClient {
  let attached: number | null = null;

  // The debugger detaches on its own when DevTools opens, the tab navigates
  // cross-process, or the tab closes — forget the target so the next call
  // re-attaches instead of sending to a dead session.
  chrome.debugger.onDetach.addListener((source) => {
    if (source.tabId === attached) attached = null;
  });

  // Feed subscribed CDP events into the buffer; the agent drains them with
  // cdpCollect. Only events from the attached (agent) tab count.
  chrome.debugger.onEvent.addListener((source, method, params) => {
    if (source.tabId === attached) events.push(method, params ?? null, Date.now());
  });

  // Concurrent sends (e.g. screenshot's parallel reads) must not each fire
  // chrome.debugger.attach — the second throws "already attached". Share one
  // in-flight attach so they serialize behind it.
  let attaching: Promise<number> | null = null;

  function ensureAttached(): Promise<number> {
    if (attaching) return attaching;
    attaching = (async () => {
      try {
        const tabId = agentTabs.current();
        if (tabId === null) throw new Error(NO_TAB_BOUND);
        if (attached !== tabId) {
          if (attached !== null) {
            await chrome.debugger.detach({ tabId: attached }).catch(() => {});
          }
          await chrome.debugger.attach({ tabId }, "1.3");
          attached = tabId;
          // CDP `<domain>.enable` is per-session, so a fresh attach (first use or
          // after tabSwitch) starts with every domain disabled. Replay the active
          // subscriptions' domains, or event capture would silently stop on the
          // new tab until the agent re-subscribes.
          for (const domain of events.domains()) {
            await chrome.debugger.sendCommand({ tabId }, `${domain}.enable`, {}).catch(() => {});
          }
        }
        return tabId;
      } finally {
        attaching = null;
      }
    })();
    return attaching;
  }

  return {
    async send(method, params) {
      const tabId = await ensureAttached();
      return chrome.debugger.sendCommand({ tabId }, method, params ?? {});
    },
  };
}
