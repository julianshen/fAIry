import { normalizedApiKey, type PiConfig } from "./piConfig";

/** A provider as exposed to clients — its key presence, never the key itself. */
export interface RedactedProvider {
  id: string;
  hasKey: boolean;
}

/** The non-secret view of {@link PiConfig} safe to return over the wire. */
export interface RedactedConfig {
  providers: RedactedProvider[];
  defaultProvider?: string;
  defaultModel?: string;
  enabledModels?: string[];
}

/**
 * Project a {@link PiConfig} to its non-secret view: each provider's `apiKey`
 * collapses to a `hasKey` boolean (via {@link normalizedApiKey}, the same rule
 * `buildAuth` uses to decide which keys to write), so secrets never leave the daemon.
 */
export function redactConfig(config: PiConfig): RedactedConfig {
  const redacted: RedactedConfig = {
    providers: config.providers.map((p) => ({ id: p.id, hasKey: normalizedApiKey(p) !== "" })),
  };
  if (config.defaultProvider !== undefined) redacted.defaultProvider = config.defaultProvider;
  if (config.defaultModel !== undefined) redacted.defaultModel = config.defaultModel;
  if (config.enabledModels !== undefined) redacted.enabledModels = config.enabledModels;
  return redacted;
}

/**
 * The daemon's settings source of truth, injected into the HTTP endpoint so the
 * transport stays pure/testable. `get` returns the current config; `save`
 * persists an update (the production impl writes Pi's config via `writePiConfig`
 * and updates its in-memory copy).
 */
export interface SettingsStore {
  get(): PiConfig;
  save(config: PiConfig): void;
}
