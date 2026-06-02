import path from "node:path";
import { writeJsonFile } from "./fsAtomic";

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

/**
 * A provider's API key, trimmed — `""` when blank/whitespace. The single source
 * of truth for "is a key configured": both `buildAuth` (which writes it) and
 * `redactConfig` (which reports its presence) decide via this, so they can't drift.
 */
export function normalizedApiKey(provider: ProviderConfig): string {
  return provider.apiKey.trim();
}

/** Build the `auth.json` object — providers with a non-blank key only, trimmed. */
export function buildAuth(config: PiConfig): PiAuth {
  const auth: PiAuth = {};
  for (const provider of config.providers) {
    const key = normalizedApiKey(provider);
    if (key) auth[provider.id] = { type: "api_key", key };
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

/**
 * Materialize Pi's `settings.json` and `auth.json` into `agentDir` (the daemon's
 * isolated `PI_CODING_AGENT_DIR`). The daemon owns this directory wholesale — it
 * is not the user's global `~/.pi` — so the files are written from `config` as
 * the single source of truth. `auth.json` is `0600` (it holds API keys).
 */
export function writePiConfig(agentDir: string, config: PiConfig): void {
  writeJsonFile(path.join(agentDir, "auth.json"), buildAuth(config), 0o600);
  writeJsonFile(path.join(agentDir, "settings.json"), buildSettings(config));
}
