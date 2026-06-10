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
/** Remote-debugging port for raw-CDP access to the side panel target (see spike). */
export const CDP_PORT = 9333;
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
    args: [
      `--disable-extensions-except=${DIST}`,
      `--load-extension=${DIST}`,
      "--no-first-run",
      // The side panel is a CDP `page` target Playwright doesn't surface as a
      // Page; raw CDP over this port lets the spec reach it (see spike mechanics).
      `--remote-debugging-port=${CDP_PORT}`,
    ],
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

/**
 * Open the REAL side panel and return an `evalInPanel` that runs an expression
 * inside it over raw CDP. The side panel is where the production panel UI lives —
 * the only own-extension context whose `sender.tab` is undefined, so its
 * `chrome.runtime.sendMessage({type:"agent:taskStart"})` passes the background
 * SW's `fromOwnPage` bind gate (an extension page in a normal TAB does NOT —
 * `sender.tab` is defined there).
 *
 * Mechanics: `sidePanel.open()` needs a user gesture, so we click a button on the
 * options page that calls it (a Playwright click is a trusted gesture). The panel
 * target then appears in `/json/list`; we open its devtools websocket and drive
 * `Runtime.evaluate` against it. Opening the panel also mounts its App, which
 * connects the conversation WS → the daemon spawns Pi (fake-pi).
 */
export async function openSidePanel(
  context: BrowserContext,
): Promise<{ evalInPanel: (expression: string) => Promise<unknown>; close: () => Promise<void> }> {
  // A trusted gesture to satisfy sidePanel.open()'s user-gesture requirement.
  const gesture = await context.newPage();
  await gesture.goto(`chrome-extension://${EXTENSION_ID}/src/options/index.html`);
  await gesture.evaluate(() => {
    const b = document.createElement("button");
    b.id = "__openSidePanel";
    b.onclick = async () => {
      const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (t?.windowId !== undefined) await chrome.sidePanel.open({ windowId: t.windowId });
    };
    document.body.appendChild(b);
  });
  await gesture.click("#__openSidePanel");

  // Find the side-panel page target via the remote-debugging endpoint (poll: it
  // appears a beat after open()).
  const panelUrl = `chrome-extension://${EXTENSION_ID}/src/panel/index.html`;
  let wsUrl = "";
  for (let i = 0; i < 50 && !wsUrl; i++) {
    try {
      const list = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()) as Array<{
        type: string;
        url: string;
        webSocketDebuggerUrl?: string;
      }>;
      const sp = list.find((t) => t.type === "page" && t.url.includes(panelUrl) && t.webSocketDebuggerUrl);
      if (sp?.webSocketDebuggerUrl) wsUrl = sp.webSocketDebuggerUrl;
    } catch {
      // debugging port not listening yet (ECONNREFUSED) — fall through and retry
    }
    if (!wsUrl) await new Promise((r) => setTimeout(r, 100));
  }
  if (!wsUrl) throw new Error("side panel target did not appear over CDP");

  const ws = new WebSocket(wsUrl);
  await new Promise<void>((res, rej) => {
    ws.onopen = () => res();
    ws.onerror = () => rej(new Error("could not open side-panel CDP socket"));
  });
  let id = 0;
  const pending = new Map<number, (m: { result?: unknown; error?: unknown }) => void>();
  ws.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data)) as { id?: number };
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)!(m as { result?: unknown });
      pending.delete(m.id);
    }
  };
  const cmd = (method: string, params: unknown): Promise<{ result?: { result?: { value?: unknown } } }> =>
    new Promise((res) => {
      const i = ++id;
      pending.set(i, res as (m: unknown) => void);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  await cmd("Runtime.enable", {});

  const evalInPanel = async (expression: string): Promise<unknown> => {
    const r = await cmd("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    return r.result?.result?.value;
  };
  return { evalInPanel, close: async () => { ws.close(); await gesture.close(); } };
}

/** Drive the options page to pair with the daemon. */
export async function pair(context: BrowserContext, pairingCode: string): Promise<void> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${EXTENSION_ID}/src/options/index.html`);
  await page.getByPlaceholder("pairing code").fill(pairingCode);
  await page.getByRole("button", { name: /pair/i }).click();
  await page.getByText(/paired!/i).waitFor({ timeout: 15_000 });
  await page.close();
}
