import { test, expect } from "@playwright/test";
import { EXTENSION_ID, startDaemon, launchWithExtension, cleanup } from "./_harness";

// ─────────────────────────────────────────────────────────────────────────────
// PAIRING E2E: the options page redeems a real pairing code against the real
// daemon and reports "Paired!". Uses the shared harness (startDaemon /
// launchWithExtension) for the daemon spawn + side-loaded extension, then drives
// the options page directly so the assertion (the page reports paired) is visible
// here. Skips (not fails) on a browser that can't side-load the MV3 extension.
// ─────────────────────────────────────────────────────────────────────────────

test("the options page pairs with the daemon", async () => {
  let context: import("@playwright/test").BrowserContext | undefined;
  let userDataDir: string | undefined;
  let home: string | undefined;
  let stop: (() => void) | undefined;
  let pairingCode: string;

  try {
    let extensionLoaded: boolean;
    ({ context, userDataDir, extensionLoaded } = await launchWithExtension());
    test.skip(
      !extensionLoaded,
      "Chrome did not load the unpacked extension (137+ removed --load-extension) — run with a compatible Chromium.",
    );

    ({ home, pairingCode, stop } = await startDaemon({}));

    const page = await context.newPage();
    await page.goto(`chrome-extension://${EXTENSION_ID}/src/options/index.html`);

    await expect(page.getByRole("heading", { name: "Pair Fairy" })).toBeVisible();
    await page.getByPlaceholder("pairing code").fill(pairingCode);
    await page.getByRole("button", { name: "Pair" }).click();

    // discover() ran POST /pair + GET /info against the real daemon (CORS allows
    // the chrome-extension origin); the success message means the token was
    // received and saveConnection() persisted it to chrome.storage.
    await expect(page.getByText(/Paired!/)).toBeVisible({ timeout: 15_000 });
  } finally {
    stop?.();
    await context?.close();
    cleanup([home, userDataDir]);
  }
});
