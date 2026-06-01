import os from "node:os";
import { resolvePaths } from "./paths";

/**
 * Daemon entry point. For now it just resolves and reports its isolated
 * directories — proof the package runs end-to-end via `bun run start`.
 *
 * Next PRs wire the real daemon: spawn Pi (`pi --mode rpc`), run the loopback
 * bridge server, and expose the localhost API consumed by the Chrome extension
 * and the native macOS shell.
 */
function main(): void {
  let home: string;
  try {
    home = os.homedir();
  } catch (err) {
    console.error(
      "[fairy:pi-daemon] FATAL: could not determine the user's home directory.",
      err,
    );
    process.exit(1);
  }

  const paths = resolvePaths({
    platform: process.platform,
    env: process.env,
    home,
  });
  console.log("[fairy:pi-daemon] resolved paths:");
  console.log(`  appData:    ${paths.appData}`);
  console.log(`  piAgentDir: ${paths.piAgentDir}`);
  console.log(`  workspace:  ${paths.workspace}`);
}

main();
