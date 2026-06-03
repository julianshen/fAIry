import { crx } from "@crxjs/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import manifest from "./manifest.config";

// Build the MV3 extension. Tests use the separate vitest.config.ts (no crx/react).
export default defineConfig({
  plugins: [react(), crx({ manifest })],
  server: { port: 5174, strictPort: true, hmr: { port: 5174 } },
});
