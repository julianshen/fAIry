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

// The executor only drives the active tab, so it's stable across reconnects —
// build it once. (Rebuilding per reconnect would also re-register a
// chrome.debugger.onDetach listener each time, leaking dead closures.)
const executor = createToolExecutor(createBrowserHandlers(createDebuggerCdpClient()));

let bridge: BridgeClient | null = null;
// Serialize (re)connects so two storage-change events can't close-then-reassign
// across the `await` and leak a socket.
let connecting: Promise<void> | null = null;

function connectBridgeForConnection(): Promise<void> {
  // Recover from a prior rejection first — otherwise a single transient failure
  // would leave `connecting` rejected and skip every future reconnect.
  const run = (connecting ?? Promise.resolve()).catch(() => {}).then(async () => {
    const conn = await loadConnection();
    // Tear down any existing bridge before (re)deciding — also the unpair path.
    bridge?.close();
    bridge = null;
    if (!conn) return; // unpaired (or never paired)
    const next = connectBridge({
      url: `ws://127.0.0.1:${conn.bridgePort}`,
      token: conn.token,
      execute: executor.execute,
      // Only clear if *this* bridge is still the current one — a stale older
      // bridge closing late must not wipe a newer reference.
      onClose: () => {
        if (bridge === next) bridge = null;
      },
    });
    bridge = next;
  });
  connecting = run.finally(() => {
    if (connecting === run) connecting = null;
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
