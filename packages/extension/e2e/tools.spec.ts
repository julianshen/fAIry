import { test, expect } from "@playwright/test";
import path from "node:path";
import { serveFixture, startDaemon, launchWithExtension, openSidePanel, pair, cleanup, HERE } from "./_harness";
import { bookingScript } from "./bookingScript";

// ─────────────────────────────────────────────────────────────────────────────
// TOOLS E2E (happy path): a scripted fake-pi books a flight on the demo site
// end-to-end through the REAL stack with NO LLM, asserting the booking
// confirmation. The mechanics are exactly the spike's (see spike.spec.ts):
//
//   fake-pi (FAIRY_PI_BIN) → daemon piBridge → daemon browser-bridge WS →
//   loaded MV3 extension → chrome.debugger / CDP → the demo flight site.
//
// Difference from the spike: we serve fixtures/flight-site and feed fake-pi the
// full deterministic booking sequence (bookingScript); after the bind we wait
// for #confirmation to become visible and contain the "FAIRY-" reference.
// ─────────────────────────────────────────────────────────────────────────────

test("TOOLS: fake-pi books a flight end-to-end and shows the confirmation", async () => {
  let context: import("@playwright/test").BrowserContext | undefined;
  let userDataDir: string | undefined;
  let home: string | undefined;
  let stop: (() => void) | undefined;
  let fixture: { url: string; close: () => Promise<void> } | undefined;
  let panel: { evalInPanel: (e: string) => Promise<unknown>; close: () => Promise<void> } | undefined;

  try {
    fixture = await serveFixture(path.join(HERE, "fixtures/flight-site"));

    let extensionLoaded: boolean;
    ({ context, userDataDir, extensionLoaded } = await launchWithExtension());
    test.skip(!extensionLoaded, "browser cannot side-load the MV3 extension (Chrome 137+)");

    const script = JSON.stringify(bookingScript(fixture.url));
    let pairingCode: string;
    ({ home, pairingCode, stop } = await startDaemon({
      FAIRY_PI_BIN: path.join(HERE, "fake-pi"),
      FAIRY_FAKE_PI_SCRIPT: script,
    }));

    // Pair: redeem the code → token, read the WS ports, persist `connection`.
    await pair(context, pairingCode);

    // Open the demo flight site in a tab and make it the active tab (bind targets it).
    const agentTab = await context.newPage();
    await agentTab.goto(fixture.url);
    await agentTab.bringToFront();

    // Open the REAL side panel. Its App connects the conversation WS → the daemon
    // authenticates it and SPAWNS fake-pi (which connects the piBridge + waits).
    panel = await openSidePanel(context);

    // Re-focus the fixture tab so it's the active tab when we bind.
    await agentTab.bringToFront();

    // Bind the agent to the (active) fixture tab — the exact message the panel's
    // send button fires — from inside the side panel, and await the SW ack.
    const bind = (await panel.evalInPanel(
      `new Promise(res => chrome.runtime.sendMessage({type:"agent:taskStart"}).then(res, e => res({error:String(e)})))`,
    )) as { ok?: boolean };
    expect(bind?.ok, `tab bind failed: ${JSON.stringify(bind)}`).toBe(true);

    // fake-pi now drives the full booking sequence on the bound tab. Wait for the
    // confirmation to carry the "FAIRY-" booking reference.
    await expect(agentTab.locator("#confirmation")).toContainText("FAIRY-", { timeout: 30_000 });
    await expect(agentTab.locator("#confirmation")).toBeVisible();
  } finally {
    await panel?.close();
    stop?.();
    await context?.close();
    cleanup([home, userDataDir]);
    await fixture?.close();
  }
});
