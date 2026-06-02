import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDaemon, type PiBridgeInfo, type RunningDaemon } from "./daemon";
import type { ChildLike } from "./jsonLineProcess";
import { resolvePaths, type DaemonPaths } from "./paths";
import { createFileSettingsStore } from "./settingsStore";
import { mintToken, writeToken } from "./tokenStore";

/**
 * Daemon entry point: resolve the isolated dirs, mint + surface the per-session
 * token, load persisted settings (materializing Pi's config), then bring up the
 * bridge / conversation / HTTP servers via {@link createDaemon}. A thin
 * composition shell over already-unit-tested parts — exercised by running it.
 */
async function main(): Promise<void> {
  const paths = resolvePaths({ platform: process.platform, env: process.env, home: homedirOrExit() });

  // appData and piAgentDir get created as a side effect of writing the token and
  // Pi config; the workspace (Pi's cwd per conversation) has no other creator, so
  // a first-run conversation would otherwise spawn Pi against a missing directory.
  mkdirSync(paths.workspace, { recursive: true });

  const token = mintToken();
  writeToken(paths.appData, token);

  const settings = createFileSettingsStore({
    configFile: path.join(paths.appData, "config.json"),
    piAgentDir: paths.piAgentDir,
  });

  const daemon = await createDaemon({ token, settings, spawnPi: piSpawner(paths) });

  console.log("[fairy:pi-daemon] listening (loopback):");
  console.log(`  bridge:       ws://127.0.0.1:${daemon.ports.bridge}`);
  console.log(`  pi-bridge:    tcp://127.0.0.1:${daemon.ports.piBridge}`);
  console.log(`  conversation: ws://127.0.0.1:${daemon.ports.conversation}`);
  console.log(`  http:         http://127.0.0.1:${daemon.ports.http}`);
  console.log(`  appData:      ${paths.appData}`);

  installShutdown(daemon);
}

/** The Pi `browser` extension script, shipped alongside the daemon. */
const BROWSER_EXTENSION = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../pi-extension/browser-bridge.ts",
);

/**
 * Spawn `pi --mode rpc` against the daemon's isolated config dir, loading the
 * browser extension and pointing it back at the loopback piBridge via env.
 */
function piSpawner(paths: DaemonPaths): (bridge: PiBridgeInfo) => ChildLike {
  return (bridge) =>
    spawn("pi", ["--mode", "rpc", "-e", BROWSER_EXTENSION], {
      env: {
        ...process.env,
        PI_CODING_AGENT_DIR: paths.piAgentDir,
        FAIRY_PI_BRIDGE_PORT: String(bridge.port),
        FAIRY_PI_BRIDGE_TOKEN: bridge.token,
      },
      cwd: paths.workspace,
      stdio: ["pipe", "pipe", "pipe"],
    }) as unknown as ChildLike;
}

function homedirOrExit(): string {
  try {
    return os.homedir();
  } catch (err) {
    console.error("[fairy:pi-daemon] FATAL: could not determine the home directory.", err);
    process.exit(1);
  }
}

/** Close the daemon on SIGINT/SIGTERM so sockets/Pi don't linger. */
function installShutdown(daemon: RunningDaemon): void {
  let closing = false;
  const shutdown = (signal: string): void => {
    if (closing) {
      // A second signal while a slow/stuck close() is in flight forces exit, so
      // the daemon stays killable from the terminal.
      console.error(`[fairy:pi-daemon] ${signal} again — forcing exit.`);
      process.exit(1);
    }
    closing = true;
    console.log(`[fairy:pi-daemon] ${signal} — shutting down.`);
    daemon.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[fairy:pi-daemon] FATAL: failed to start.", err);
  process.exit(1);
});
