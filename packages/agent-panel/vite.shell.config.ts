import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Standalone build of the shell host (src/shell/index.html) into dist-shell/.
// `base: "./"` makes asset URLs relative so the bundle loads from a file:// URL
// inside the macOS shell's WKWebView.
export default defineConfig({
  plugins: [react()],
  root: "src/shell",
  base: "./",
  build: {
    outDir: "../../dist-shell",
    emptyOutDir: true,
  },
});
