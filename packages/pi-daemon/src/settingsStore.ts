import { readFileSync } from "node:fs";
import { writeJsonFile } from "./fsAtomic";
import { writePiConfig, type PiConfig } from "./piConfig";
import { isPiConfig, type SettingsStore } from "./settings";

export interface FileSettingsStoreOptions {
  /** Our canonical config file — the source of truth. Holds API keys → `0600`. */
  configFile: string;
  /** Pi's isolated config dir; `settings.json`/`auth.json` are derived here. */
  piAgentDir: string;
}

const EMPTY: PiConfig = { providers: [] };

/**
 * A {@link SettingsStore} backed by a canonical `config.json`. On construction
 * it loads that file (falling back to an empty config if absent or invalid);
 * `save` atomically rewrites it (`0600`) and re-materializes Pi's derived
 * `settings.json`/`auth.json`. The canonical file is the single source of truth
 * — Pi's files are never read back — so settings survive a daemon restart.
 *
 * On construction it also materializes Pi's derived files from the loaded config,
 * so Pi's isolated dir is consistent before the first conversation spawns.
 */
export function createFileSettingsStore(opts: FileSettingsStoreOptions): SettingsStore {
  let current = loadConfig(opts.configFile);
  writePiConfig(opts.piAgentDir, current);
  return {
    get: () => current,
    save: (config) => {
      writeJsonFile(opts.configFile, config, 0o600);
      writePiConfig(opts.piAgentDir, config);
      current = config;
    },
  };
}

function loadConfig(file: string): PiConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return EMPTY;
  }
  return isPiConfig(parsed) ? parsed : EMPTY;
}
