import { test, expect } from "@playwright/test";
import path from "node:path";
import { serveFixture, startDaemon, launchWithExtension, openSidePanel, pair, cleanup, HERE } from "./_harness";

// ─────────────────────────────────────────────────────────────────────────────
// SPIKE (PASSING): one browser-tool round-trip (navigate → click → type) through
// the REAL stack with NO LLM:
//
//   fake-pi (FAIRY_PI_BIN) → daemon piBridge → daemon browser-bridge WS →
//   loaded MV3 extension → chrome.debugger / CDP → the probe page.
//
// The mechanics below are what Tasks 2–5 (tools.spec / agent.spec) reuse verbatim.
//
// (1) DAEMON SPAWNS fake-pi — the FAIRY_PI_BIN seam.
//     FAIRY_PI_BIN points at the executable wrapper `e2e/fake-pi`
//     (`#!/usr/bin/env bun`, body `import "./fake-pi.ts"`, chmod +x). The daemon
//     spawns it as `spawn(PI_BIN, ["--mode","rpc","-e",<browser-bridge>])`;
//     fake-pi IGNORES those args and reads FAIRY_PI_BRIDGE_PORT /
//     FAIRY_PI_BRIDGE_TOKEN / FAIRY_FAKE_PI_SCRIPT from the env. Pi is spawned the
//     instant a conversation-WS client AUTHENTICATES — the daemon builds the
//     ConversationController eagerly on auth and JsonLineProcess spawns in its
//     constructor — so merely OPENING THE PANEL (which auto-connects the
//     conversation WS) spawns fake-pi; no `start(task)` is required. (fake-pi
//     drives its script on bridge-connect and ignores the conversation prompt.)
//
// (2) OPEN THE PANEL = the SIDE PANEL (not a tab).  The production panel lives in
//     chrome.sidePanel. That matters for the bind (3): the background SW only
//     accepts `agent:taskStart` from an own extension context whose
//     `sender.tab === undefined` (side panel / popup / SW) — an extension page
//     opened in a normal TAB has `sender.tab` DEFINED and is rejected. Playwright
//     does NOT surface the side panel as a Page, and `sidePanel.open()` needs a
//     user gesture, so the harness: clicks a button on the options page that calls
//     `chrome.sidePanel.open({windowId})` (a trusted gesture), then reaches the
//     side-panel page target via the browser's `--remote-debugging-port`
//     (`/json/list` → its devtools websocket) and drives `Runtime.evaluate`
//     inside it.  Confirmed: from that side-panel context `sender.tab` is
//     undefined and `sender.id === runtime.id` → the bind gate passes.
//
// (3) TAB BINDING.  The SW binds the agent to
//     `chrome.tabs.query({active:true,lastFocusedWindow:true})` when it receives
//     `{type:"agent:taskStart"}` from the side panel. So: make the FIXTURE TAB
//     active first, then fire `chrome.runtime.sendMessage({type:"agent:taskStart"})`
//     INSIDE the side panel (the exact message the panel's send button sends) and
//     await its `{ok:true}` ack (the handler resolves only AFTER bindSession).
//
// (4) COORDINATES.  The probe <input> is absolutely positioned at left:80 top:80
//     width:240 height:32 → center (200,96). CDP click uses page/viewport coords
//     directly; (200,96) lands in and focuses the input, and `type` fills it. No
//     device-pixel / offset correction was needed.
// ─────────────────────────────────────────────────────────────────────────────

test("SPIKE: fake-pi navigates + clicks + types through the real stack", async () => {
  const fixture = await serveFixture(path.join(HERE, "fixtures/probe"));
  const { context, userDataDir, extensionLoaded } = await launchWithExtension();
  test.skip(!extensionLoaded, "browser cannot side-load the MV3 extension (Chrome 137+)");

  const script = JSON.stringify([
    { tool: "navigate", args: { url: fixture.url } },
    { tool: "click", args: { x: 200, y: 96 } },
    { tool: "type", args: { text: "SFO" } },
  ]);
  const { home, pairingCode, stop } = await startDaemon({
    FAIRY_PI_BIN: path.join(HERE, "fake-pi"),
    FAIRY_FAKE_PI_SCRIPT: script,
  });

  let panel: { evalInPanel: (e: string) => Promise<unknown>; close: () => Promise<void> } | undefined;
  try {
    // Pair: redeem the code → token, read the WS ports, persist `connection`.
    await pair(context, pairingCode);

    // Open the fixture in a tab and make it the active tab (the bind targets it).
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

    // fake-pi (connected, 500ms settle) now drives navigate → click → type on the
    // bound tab. Wait for the probe input to read "SFO".
    await expect
      .poll(async () => agentTab.locator("#box").inputValue().catch(() => ""), { timeout: 30_000 })
      .toBe("SFO");
  } finally {
    await panel?.close();
    stop();
    await context.close();
    cleanup([home, userDataDir]);
    await fixture.close();
  }
});
