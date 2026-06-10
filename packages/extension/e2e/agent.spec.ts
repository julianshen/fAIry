import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { serveFixture, startDaemon, launchWithExtension, openSidePanel, pair, cleanup, HERE, HTTP_PORT } from "./_harness";

// ─────────────────────────────────────────────────────────────────────────────
// AGENT E2E (LLM-gated happy path): the REAL Pi agent — not fake-pi — books a
// flight on the demo site end-to-end through the full stack, driven by a natural
// language task and a live LLM provider:
//
//   Pi (FAIRY_PI_BIN = bundled fairy-pi) → daemon piBridge → daemon
//   browser-bridge WS → loaded MV3 extension → chrome.debugger / CDP → site.
//
// Mechanics are exactly the spike's / tools.spec's (see spike.spec.ts): serve the
// fixture, pair, open the fixture tab, open the REAL side panel, bind the active
// tab. The DIFFERENCE from tools.spec: there is no scripted fake-pi — we point
// FAIRY_PI_BIN at the bundled `fairy-pi` (real agent), configure a provider key
// into the daemon (PUT /settings), and then SEND a natural-language task so the
// agent itself decides the tool sequence.
//
// This test SELF-SKIPS unless FAIRY_E2E_PROVIDER_KEY (an LLM provider key) is set
// AND the browser can side-load the extension. It is therefore exercised ONLY on
// a credentialed run; without a key it skips cleanly (the agent never runs).
// ─────────────────────────────────────────────────────────────────────────────

const KEY = process.env.FAIRY_E2E_PROVIDER_KEY;

test("AGENT: the real Pi agent books a flight from a natural-language task", async () => {
  test.skip(!KEY, "set FAIRY_E2E_PROVIDER_KEY (an LLM provider key) to run the agent e2e");

  const fixture = await serveFixture(path.join(HERE, "fixtures/flight-site"));
  const { context, userDataDir, extensionLoaded } = await launchWithExtension();
  test.skip(!extensionLoaded, "browser cannot side-load the MV3 extension (Chrome 137+)");

  // The real agent: prefer the bundled, single-file `fairy-pi` produced by the
  // pi-daemon build; fall back to a `pi` on PATH if it isn't built.
  const BUNDLED_PI = path.resolve(HERE, "../../pi-daemon/dist/fairy-pi");
  const piBin = existsSync(BUNDLED_PI) ? BUNDLED_PI : "pi";

  const { home, pairingCode, stop } = await startDaemon({ FAIRY_PI_BIN: piBin });

  let panel: { evalInPanel: (e: string) => Promise<unknown>; close: () => Promise<void> } | undefined;
  try {
    // Pair: redeem the code → token, read the WS ports, persist `connection`.
    await pair(context, pairingCode);

    // Configure the LLM provider key into the daemon via its authenticated
    // PUT /settings (the trusted shell normally does this). The bearer token is
    // the session token the daemon wrote to `${home}/token.json`. The body must
    // satisfy isPiConfig: a `providers` array of `{ id, apiKey }` plus an
    // optional `defaultProvider` (see pi-daemon/src/settings.ts).
    const token = (JSON.parse(readFileSync(path.join(home, "token.json"), "utf8")) as { token: string }).token;
    const settingsRes = await fetch(`http://127.0.0.1:${HTTP_PORT}/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        providers: [{ id: "anthropic", apiKey: KEY }],
        defaultProvider: "anthropic",
      }),
    });
    expect(settingsRes.status, "PUT /settings should accept the provider config").toBe(200);

    // Open the demo flight site in a tab and make it the active tab (bind targets it).
    const agentTab = await context.newPage();
    await agentTab.goto(fixture.url);
    await agentTab.bringToFront();

    // Open the REAL side panel. Its App connects the conversation WS → the daemon
    // authenticates it and SPAWNS the real Pi agent (which connects the piBridge).
    panel = await openSidePanel(context);

    // Re-focus the fixture tab so it's the active tab when we bind + send.
    await agentTab.bringToFront();

    // SEND THE NATURAL-LANGUAGE TASK. The real agent needs the prompt (unlike
    // fake-pi, which ignores it). We drive the production composer inside the side
    // panel: set the controlled <textarea>.comp-input value via React's native
    // setter (dispatching an `input` event so React's onChange fires), then click
    // the send button (.send-btn). The panel's onSend runs the SAME flow as a real
    // user: sendMessage({type:"agent:taskStart"}) binds the active (fixture) tab,
    // then client.start(task) streams the prompt over the conversation WS to Pi.
    //
    // NOTE: this composer-drive + the live agent run below are exercised ONLY on a
    // credentialed run (FAIRY_E2E_PROVIDER_KEY set). With no key the test has
    // already skipped above, so THIS PATH IS AUTHORED-NOT-RUN in keyless CI — it
    // is not claimed to work live here.
    const sent = await panel.evalInPanel(
      `(() => {
        const ta = document.querySelector("textarea.comp-input");
        if (!ta) return { error: "composer textarea not found" };
        const task = "Book a flight from SFO to JFK on this page and confirm it.";
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
        setter.call(ta, task);
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        const btn = document.querySelector("button.send-btn");
        if (!btn) return { error: "send button not found" };
        btn.click();
        return { ok: true, value: ta.value };
      })()`,
    );
    expect((sent as { ok?: boolean })?.ok, `composer-drive failed: ${JSON.stringify(sent)}`).toBe(true);

    // The live agent now decides + drives the booking sequence on the bound tab.
    // Lenient, generous budget: poll #confirmation for the "FAIRY-" reference.
    await expect
      .poll(async () => agentTab.locator("#confirmation").textContent().catch(() => ""), { timeout: 300_000 })
      .toContain("FAIRY-");
    await expect(agentTab.locator("#confirmation")).toBeVisible();
  } finally {
    await panel?.close();
    stop();
    await context.close();
    cleanup([home, userDataDir]);
    await fixture.close();
  }
});
