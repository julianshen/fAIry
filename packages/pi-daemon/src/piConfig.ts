import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface ProviderConfig {
  /** Provider id Pi knows (e.g. "anthropic", "openai"). */
  id: string;
  apiKey: string;
}

export interface PiConfig {
  providers: ProviderConfig[];
  defaultProvider?: string;
  defaultModel?: string;
  enabledModels?: string[];
}

/** Pi `auth.json` shape: one api_key entry per provider. */
export type PiAuth = Record<string, { type: "api_key"; key: string }>;

/** Build the `auth.json` object — providers with a non-empty key only. */
export function buildAuth(config: PiConfig): PiAuth {
  const auth: PiAuth = {};
  for (const provider of config.providers) {
    if (provider.apiKey) auth[provider.id] = { type: "api_key", key: provider.apiKey };
  }
  return auth;
}

/** Build the `settings.json` object — only keys that are actually set. */
export function buildSettings(config: PiConfig): Record<string, unknown> {
  const settings: Record<string, unknown> = {};
  if (config.defaultProvider) settings.defaultProvider = config.defaultProvider;
  if (config.defaultModel) settings.defaultModel = config.defaultModel;
  if (config.enabledModels) settings.enabledModels = config.enabledModels;
  return settings;
}

/** Write a JSON file, enforcing `mode` even when overwriting (the writeFileSync
 *  `mode` option only applies on creation). */
function writeJson(file: string, data: unknown, mode?: number): void {
  writeFileSync(file, JSON.stringify(data, null, 2), mode !== undefined ? { mode } : undefined);
  if (mode !== undefined) chmodSync(file, mode);
}

/**
 * Materialize Pi's `settings.json` and `auth.json` into `agentDir` (the daemon's
 * isolated `PI_CODING_AGENT_DIR`). The daemon owns this directory wholesale — it
 * is not the user's global `~/.pi` — so the files are written from `config` as
 * the single source of truth. `auth.json` is `0600` (it holds API keys).
 */
export function writePiConfig(agentDir: string, config: PiConfig): void {
  mkdirSync(agentDir, { recursive: true });
  writeJson(path.join(agentDir, "auth.json"), buildAuth(config), 0o600);
  writeJson(path.join(agentDir, "settings.json"), buildSettings(config));
}
