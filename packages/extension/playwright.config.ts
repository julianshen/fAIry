import { defineConfig } from "@playwright/test";

// Loads the *built* extension (dist/) into the system Chrome and drives it.
// Extensions need a headed persistent context, so: serial, single worker, headed.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  use: { channel: "chrome", headless: false },
});
