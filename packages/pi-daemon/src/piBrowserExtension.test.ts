import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The browser-bridge `-e` script is a self-contained ship artifact loaded by the
// real `pi` binary (it imports Pi-runtime-provided ExtensionAPI + TypeBox, which
// our package doesn't install). We can't import it here; instead we assert the
// real binary loads it without error. Its wire protocol is covered separately by
// piBridgeServer.test.ts. Skipped when `pi` isn't on PATH (e.g. CI).
const piAvailable = spawnSync("which", ["pi"]).status === 0;
const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../pi-extension/browser-bridge.ts");

(piAvailable ? describe : describe.skip)("browser-bridge extension (real pi)", () => {
  it("loads in `pi --mode rpc -e` and registers its tools without error", async () => {
    const child = spawn("pi", ["--mode", "rpc", "--offline", "--no-session", "-e", SCRIPT], {
      env: { ...process.env, FAIRY_PI_BRIDGE_PORT: "0", FAIRY_PI_BRIDGE_TOKEN: "t" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c: string) => (output += c));
    child.stderr.on("data", (c: string) => (output += c));

    let exitCode: number | null | undefined;
    child.on("exit", (code) => (exitCode = code));

    // RPC mode waits on stdin, so a clean load keeps the process alive. An
    // extension that fails to load makes pi exit early / print a load error.
    await new Promise((r) => setTimeout(r, 2500));
    const stillRunning = exitCode === undefined;
    child.kill("SIGTERM");

    expect(stillRunning).toBe(true);
    expect(output).not.toMatch(/cannot find|failed to load|SyntaxError|TypeError|extension.*error/i);
  }, 12000);
});
