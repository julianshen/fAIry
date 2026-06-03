import { defineConfig } from "@playwright/test";

// Loads the *built* extension (dist/) into Playwright's bundled Chromium and
// drives it. Bundled Chromium (not branded Chrome 137+, which dropped
// --load-extension) side-loads unpacked extensions. Headed persistent context,
// so: serial, single worker, headed.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  use: { headless: false },
});
