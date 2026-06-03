import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  // Pins a deterministic extension id (for the E2E + stable dev id). Dev-only.
  key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1K6kyS53qL2h0FibRaJ7+oSswnf/3X+lPRrM/eGNkyrjGyUA3t8/fluol0z6hhjNg5lEmPdkyfcKM4R63TlogpIOkzH0n+di6wcwklnA3Y27g++wMAZsLPQ34/PK8T8ZnED/SGowZ1aL7qRgUA8UM+D3ORav/3+aE+v1Y3/4nObVdpWoRApy3k/B2iypkjfjftj70ejVmwmdmoIxBt4ZbJnOTqWdOKXUfDtSS/1XHI8FPPoelot1qth/8gzFoe+7hQnaZAByRCOAJizOWXuiy4f/t7zI6eqIF/YSaUCni0uI/9oXi7SguCTnVxbM1A111vSwUiJ7Gyjx+aAyXIcDjwIDAQAB",
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
