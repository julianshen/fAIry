import { connectBridge, type BridgeClient } from "./bridgeClient";
import { createDebuggerCdpClient } from "./cdp/debuggerClient";
import { loadConnection } from "./connection";
import { createBrowserHandlers } from "./handlers/registry";
import { createToolExecutor } from "./toolExecutor";

// Background service worker.
//
// (1) Open the side panel (the conversation UI) on toolbar-icon click.
// (2) Run the browser-bridge executor: connect the bridge WS for the paired
//     daemon and execute Pi's relayed tool calls against the active tab via
//     chrome.debugger. This is glue (no live browser in unit tests), so it's
//     coverage-excluded; the dispatch + handler logic it wires together is
//     tested in toolExecutor / handlers.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => {
  console.error("[fairy] failed to set side-panel behavior", err);
});

let bridge: BridgeClient | null = null;
// Serialize (re)connects: two storage-change events in quick succession would
// otherwise each close-then-reassign across the `await`, leaking the first socket.
let connecting: Promise<void> | null = null;

function connectBridgeForConnection(): Promise<void> {
  connecting = (connecting ?? Promise.resolve()).then(async () => {
    const conn = await loadConnection();
    if (!conn) {
      // Unpaired (or never paired): tear down any live bridge, don't orphan it.
      bridge?.close();
      bridge = null;
      return;
    }
    bridge?.close();
    const executor = createToolExecutor(createBrowserHandlers(createDebuggerCdpClient()));
    bridge = connectBridge({
      url: `ws://127.0.0.1:${conn.bridgePort}`,
      token: conn.token,
      execute: executor.execute,
      onClose: () => {
        bridge = null;
      },
    });
  });
  return connecting;
}

connectBridgeForConnection().catch((err) => {
  console.error("[fairy] failed to connect browser bridge", err);
});

// Reconnect when the stored connection changes — e.g. right after the options
// page completes pairing for the first time.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.connection) {
    connectBridgeForConnection().catch((err) => {
      console.error("[fairy] failed to reconnect browser bridge", err);
    });
  }
});
