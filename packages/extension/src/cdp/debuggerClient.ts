import type { CdpClient } from "./cdpClient";

/**
 * The real {@link CdpClient}, backed by `chrome.debugger`. Glue — it can't run
 * without a live browser, so it's coverage-excluded; all tool logic is tested
 * against a fake CdpClient instead.
 *
 * Attaches lazily to the focused tab and re-attaches when the agent's focus
 * moves (full multi-tab orchestration — `tabOpen`/`tabSwitch` — is a later PR).
 * `chrome.debugger.sendCommand` is the exact analogue of the POC's
 * `webContents.debugger.sendCommand`.
 */
export function createDebuggerCdpClient(): CdpClient {
  let attached: number | null = null;

  // The debugger detaches on its own when DevTools opens, the tab navigates
  // cross-process, or the tab closes — forget the target so the next call
  // re-attaches instead of sending to a dead session.
  chrome.debugger.onDetach.addListener((source) => {
    if (source.tabId === attached) attached = null;
  });

  // Concurrent sends (e.g. screenshot's parallel reads) must not each fire
  // chrome.debugger.attach — the second throws "already attached". Share one
  // in-flight attach so they serialize behind it.
  let attaching: Promise<number> | null = null;

  function ensureAttached(): Promise<number> {
    if (attaching) return attaching;
    attaching = (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (typeof tab?.id !== "number") throw new Error("no active tab to drive");
        const tabId = tab.id;
        if (attached !== tabId) {
          if (attached !== null) {
            await chrome.debugger.detach({ tabId: attached }).catch(() => {});
          }
          await chrome.debugger.attach({ tabId }, "1.3");
          attached = tabId;
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
