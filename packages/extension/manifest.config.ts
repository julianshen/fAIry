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
  // Host match patterns carry no port — `http://127.0.0.1/*` already matches the
  // daemon on ANY port (a `:port` segment is invalid and rejects the manifest).
  // `ws://` isn't a valid host_permissions scheme either; the WS connections are
  // allowed via the connect-src CSP below instead.
  host_permissions: ["http://127.0.0.1/*"],
  content_security_policy: {
    extension_pages:
      "script-src 'self'; object-src 'self'; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*;",
  },
});
