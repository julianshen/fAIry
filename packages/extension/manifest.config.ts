import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "Fairy",
  version: "0.0.0",
  description: "A browser agent you talk to.",
  background: { service_worker: "src/background.ts", type: "module" },
  options_page: "src/options/index.html",
  side_panel: { default_path: "src/panel/index.html" },
  action: { default_title: "Fairy" },
  // debugger/tabs/scripting are for the (later) browser tool handlers; storage
  // holds the paired connection; sidePanel opens the conversation UI.
  permissions: ["storage", "sidePanel", "debugger", "tabs", "scripting"],
  // `:*` for any port (the WS ports are ephemeral, discovered via /info; HTTP is
  // :51789) and the `ws://` scheme — without both, the discovery HTTP calls and
  // the conversation/bridge WS connections are blocked at connect time.
  host_permissions: ["http://127.0.0.1:*/*", "ws://127.0.0.1:*/*"],
});
