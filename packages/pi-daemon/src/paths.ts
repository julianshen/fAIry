import path from "node:path";

export interface DaemonPaths {
  /** Root application data directory — isolated from any global Pi config. */
  appData: string;
  /** Pi's isolated config directory (passed to the subprocess as PI_CODING_AGENT_DIR). */
  piAgentDir: string;
  /** Pi's working directory for tasks. */
  workspace: string;
}

export interface ResolvePathsInput {
  /** Usually `process.platform`. */
  platform: NodeJS.Platform;
  /** Usually `process.env`. */
  env: Record<string, string | undefined>;
  /** Usually `os.homedir()`. */
  home: string;
}

/** Application directory name. Capitalized "AI" is the brand. */
const APP_DIR = "fAIry";

/**
 * Resolve the daemon's isolated directories from the platform/env/home.
 * Pure (no I/O, no `process` access) so it's fully testable.
 *
 * Precedence: an explicit `FAIRY_HOME` wins on every platform; otherwise the
 * OS convention is used (macOS Application Support, Windows %APPDATA%, else the
 * XDG data dir). The Pi config dir and workspace are always nested under it so
 * the daemon never touches the user's global `~/.pi`.
 */
export function resolvePaths({ platform, env, home }: ResolvePathsInput): DaemonPaths {
  const p = platform === "win32" ? path.win32 : path.posix;

  const appData = resolveAppData(p, platform, env, home);
  return {
    appData,
    piAgentDir: p.join(appData, "pi"),
    workspace: p.join(appData, "workspace"),
  };
}

function resolveAppData(
  p: path.PlatformPath,
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
  home: string,
): string {
  const override = env.FAIRY_HOME?.trim();
  if (override) return override;

  if (platform === "darwin") {
    return p.join(home, "Library", "Application Support", APP_DIR);
  }
  if (platform === "win32") {
    const roaming = env.APPDATA?.trim() || p.join(home, "AppData", "Roaming");
    return p.join(roaming, APP_DIR);
  }
  // Linux and everything else: XDG Base Directory spec.
  const xdg = env.XDG_DATA_HOME?.trim() || p.join(home, ".local", "share");
  return p.join(xdg, APP_DIR);
}
