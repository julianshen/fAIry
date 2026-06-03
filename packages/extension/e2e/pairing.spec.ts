import { test, expect, chromium, type BrowserContext } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(HERE, "../dist");
const DAEMON_MAIN = path.resolve(HERE, "../../pi-daemon/src/main.ts");
const HTTP_PORT = "51789"; // matches the options page's hardcoded DAEMON_HTTP_BASE
// Deterministic id from the manifest `key` (MV3 service workers are lazy, so we
// can't rely on one appearing to discover the id).
const EXTENSION_ID = "bdbpchbohpaaiccocjkeinnccacojdjp";

let daemon: ChildProcess | undefined;
let home: string | undefined;
let userDataDir: string | undefined;
let context: BrowserContext;
let pairingCode = "";
let extensionLoaded = false;

async function startDaemon(): Promise<void> {
  home = mkdtempSync(path.join(tmpdir(), "fairy-e2e-"));
  daemon = spawn("bun", ["run", DAEMON_MAIN], {
    env: { ...process.env, FAIRY_HOME: home, FAIRY_HTTP_PORT: HTTP_PORT },
    // stderr ignored (not piped-but-unread, which could fill its buffer and stall the daemon).
    stdio: ["ignore", "pipe", "ignore"],
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("daemon did not start in time")), 20_000);
    let out = "";
    daemon?.stdout?.on("data", (d: Buffer) => {
      out += d.toString();
      if (out.includes("listening")) {
        clearTimeout(timer);
        resolve();
      }
    });
    daemon?.on("exit", (code) => reject(new Error(`daemon exited early (${code})`)));
  });
  pairingCode = (JSON.parse(readFileSync(path.join(home, "pairing.json"), "utf8")) as { code: string }).code;
}

test.beforeAll(async () => {
  userDataDir = mkdtempSync(path.join(tmpdir(), "fairy-udd-"));
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false, // bundled Chromium side-loads extensions (branded Chrome 137+ doesn't)
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, "--no-first-run"],
  });
  // Chrome 137+ disabled --load-extension; detect whether the extension is
  // actually loaded so the test can skip (not fail) on such browsers.
  const probe = await context.newPage();
  extensionLoaded = await probe
    .goto(`chrome-extension://${EXTENSION_ID}/src/options/index.html`, { timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  await probe.close();
  if (extensionLoaded) await startDaemon();
});

test.afterAll(async () => {
  await context?.close();
  daemon?.kill("SIGTERM");
  if (home) rmSync(home, { recursive: true, force: true });
  if (userDataDir) rmSync(userDataDir, { recursive: true, force: true });
});

test("the options page pairs with the daemon", async () => {
  test.skip(
    !extensionLoaded,
    "Chrome did not load the unpacked extension (137+ removed --load-extension) — run with a compatible Chromium.",
  );

  const page = await context.newPage();
  await page.goto(`chrome-extension://${EXTENSION_ID}/src/options/index.html`);

  await expect(page.getByRole("heading", { name: "Pair Fairy" })).toBeVisible();
  await page.getByPlaceholder("pairing code").fill(pairingCode);
  await page.getByRole("button", { name: "Pair" }).click();

  // discover() ran POST /pair + GET /info against the real daemon (CORS allows
  // the chrome-extension origin); the success message means the token was
  // received and saveConnection() persisted it to chrome.storage.
  await expect(page.getByText(/Paired!/)).toBeVisible({ timeout: 15_000 });
});
