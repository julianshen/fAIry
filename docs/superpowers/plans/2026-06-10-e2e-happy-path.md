# End-to-end happy path (M6-2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deterministic local demo flight site + a shared Playwright harness + two end-to-end specs through the `FAIRY_PI_BIN` seam — `tools.spec.ts` (a scripted `fake-pi` books the flight; runs and passes here) and `agent.spec.ts` (the bundled `fairy-pi` books it from a natural-language task; LLM-gated, self-skips without a key).

**Architecture:** The daemon spawns whatever `FAIRY_PI_BIN` names with `FAIRY_PI_BRIDGE_PORT`/`FAIRY_PI_BRIDGE_TOKEN` injected, so a fake Pi that speaks the piBridge protocol drives the whole daemon↔extension↔CDP path deterministically (no LLM, no daemon changes). Same seam → bundled `fairy-pi` for the agent run.

**Tech Stack:** Playwright (bundled Chromium, side-loaded MV3 extension), Bun (daemon + fake-pi), `node:http` (fixture server), `node:net` (piBridge client). Run from `packages/extension/`.

**Spec:** `docs/superpowers/specs/2026-06-10-e2e-happy-path-design.md`.

**⚠️ Feasibility — Task 1 is a SPIKE.** This is real browser automation of a coordinate-clicking agent through a multi-hop bridge in a sandbox. Task 1 stands up the harness + a minimal `fake-pi` and round-trips ONE `navigate → click → type` on a probe page. **If the spike cannot round-trip a tool here** (bundled Chromium blocks `chrome.debugger`-driven tools, or the side-panel/tab-binding can't be driven from a test), STOP and report — the deterministic layer may itself be environment-limited, and we replan before building fixtures. Both specs self-skip when the browser can't side-load the extension (the existing `pairing.spec` condition), so the suite stays green regardless.

Confirmed protocol (from `packages/pi-daemon/pi-extension/browser-bridge.ts`): connect `127.0.0.1:$FAIRY_PI_BRIDGE_PORT`; first line `{type:"auth",token:$FAIRY_PI_BRIDGE_TOKEN}\n`; ignore the `auth_ok` ack (no `id`); then one JSON object per line — request `{id, tool, args}`, response `{id, ok, result?, error?}` (same `id`). Tool names are the **bare** forms: `navigate` `{url}`, `click` `{x,y,button?}` (viewport coords), `type` `{text,delayMs?}` (focused field), `scroll`, `screenshot`. Extension id (deterministic): `bdbpchbohpaaiccocjkeinnccacojdjp`. Built extension dir: `packages/extension/dist`.

Commit trailer MUST be EXACTLY (use `git commit -F -` heredoc):
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 1: SPIKE — shared harness + `fake-pi` + one-tool round-trip

**Files:**
- Create: `packages/extension/e2e/_harness.ts`
- Create: `packages/extension/e2e/fake-pi.ts`
- Create: `packages/extension/e2e/fixtures/probe/index.html`
- Create: `packages/extension/e2e/spike.spec.ts` (throwaway — removed in Task 6)

- [ ] **Step 1: Probe fixture — one input at a fixed coordinate**

Create `packages/extension/e2e/fixtures/probe/index.html`:

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>probe</title>
<style>body{margin:0}#box{position:absolute;left:80px;top:80px;width:240px;height:32px}</style>
</head><body>
  <input id="box" type="text" />
  <script>document.title = "probe-ready";</script>
</body></html>
```

(The input's clickable center is ~(200,96) in a fixed viewport — used by the spike.)

- [ ] **Step 2: `fake-pi.ts` — the piBridge client + a tiny script runner**

Create `packages/extension/e2e/fake-pi.ts`:

```ts
// A scripted stand-in for Pi: the daemon spawns it (FAIRY_PI_BIN) with the
// piBridge port/token injected. It speaks the piBridge line protocol and runs a
// fixed sequence of browser tool calls — no LLM. The booking script is passed via
// FAIRY_FAKE_PI_SCRIPT (a JSON array of {tool,args}); navigate URL via FAIRY_FAKE_PI_URL.
import { createConnection } from "node:net";

const PORT = Number(process.env.FAIRY_PI_BRIDGE_PORT ?? 0);
const TOKEN = process.env.FAIRY_PI_BRIDGE_TOKEN ?? "";
const STEPS: Array<{ tool: string; args: Record<string, unknown> }> =
  JSON.parse(process.env.FAIRY_FAKE_PI_SCRIPT ?? "[]");

if (!PORT) { console.error("fake-pi: FAIRY_PI_BRIDGE_PORT not set"); process.exit(2); }

const sock = createConnection({ host: "127.0.0.1", port: PORT });
const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let buf = "";
let nextId = 0;

sock.on("connect", () => sock.write(JSON.stringify({ type: "auth", token: TOKEN }) + "\n"));
sock.on("data", (d: Buffer) => {
  buf += d.toString();
  let nl: number;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line) as { id?: string; ok?: boolean; result?: unknown; error?: string };
    if (msg.id === undefined) continue; // auth_ok ack
    const p = pending.get(msg.id);
    if (!p) continue;
    pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new Error(msg.error ?? "tool error"));
  }
});
sock.on("error", (e) => { console.error("fake-pi socket error:", e.message); process.exit(3); });

function call(tool: string, args: Record<string, unknown>): Promise<unknown> {
  const id = `fp-${++nextId}`;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    sock.write(JSON.stringify({ id, tool, args }) + "\n");
  });
}

async function run() {
  // small settle so the daemon has promoted the active bridge session
  await new Promise((r) => setTimeout(r, 500));
  for (const step of STEPS) {
    await call(step.tool, step.args);
    await new Promise((r) => setTimeout(r, 150)); // let the page settle between actions
  }
  console.log("fake-pi: script complete");
  sock.end();
  process.exit(0);
}
// give the socket a moment to connect+auth before driving
sock.once("connect", () => { void run(); });
```

- [ ] **Step 3: `_harness.ts` — shared setup helpers**

Create `packages/extension/e2e/_harness.ts`:

```ts
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DIST = path.resolve(HERE, "../dist");
export const DAEMON_MAIN = path.resolve(HERE, "../../pi-daemon/src/main.ts");
export const EXTENSION_ID = "bdbpchbohpaaiccocjkeinnccacojdjp";
export const HTTP_PORT = "51789";
const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

/** Serve a fixture directory over loopback on an ephemeral port. */
export function serveFixture(dir: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const rel = (req.url ?? "/").split("?")[0];
    const file = path.join(dir, rel === "/" ? "index.html" : rel);
    try {
      const body = readFileSync(file);
      res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch { res.writeHead(404); res.end("not found"); }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      resolve({ url: `http://127.0.0.1:${port}/`, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

/** Spawn the daemon (dev mode) with the given extra env; resolves when it's listening. */
export function startDaemon(extraEnv: Record<string, string>): Promise<{ home: string; pairingCode: string; stop: () => void }> {
  const home = mkdtempSync(path.join(tmpdir(), "fairy-e2e-"));
  const daemon: ChildProcess = spawn("bun", ["run", DAEMON_MAIN], {
    env: { ...process.env, FAIRY_HOME: home, FAIRY_HTTP_PORT: HTTP_PORT, ...extraEnv },
    stdio: ["ignore", "pipe", "inherit"],
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("daemon did not start")), 20_000);
    let out = "";
    daemon.stdout?.on("data", (d: Buffer) => {
      out += d.toString();
      if (out.includes("listening")) {
        clearTimeout(timer);
        const code = (JSON.parse(readFileSync(path.join(home, "pairing.json"), "utf8")) as { code: string }).code;
        resolve({ home, pairingCode: code, stop: () => daemon.kill("SIGTERM") });
      }
    });
    daemon.on("exit", (c) => reject(new Error(`daemon exited early (${c})`)));
  });
}

/** Launch bundled Chromium with the built extension side-loaded; report whether it loaded. */
export async function launchWithExtension(): Promise<{ context: BrowserContext; userDataDir: string; extensionLoaded: boolean }> {
  const userDataDir = mkdtempSync(path.join(tmpdir(), "fairy-udd-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, "--no-first-run"],
  });
  const probe = await context.newPage();
  const extensionLoaded = await probe
    .goto(`chrome-extension://${EXTENSION_ID}/src/options/index.html`, { timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  await probe.close();
  return { context, userDataDir, extensionLoaded };
}

export function cleanup(dirs: Array<string | undefined>): void {
  for (const d of dirs) if (d) rmSync(d, { recursive: true, force: true });
}

/** Drive the options page to pair with the daemon. */
export async function pair(context: BrowserContext, pairingCode: string): Promise<void> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${EXTENSION_ID}/src/options/index.html`);
  await page.fill("input", pairingCode);
  await page.getByRole("button", { name: /pair/i }).click();
  await page.getByText(/paired/i).waitFor({ timeout: 10_000 });
  await page.close();
}
```

(Note: `pair` mirrors `pairing.spec.ts`'s steps; Task 1's spike confirms the exact selectors against the real options page and adjusts if needed.)

- [ ] **Step 4: `spike.spec.ts` — round-trip one tool through the real stack**

Create `packages/extension/e2e/spike.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import path from "node:path";
import { serveFixture, startDaemon, launchWithExtension, pair, cleanup, HERE, EXTENSION_ID } from "./_harness";

test("SPIKE: fake-pi navigates + clicks + types through the real stack", async () => {
  const fixture = await serveFixture(path.join(HERE, "fixtures/probe"));
  const { context, userDataDir, extensionLoaded } = await launchWithExtension();
  test.skip(!extensionLoaded, "browser cannot side-load the MV3 extension (Chrome 137+)");

  // Drive the agent tab to the probe page, then open the panel + start a task so the
  // daemon spawns fake-pi. fake-pi's script focuses the input (click) + types "SFO".
  const script = JSON.stringify([
    { tool: "navigate", args: { url: fixture.url } },
    { tool: "click", args: { x: 200, y: 96 } },
    { tool: "type", args: { text: "SFO" } },
  ]);
  const { home, pairingCode, stop } = await startDaemon({
    FAIRY_PI_BIN: "bun",                       // daemon will run: bun <args...>; we override args via the wrapper below
    FAIRY_FAKE_PI_SCRIPT: script,
  });

  // NOTE (spike goal): confirm the daemon spawns FAIRY_PI_BIN with the bridge env,
  // fake-pi connects, and the three tool calls land on the probe tab. The exact
  // panel-send + tab-binding steps are established HERE and reused by tools.spec.
  // ... drive: pair(context, pairingCode); open the agent tab at fixture.url; open the
  //     panel page; send a task; wait for the probe input to read "SFO".

  // Cleanup
  stop();
  await context.close();
  cleanup([home, userDataDir]);
  await fixture.close();
});
```

- [ ] **Step 5: Run the spike + lock the mechanics**

Run from `packages/extension/`:
```bash
bun run build              # build the extension into dist/
bunx playwright test e2e/spike.spec.ts 2>&1 | tail -20
```
Expected: the spike either (a) PASSES — the probe input reads "SFO", proving fake-pi → daemon → extension → CDP works, OR (b) SKIPS (browser can't side-load), OR (c) FAILS. **If it FAILS** because the chain doesn't assemble (debugger blocked, can't bind the tab, daemon won't spawn `bun` as FAIRY_PI_BIN with the script), report the exact failure and STOP — do not proceed to fixtures; the deterministic e2e needs a different approach or is environment-limited. **If it PASSES**, the working panel-send + tab-binding + `FAIRY_PI_BIN`-runs-`bun fake-pi.ts` mechanics are now known — record them in the spike file's comments; Tasks 2–4 build on exactly those.

(Implementation note for the spike: `FAIRY_PI_BIN` must invoke `bun <fake-pi.ts>`. Since the daemon calls `spawn(PI_BIN, ["--mode","rpc","-e",bridge])`, set `FAIRY_PI_BIN` to a small executable wrapper `e2e/fake-pi` (shebang `#!/usr/bin/env bun` pointing at `fake-pi.ts`, ignoring the daemon's args), or set `FAIRY_PI_BIN` to an absolute `bun` and adjust. The spike determines and records which form the daemon accepts.)

- [ ] **Step 6: Commit the spike + harness**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/extension/e2e/_harness.ts packages/extension/e2e/fake-pi.ts \
        packages/extension/e2e/fixtures/probe packages/extension/e2e/spike.spec.ts
git commit -F - <<'MSG'
test(e2e): spike — harness + fake-pi round-trips one tool through the real stack

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 2: Demo flight site fixture (fixed-coordinate layout)

**Files:**
- Create: `packages/extension/e2e/fixtures/flight-site/index.html`
- Create: `packages/extension/e2e/fixtures/flight-site/app.js`

Browser tools click viewport coordinates, so the site fixes element positions (absolute CSS at known px) for a deterministic `fake-pi`.

- [ ] **Step 1: `index.html` — fixed-position form + result/confirmation regions**

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>Fairy Demo Air</title>
<style>
  body { margin: 0; font: 16px system-ui; }
  .at { position: absolute; }
  #from  { left: 80px;  top: 80px;  width: 160px; height: 28px; }
  #to    { left: 80px;  top: 130px; width: 160px; height: 28px; }
  #date  { left: 80px;  top: 180px; width: 160px; height: 28px; }
  #search{ left: 80px;  top: 230px; width: 120px; height: 32px; }
  #results { left: 80px; top: 290px; width: 360px; }
  #book  { left: 80px;  top: 430px; width: 120px; height: 32px; display: none; }
  #confirmation { left: 80px; top: 500px; color: green; font-weight: 600; }
</style></head><body>
  <input id="from"  class="at" type="text" placeholder="From" />
  <input id="to"    class="at" type="text" placeholder="To" />
  <input id="date"  class="at" type="text" placeholder="Date" />
  <button id="search" class="at">Search</button>
  <div id="results" class="at"></div>
  <button id="book" class="at">Book</button>
  <div id="confirmation" class="at"></div>
  <script src="./app.js"></script>
</body></html>
```

- [ ] **Step 2: `app.js` — deterministic search → select → book**

```js
const $ = (id) => document.getElementById(id);
let selected = null;

$("search").addEventListener("click", () => {
  // Deterministic results regardless of the form values (fixed fixture).
  const flights = [
    { id: "FA101", price: 199 },
    { id: "FA205", price: 249 },
    { id: "FA320", price: 312 },
  ];
  const r = $("results");
  r.innerHTML = "";
  flights.forEach((f, i) => {
    const b = document.createElement("button");
    b.id = `select-${i}`;
    b.textContent = `${f.id} — $${f.price}`;
    b.style.display = "block";
    b.style.width = "360px";
    b.style.height = "30px";
    b.addEventListener("click", () => { selected = f; $("book").style.display = "block"; });
    r.appendChild(b);
  });
});

$("book").addEventListener("click", () => {
  if (!selected) return;
  // Deterministic booking reference derived from the selected flight id.
  const ref = "FAIRY-" + selected.id.replace(/[^A-Z0-9]/g, "").padEnd(6, "0").slice(0, 6);
  $("confirmation").textContent = `Booked ${selected.id}. Reference ${ref}`;
});
```

(The first result `#select-0` sits at ~`(80,290)`–`(440,320)`; its click center is ~`(260,305)`. The spike's confirmed coordinates inform the exact values used in Task 3.)

- [ ] **Step 3: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/extension/e2e/fixtures/flight-site
git commit -F - <<'MSG'
test(e2e): deterministic demo flight site fixture (fixed-coordinate layout)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 3: The full booking script (the `fake-pi` step sequence)

**Files:**
- Create: `packages/extension/e2e/bookingScript.ts`

The booking sequence is data (a step array) `tools.spec` passes to `fake-pi` via env. Centralizing it keeps the spec readable and the coordinates in one place.

- [ ] **Step 1: `bookingScript.ts` — the coordinate sequence**

```ts
/** The deterministic booking sequence fake-pi replays on the demo flight site.
 *  Coordinates are the fixed element centers from fixtures/flight-site (a fixed
 *  viewport). click focuses a field; type fills the focused field. */
export function bookingScript(fixtureUrl: string): Array<{ tool: string; args: Record<string, unknown> }> {
  return [
    { tool: "navigate", args: { url: fixtureUrl } },
    { tool: "click", args: { x: 160, y: 94 } },   // #from
    { tool: "type", args: { text: "SFO" } },
    { tool: "click", args: { x: 160, y: 144 } },  // #to
    { tool: "type", args: { text: "JFK" } },
    { tool: "click", args: { x: 160, y: 194 } },  // #date
    { tool: "type", args: { text: "2026-07-01" } },
    { tool: "click", args: { x: 140, y: 246 } },  // #search
    { tool: "click", args: { x: 260, y: 305 } },  // #select-0 (first result)
    { tool: "click", args: { x: 140, y: 446 } },  // #book
  ];
}
```

(The exact px centers are validated against the spike's working coordinate mapping in Task 4; adjust here if the spike showed an offset.)

- [ ] **Step 2: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/extension/e2e/bookingScript.ts
git commit -F - <<'MSG'
test(e2e): the deterministic booking step sequence for fake-pi

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 4: `tools.spec.ts` — deterministic end-to-end booking

**Files:**
- Create: `packages/extension/e2e/tools.spec.ts`

- [ ] **Step 1: Write the deterministic e2e**

Using the spike-confirmed harness mechanics (panel send + tab binding), book the flight via `fake-pi` and assert the confirmation:

```ts
import { test, expect } from "@playwright/test";
import path from "node:path";
import { serveFixture, startDaemon, launchWithExtension, pair, cleanup, HERE } from "./_harness";
import { bookingScript } from "./bookingScript";

test("deterministic: fake-pi books a flight on the demo site end-to-end", async () => {
  const fixture = await serveFixture(path.join(HERE, "fixtures/flight-site"));
  const { context, userDataDir, extensionLoaded } = await launchWithExtension();
  test.skip(!extensionLoaded, "browser cannot side-load the MV3 extension (Chrome 137+)");

  const { home, pairingCode, stop } = await startDaemon({
    FAIRY_PI_BIN: path.join(HERE, "fake-pi"),   // the executable wrapper (spike-confirmed form)
    FAIRY_FAKE_PI_SCRIPT: JSON.stringify(bookingScript(fixture.url)),
  });

  await pair(context, pairingCode);
  // Open the agent tab on the fixture, open the panel, send a task (binds the tab,
  // starts the conversation → daemon spawns fake-pi). Steps per the spike.
  const agentTab = await context.newPage();
  await agentTab.goto(fixture.url);
  // <panel send — exact steps locked by the spike>

  // fake-pi drives the booking on agentTab; wait for the confirmation.
  await agentTab.locator("#confirmation").waitFor({ state: "visible", timeout: 30_000 });
  await expect(agentTab.locator("#confirmation")).toContainText(/FAIRY-/);

  stop();
  await context.close();
  cleanup([home, userDataDir]);
  await fixture.close();
});
```

- [ ] **Step 2: Run it**

Run from `packages/extension/`: `bunx playwright test e2e/tools.spec.ts 2>&1 | tail -20`
Expected: PASS (the `#confirmation` shows a `FAIRY-` reference) — the whole stack drove the booking — or SKIP if the browser can't side-load.

- [ ] **Step 3: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/extension/e2e/tools.spec.ts
git commit -F - <<'MSG'
test(e2e): deterministic flight-booking e2e via fake-pi through the real stack

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 5: `agent.spec.ts` — LLM-gated agent run (self-skips)

**Files:**
- Create: `packages/extension/e2e/agent.spec.ts`

- [ ] **Step 1: Write the LLM-gated e2e**

```ts
import { test, expect } from "@playwright/test";
import path from "node:path";
import { existsSync } from "node:fs";
import { serveFixture, startDaemon, launchWithExtension, pair, cleanup, HERE, HTTP_PORT } from "./_harness";

const KEY = process.env.FAIRY_E2E_PROVIDER_KEY;
const BUNDLED_PI = path.resolve(HERE, "../../pi-daemon/dist/fairy-pi");

test("agent: Pi books a flight from a natural-language task (needs FAIRY_E2E_PROVIDER_KEY)", async () => {
  test.skip(!KEY, "set FAIRY_E2E_PROVIDER_KEY (an LLM provider key) to run the agent e2e");
  const fixture = await serveFixture(path.join(HERE, "fixtures/flight-site"));
  const { context, userDataDir, extensionLoaded } = await launchWithExtension();
  test.skip(!extensionLoaded, "browser cannot side-load the MV3 extension (Chrome 137+)");

  // Use the bundled compiled Pi (M6-1) if built; else PATH `pi`.
  const piBin = existsSync(BUNDLED_PI) ? BUNDLED_PI : "pi";
  const { home, pairingCode, stop } = await startDaemon({ FAIRY_PI_BIN: piBin });

  await pair(context, pairingCode);
  // Configure the provider key into the daemon so Pi can call the LLM:
  // PUT /settings with { providers:[{ id:"anthropic", apiKey: KEY }], defaultProvider:"anthropic" }.
  await fetch(`http://127.0.0.1:${HTTP_PORT}/settings`, {
    method: "PUT",
    headers: { authorization: `Bearer ${readToken(home)}`, "content-type": "application/json" },
    body: JSON.stringify({ providers: [{ id: "anthropic", apiKey: KEY }], defaultProvider: "anthropic" }),
  });

  const agentTab = await context.newPage();
  await agentTab.goto(fixture.url);
  // Open the panel; send the natural-language task (panel steps per the spike):
  //   "Book a flight from SFO to JFK on this page and confirm it."
  // Lenient: a real agent run is slow + non-deterministic — generous budget, outcome-only.
  await agentTab.locator("#confirmation").waitFor({ state: "visible", timeout: 300_000 });
  await expect(agentTab.locator("#confirmation")).toContainText(/FAIRY-/);

  stop();
  await context.close();
  cleanup([home, userDataDir]);
  await fixture.close();
});

function readToken(home: string): string {
  // token.json holds { token } the daemon minted; read it for the authenticated PUT.
  const p = path.join(home, "token.json");
  return (JSON.parse(require("node:fs").readFileSync(p, "utf8")) as { token: string }).token;
}
```

(`readToken`/provider id are confirmed against the daemon's settings contract during this task; `anthropic` is the default provider id Pi expects.)

- [ ] **Step 2: Confirm it skips cleanly (no key here)**

Run from `packages/extension/`: `bunx playwright test e2e/agent.spec.ts 2>&1 | tail -10`
Expected: SKIPPED ("set FAIRY_E2E_PROVIDER_KEY …") — no key in this environment. (With a key + the bundled `fairy-pi`, it runs the real agent booking.)

- [ ] **Step 3: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/extension/e2e/agent.spec.ts
git commit -F - <<'MSG'
test(e2e): LLM-gated agent flight-booking e2e (bundled fairy-pi; self-skips)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 6: Refactor `pairing.spec` onto the harness; remove the spike; verify

**Files:**
- Modify: `packages/extension/e2e/pairing.spec.ts` (use `_harness` helpers)
- Delete: `packages/extension/e2e/spike.spec.ts`

- [ ] **Step 1: Refactor `pairing.spec.ts`**

Replace its inline daemon-spawn + extension-launch + pairing logic with the `_harness` helpers (`startDaemon`, `launchWithExtension`, `pair`), keeping the same assertion (the options page reports "Paired!"). The behavior is unchanged; it now shares the harness.

- [ ] **Step 2: Remove the throwaway spike**

```bash
git rm packages/extension/e2e/spike.spec.ts
```

- [ ] **Step 3: Full e2e + unit suites**

Run from `packages/extension/`:
```bash
bun run test 2>&1 | grep -E "Tests +[0-9]+ (passed|failed)" | tail -1   # vitest unit suite unchanged
bunx playwright test 2>&1 | tail -15                                     # pairing + tools pass/skip; agent skips
```
Expected: vitest green; Playwright — `pairing` + `tools` pass (or skip on a non-side-loading browser), `agent` skips (no key). No failures.

- [ ] **Step 4: Commit**

```bash
cd /Users/julianshen/prj/fAIry
git add packages/extension/e2e/pairing.spec.ts
git commit -F - <<'MSG'
test(e2e): refactor pairing.spec onto the shared harness; drop the spike

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
```

---

## Self-Review

**1. Spec coverage.**
- Deterministic demo flight site → Task 2; shared harness → Task 1 (`_harness.ts`), refactor → Task 6.
- `fake-pi` driving tools via the piBridge seam (no daemon changes) → Task 1 (`fake-pi.ts`) + Task 3 (the booking script).
- Deterministic `tools.spec` that runs here → Task 4; LLM-gated `agent.spec` (bundled `fairy-pi`, self-skips) → Task 5.
- Derisk the harness + one tool round-trip FIRST → Task 1 (the spike, with an explicit STOP-and-report gate).
- Skip-when-no-extension / skip-when-no-key → Tasks 4/5 (`test.skip`).
  No spec requirement is left without a task.

**2. Placeholder scan.** The protocol-critical code (`fake-pi.ts` piBridge client, `_harness.ts`, the fixture, the booking script, both specs) is complete. The deliberately-deferred bits — the exact **panel-send + tab-binding steps** and the **precise click coordinates** — are what Task 1's SPIKE exists to lock down (the spec mandates derisking these first); they are marked as "spike-confirmed", not hand-waved, and the spike has a hard STOP-and-report gate if the chain doesn't assemble. This is a genuine integration-discovery task, not a TBD.

**3. Consistency.** The piBridge frames in `fake-pi.ts` (`{type:auth,token}`, `{id,tool,args}` / `{id,ok,result,error}`, ignore-`auth_ok`) match the confirmed `browser-bridge.ts` protocol. Tool names are the bare `navigate`/`click`/`type` (not `browser_*`) consistently in `fake-pi`/`bookingScript`. `FAIRY_PI_BIN` (the M6-1 seam) + `FAIRY_FAKE_PI_SCRIPT`/`FAIRY_FAKE_PI_URL` are consistent across `fake-pi.ts`, `_harness.startDaemon`, and the specs. `_harness` exports (`serveFixture`/`startDaemon`/`launchWithExtension`/`pair`/`cleanup`/`HERE`/`EXTENSION_ID`/`HTTP_PORT`/`DIST`) match their uses in every spec. `EXTENSION_ID` + `DIST` match `pairing.spec.ts`.
