import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDaemon, type PiBridgeInfo, type RunningDaemon } from "./daemon";
import { writeJsonFile } from "./fsAtomic";
import type { ChildLike } from "./jsonLineProcess";
import { createPairingStore } from "./pairing";
import { resolvePaths, type DaemonPaths } from "./paths";
import { createFileSettingsStore } from "./settingsStore";
import { acquireSingleInstanceLock, type LockHandle } from "./singleInstance";
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

  // Only one daemon may own this appData (shared token/config/sockets). Bail if
  // another live instance holds the lock; a stale lock from a crash is reclaimed.
  const lock = acquireSingleInstanceLock({ lockFile: path.join(paths.appData, "daemon.lock") });
  if (!lock) {
    console.error("[fairy:pi-daemon] another instance is already running — exiting.");
    process.exit(1);
  }

  try {
    const token = mintToken();
    writeToken(paths.appData, token);

    const settings = createFileSettingsStore({
      configFile: path.join(paths.appData, "config.json"),
      piAgentDir: paths.piAgentDir,
    });

    // The extension can't read token.json; surface a single-use pairing code it
    // redeems for the token via POST /pair. The trusted shell reads this file.
    const pairing = createPairingStore({ token });
    writeJsonFile(path.join(paths.appData, "pairing.json"), { code: pairing.code }, 0o600);

    // M4: once the Chrome extension exists, pass its exact origin as
    // `allowedOrigins` so /pair + CORS accept only the real extension rather
    // than any chrome-extension:// origin (the pairing code stays the credential).
    const daemon = await createDaemon({ token, settings, pairing, spawnPi: piSpawner(paths) });

    console.log("[fairy:pi-daemon] listening (loopback):");
    console.log(`  bridge:       ws://127.0.0.1:${daemon.ports.bridge}`);
    console.log(`  pi-bridge:    tcp://127.0.0.1:${daemon.ports.piBridge}`);
    console.log(`  conversation: ws://127.0.0.1:${daemon.ports.conversation}`);
    console.log(`  http:         http://127.0.0.1:${daemon.ports.http}`);
    console.log(`  appData:      ${paths.appData}`);

    installShutdown(daemon, lock);
  } catch (err) {
    // Don't leave the lock held if startup failed before installShutdown.
    lock.release();
    throw err;
  }
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

/** Close the daemon + release the lock on SIGINT/SIGTERM so nothing lingers. */
function installShutdown(daemon: RunningDaemon, lock: LockHandle): void {
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
    const finish = (code: number): never => {
      lock.release();
      process.exit(code);
    };
    daemon.close().then(
      () => finish(0),
      () => finish(1),
    );
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[fairy:pi-daemon] FATAL: failed to start.", err);
  process.exit(1);
});
