import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { createDaemon, type RunningDaemon } from "./daemon";
import type { ChildLike, Spawner } from "./jsonLineProcess";
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

  const token = mintToken();
  writeToken(paths.appData, token);

  const settings = createFileSettingsStore({
    configFile: path.join(paths.appData, "config.json"),
    piAgentDir: paths.piAgentDir,
  });

  const daemon = await createDaemon({ token, settings, spawn: piSpawner(paths) });

  console.log("[fairy:pi-daemon] listening (loopback):");
  console.log(`  bridge:       ws://127.0.0.1:${daemon.ports.bridge}`);
  console.log(`  conversation: ws://127.0.0.1:${daemon.ports.conversation}`);
  console.log(`  http:         http://127.0.0.1:${daemon.ports.http}`);
  console.log(`  appData:      ${paths.appData}`);

  installShutdown(daemon);
}

/** Spawn `pi --mode rpc` against the daemon's isolated config dir. */
function piSpawner(paths: DaemonPaths): Spawner {
  return () =>
    spawn("pi", ["--mode", "rpc"], {
      env: { ...process.env, PI_CODING_AGENT_DIR: paths.piAgentDir },
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
    if (closing) return;
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
